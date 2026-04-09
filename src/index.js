#!/usr/bin/env node

require("../load-env.cjs").loadEnvFiles(require("node:path").join(__dirname, ".."));
require("../apply-cli-overrides.cjs").applyCliOverrides(process.argv.slice(2));

const path = require("node:path");
const { getConfig } = require("./config");
const { createGateway, WS_PATH } = require("./gateway");

const config = getConfig();

let wmpfBridgeOk = false;
if (config.runtimeTarget !== "qq_ws" && config.useWmpfCdpBridge !== false) {
  try {
    const wmpf = require(path.join(__dirname, "..", "wmpf", "src", "index.js"));
    wmpfBridgeOk = !!(wmpf && wmpf.debugMessageEmitter);
  } catch (_) {
    wmpfBridgeOk = false;
  }
}

const { httpServer, close } = createGateway(config);

httpServer.listen(config.gatewayPort, config.gatewayHost, () => {
  const host = config.gatewayHost;
  const port = config.gatewayPort;
  console.log(`[gateway] 控制页: http://${host}:${port}/`);
  console.log(`[gateway] WebSocket: ws://${host}:${port}${WS_PATH}`);
  console.log(`[gateway] QQ 宿主 WebSocket: ws://${host}:${port}${config.qqWsPath}`);
  console.log(`[gateway] CDP target: ${config.cdpWsUrl}`);
  console.log(`[gateway] 运行时目标: ${config.runtimeTarget}`);
  if (config.runtimeTarget === "qq_ws") {
    console.log("[gateway] CDP 模式: 已禁用（qq_ws 运行时不启动 wmpf / frida）");
  } else if (wmpfBridgeOk) {
    console.log(
      `[gateway] CDP 模式: wmpf 桥接（含 jscontext_id + 自动探测 gameContext，名称: ${config.gatewayContextName}）`,
    );
  } else {
    console.log("[gateway] CDP 模式: 直连 WebSocket（无 wmpf 桥接时或已设置 FARM_GATEWAY_USE_WMPF_BRIDGE=0）");
  }
  if (config.executionContextId != null) {
    console.log(`[gateway] executionContextId: ${config.executionContextId}`);
  } else {
    console.log(`[gateway] executionContextId: (自动 / 未设置 FARM_EXECUTION_CONTEXT_ID)`);
  }
});

function shutdown() {
  try {
    close();
  } catch (_) {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
