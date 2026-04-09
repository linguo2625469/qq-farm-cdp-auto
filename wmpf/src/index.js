"use strict";
require("../../load-env.cjs").loadEnvFiles(require("node:path").join(__dirname, "..", ".."));
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_events_1 = require("node:events");
const node_path_1 = __importDefault(require("node:path"));
const frida = __importStar(require("frida"));
const ws_1 = __importStar(require("ws"));
const cli_1 = require("./cli");
const logger_1 = require("./logger");
const cdp_automation_1 = require("./cdp_automation");
const codex = require("./third-party/RemoteDebugCodex.js");
const messageProto = require("./third-party/WARemoteDebugProtobuf.js");
const FRIDA_RETRY_MS = 3000;
class DebugMessageEmitter extends node_events_1.EventEmitter {
}
const debugMessageEmitter = new DebugMessageEmitter();
debugMessageEmitter.transportState = {
    miniappClientCount: 0,
    miniappConnected: false,
    cdpClientCount: 0,
    cdpClientConnected: false,
};
const bufferToHexString = (buffer) => {
    return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};
const safe_json_parse = (payload) => {
    try {
        return JSON.parse(payload);
    }
    catch (_) {
        return null;
    }
};
const summarize_console_args = (args) => args
    .slice(0, 3)
    .map((arg) => {
    if (!arg || typeof arg !== "object") {
        return String(arg);
    }
    const item = arg;
    if (typeof item.value === "string") {
        return item.value;
    }
    if (typeof item.value === "number" ||
        typeof item.value === "boolean") {
        return String(item.value);
    }
    if (typeof item.description === "string" && item.description.length > 0) {
        return item.description;
    }
    return item.type ?? "unknown";
})
    .join(" | ");
const summarize_cdp_payload = (payloadText) => {
    const payload = safe_json_parse(payloadText);
    if (!payload) {
        return `[miniapp] [DEBUG] cdp payload (non-json): ${payloadText.slice(0, 160)}`;
    }
    if (typeof payload.method === "string") {
        if (payload.method === "Runtime.consoleAPICalled") {
            const type = payload.params?.type;
            if (type === "trace" ||
                type === "log" ||
                type === "debug" ||
                type === "info") {
                return null;
            }
            return `[miniapp] [DEBUG] cdp event Runtime.consoleAPICalled type=${type ?? "unknown"} context=${payload.params?.executionContextId ?? "?"} args=${summarize_console_args(Array.isArray(payload.params?.args) ? payload.params.args : [])}`;
        }
        if (payload.method === "Runtime.executionContextCreated") {
            const context = payload.params?.context ?? {};
            return `[miniapp] [DEBUG] cdp event Runtime.executionContextCreated id=${context.id ?? "?"} name=${context.name ?? ""} origin=${context.origin ?? ""}`;
        }
        if (payload.method === "Runtime.executionContextDestroyed") {
            return `[miniapp] [DEBUG] cdp event Runtime.executionContextDestroyed id=${payload.params?.executionContextId ?? "?"}`;
        }
        if (payload.method === "Runtime.executionContextsCleared") {
            return "[miniapp] [DEBUG] cdp event Runtime.executionContextsCleared";
        }
        if (payload.method === "Runtime.exceptionThrown") {
            return `[miniapp] [DEBUG] cdp event Runtime.exceptionThrown text=${payload.params?.exceptionDetails?.text ?? ""}`;
        }
        return `[miniapp] [DEBUG] cdp event ${payload.method}`;
    }
    if (typeof payload.id === "number") {
        if (payload.error) {
            return `[miniapp] [DEBUG] cdp response id=${payload.id} error=${payload.error.message ?? "unknown error"}`;
        }
        return `[miniapp] [DEBUG] cdp response id=${payload.id}`;
    }
    return "[miniapp] [DEBUG] cdp payload";
};
const summarize_debug_message = (message) => {
    if (!message || typeof message !== "object") {
        return String(message);
    }
    const category = message.category;
    const data = message.data ?? {};
    switch (category) {
        case "setupContext":
            return `[miniapp] [DEBUG] setupContext configure_js_len=${typeof data.configure_js === "string" ? data.configure_js.length : 0} register_interface=${data.register_interface?.obj_name ?? "<unknown>"}`;
        case "addJsContext":
            return `[miniapp] [DEBUG] addJsContext id=${data.jscontext_id ?? ""} name=${data.jscontext_name ?? ""}`;
        case "removeJsContext":
            return `[miniapp] [DEBUG] removeJsContext id=${data.jscontext_id ?? ""}`;
        case "connectJsContext":
            return `[miniapp] [DEBUG] connectJsContext id=${data.jscontext_id ?? ""}`;
        case "chromeDevtools":
            return `[miniapp] [DEBUG] outbound cdp jscontext_id=${data.jscontext_id ?? ""}`;
        case "chromeDevtoolsResult":
            if (typeof data.payload === "string") {
                return summarize_cdp_payload(data.payload);
            }
            return "[miniapp] [DEBUG] chromeDevtoolsResult";
        default:
            return `[miniapp] [DEBUG] ${String(category ?? "unknown")}`;
    }
};
const debug_server = (options, logger) => {
    const wss = new ws_1.WebSocketServer({ port: options.debugPort });
    logger.info(`[server] debug server running on ws://localhost:${options.debugPort}`);
    logger.info(`[server] debug server waiting for miniapp to connect...`);
    let messageCounter = 0;
    const onMessage = (message) => {
        let unwrappedData = null;
        try {
            const decodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.decode(message);
            unwrappedData = codex.unwrapDebugMessageData(decodedData);
            const summary = summarize_debug_message(unwrappedData);
            if (summary) {
                logger.main_debug(summary);
            }
        }
        catch (e) {
            logger.error(`[miniapp] miniapp client err: ${e}`);
            logger.main_debug(`[miniapp] undecoded raw message (hex): ${bufferToHexString(message).slice(0, 320)}`);
        }
        if (unwrappedData === null) {
            return;
        }
        debugMessageEmitter.emit("miniappmessage", unwrappedData);
        if (unwrappedData.category === "chromeDevtoolsResult") {
            // need to proxy to CDP client
            debugMessageEmitter.emit("cdpmessage", unwrappedData.data.payload);
        }
    };
    wss.on("connection", (ws) => {
        logger.info("[miniapp] miniapp client connected");
        debugMessageEmitter.transportState.miniappClientCount += 1;
        debugMessageEmitter.transportState.miniappConnected =
            debugMessageEmitter.transportState.miniappClientCount > 0;
        debugMessageEmitter.emit("miniappconnected");
        ws.on("message", onMessage);
        ws.on("error", (err) => {
            logger.error("[miniapp] miniapp client err:", err);
        });
        ws.on("close", () => {
            logger.info("[miniapp] miniapp client disconnected");
            debugMessageEmitter.transportState.miniappClientCount = Math.max(0, debugMessageEmitter.transportState.miniappClientCount - 1);
            debugMessageEmitter.transportState.miniappConnected =
                debugMessageEmitter.transportState.miniappClientCount > 0;
            debugMessageEmitter.emit("miniappdisconnected");
        });
    });
    debugMessageEmitter.on("proxymessage", (message) => {
        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === ws_1.default.OPEN) {
                    let category = "chromeDevtools";
                    let rawPayload;
                    if (typeof message === "string") {
                        rawPayload = {
                            jscontext_id: "",
                            op_id: Math.round(100 * Math.random()),
                            payload: message.toString(),
                        };
                    }
                    else {
                        const data = message.data != null && typeof message.data === "object"
                            ? message.data
                            : {};
                        category = message.category != null ? message.category : "chromeDevtools";
                        if (category === "chromeDevtools") {
                            rawPayload = {
                                jscontext_id: String(data.jscontext_id ?? ""),
                                op_id: Math.round(100 * Math.random()),
                                payload: String(data.payload ?? ""),
                            };
                        }
                        else {
                            rawPayload = {
                                jscontext_id: String(data.jscontext_id ?? ""),
                            };
                        }
                    }
                    logger.main_debug(rawPayload);
                    const wrappedData = codex.wrapDebugMessageData(rawPayload, category, 0);
                    const outData = {
                        seq: ++messageCounter,
                        category,
                        data: wrappedData.buffer,
                        compressAlgo: 0,
                        originalSize: wrappedData.originalSize,
                    };
                    const encodedData = messageProto.mmbizwxadevremote.WARemoteDebug_DebugMessage.encode(outData).finish();
                    client.send(encodedData, { binary: true });
                }
            });
    });
};
function wsMessageToUtf8(message) {
    if (Buffer.isBuffer(message))
        return message.toString("utf8");
    if (message instanceof ArrayBuffer)
        return Buffer.from(message).toString("utf8");
    if (typeof message === "string")
        return message;
    return String(message);
}
const proxy_server = (options, logger) => {
    const wss = new ws_1.WebSocketServer({ port: options.cdpPort });
    logger.info(`[server] proxy server running on ws://localhost:${options.cdpPort}`);
    logger.info(`[server] link: devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${options.cdpPort}`);
    const onMessage = (message) => {
        /** ws 库常把文本帧当成 Buffer，必须转成 string，否则 proxymessage 走非 string 分支导致 payload 为空、CDP 永不回包 */
        debugMessageEmitter.emit("proxymessage", wsMessageToUtf8(message));
    };
    wss.on("connection", (ws) => {
        logger.info("[cdp] CDP client connected");
        debugMessageEmitter.transportState.cdpClientCount += 1;
        debugMessageEmitter.transportState.cdpClientConnected =
            debugMessageEmitter.transportState.cdpClientCount > 0;
        debugMessageEmitter.emit("cdpClientConnected", { ws });
        ws.on("message", onMessage);
        ws.on("error", (err) => {
            logger.error("[cdp] CDP client err:", err);
        });
        ws.on("close", () => {
            logger.info("[cdp] CDP client disconnected");
            debugMessageEmitter.transportState.cdpClientCount = Math.max(0, debugMessageEmitter.transportState.cdpClientCount - 1);
            debugMessageEmitter.transportState.cdpClientConnected =
                debugMessageEmitter.transportState.cdpClientCount > 0;
            debugMessageEmitter.emit("cdpClientDisconnected", { ws });
        });
    });
    debugMessageEmitter.on("cdpmessage", (message) => {
        wss &&
            wss.clients.forEach((client) => {
                if (client.readyState === ws_1.default.OPEN) {
                    // send CDP message to devtools
                    client.send(message);
                }
            });
    });
};
const frida_server = async (options, logger) => {
    const localDevice = await frida.getLocalDevice();
    const processes = await localDevice.enumerateProcesses({
        scope: frida.Scope.Metadata,
    });
    const wmpfProcesses = processes.filter((process) => process.name === "WeChatAppEx.exe");
    const wmpfPids = wmpfProcesses.map((p) => p.parameters.ppid ? p.parameters.ppid : 0);
    // find the parent process
    const wmpfPid = wmpfPids
        .sort((a, b) => wmpfPids.filter((v) => v === a).length -
        wmpfPids.filter((v) => v === b).length)
        .pop();
    if (wmpfPid === undefined) {
        throw new Error("[frida] WeChatAppEx.exe process not found");
        return;
    }
    const wmpfProcess = processes.filter((process) => process.pid === wmpfPid)[0];
    const wmpfProcessPath = wmpfProcess.parameters.path;
    const wmpfVersionMatch = wmpfProcessPath
        ? wmpfProcessPath.match(/\d+/g)
        : "";
    const wmpfVersion = wmpfVersionMatch
        ? new Number(wmpfVersionMatch.pop())
        : 0;
    if (wmpfVersion === 0) {
        throw new Error("[frida] error in find wmpf version");
        return;
    }
    // attach to process
    const session = await localDevice.attach(Number(wmpfPid));
    // find hook script（必须用 __dirname：从 run.cjs 入口 require 时 require.main 指向 run.cjs，会错到仓库外）
    const projectRoot = node_path_1.default.join(__dirname, "..");
    let scriptContent = null;
    try {
        scriptContent = (await node_fs_1.promises.readFile(node_path_1.default.join(projectRoot, "frida/hook.js"))).toString();
    }
    catch (e) {
        throw new Error("[frida] hook script not found");
        return;
    }
    let configContent = null;
    try {
        configContent = (await node_fs_1.promises.readFile(node_path_1.default.join(projectRoot, "frida/config", `addresses.${wmpfVersion}.json`))).toString();
        configContent = JSON.stringify(JSON.parse(configContent));
    }
    catch (e) {
        throw new Error(`[frida] version config not found: ${wmpfVersion}`);
    }
    if (scriptContent === null || configContent === null) {
        throw new Error("[frida] unable to find hook script");
        return;
    }
    // load script
    const script = await session.createScript(scriptContent.replace("@@CONFIG@@", configContent));
    script.message.connect((message) => {
        if (message.type === "error") {
            logger.error("[frida client]", message);
            return;
        }
        logger.frida_debug("[frida client]", message.payload);
    });
    await script.load();
    logger.info(`[frida] script loaded, WMPF version: ${wmpfVersion}, pid: ${wmpfPid}`);
    logger.info(`[frida] you can now open any miniapps`);
};
const is_retryable_frida_error = (error) => {
    const message = String(error instanceof Error ? error.message : error);
    return message.includes("WeChatAppEx.exe process not found") ||
        message.includes("unable to attach") ||
        message.includes("process not found") ||
        message.includes("process has terminated");
};
const start_frida_server_with_retry = (options, logger) => {
    let attempt = 0;
    let lastMessage = "";
    void (async () => {
        while (true) {
            attempt += 1;
            try {
                await frida_server(options, logger);
                return;
            }
            catch (error) {
                const message = String(error instanceof Error ? error.message : error);
                if (!is_retryable_frida_error(error)) {
                    logger.error("[frida] startup failed:", error);
                    return;
                }
                if (message !== lastMessage || attempt === 1) {
                    logger.info(`[frida] ${message}，${FRIDA_RETRY_MS}ms 后重试`);
                    lastMessage = message;
                }
                await new Promise((resolve) => setTimeout(resolve, FRIDA_RETRY_MS));
            }
        }
    })();
};
const main = async () => {
    const options = (0, cli_1.parse_cli_options)();
    const logger = (0, logger_1.create_logger)(options);
    debug_server(options, logger);
    proxy_server(options, logger);
    (0, cdp_automation_1.start_cdp_automation)(debugMessageEmitter, options, logger);
    start_frida_server_with_retry(options, logger);
};
(async () => {
    await main();
})();
exports.debugMessageEmitter = debugMessageEmitter;
