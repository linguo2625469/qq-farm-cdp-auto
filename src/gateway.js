/**
 * HTTP 静态页（public/）+ WebSocket（路径 /ws）→ CDP → 小游戏。
 *
 * WS 消息（JSON 文本）：
 * - { "id": "任意", "op": "ping" }
 * - { "id": "任意", "op": "eval", "code": "return typeof gameCtl" }
 * - { "id": "任意", "op": "call", "path": "gameCtl.getFarmStatus", "args": [{ "includeGrids": true }] }
 * - { "id": "任意", "op": "injectFile", "path": "button.js" }
 */

const http = require("node:http");
const fsSync = require("node:fs");
const WebSocket = require("ws");
const path = require("node:path");
const fs = require("node:fs/promises");
const { CdpSession } = require("./cdp-session");
const { WmpfCdpSession } = require("./cdp-wmpf-session");
const { AutoFarmManager } = require("./auto-farm-manager");
const { PreviewManager } = require("./preview-manager");
const { QqWsSession } = require("./qq-ws-session");
const { ensureGameCtl, callGameCtl } = require("./game-ctl-utils");
const { buildQqBundle, getQqBundleState, patchQqGameFile, resolveQqPatchTarget } = require("./qq-bundle");
const { QQ_RPC_GAME_CTL_METHODS } = require("./qq-rpc-spec");

const WS_PATH = "/ws";
const REQUIRED_GAME_CTL_METHODS = [...QQ_RPC_GAME_CTL_METHODS];

/** 农场功能开关默认值（与页面一致；可 POST /api/farm-config 持久化） */
const FARM_CONFIG_DEFAULT = {
  autoInjectButton: false,
  showLandOverlay: true,
  enableOneClickHarvest: true,
  enableFriendSteal: false,
  verboseLog: false,
  autoFarmOwnEnabled: true,
  autoFarmFriendEnabled: false,
  autoFarmOwnIntervalSec: 30,
  autoFarmFriendIntervalSec: 90,
  autoFarmMaxFriends: 5,
  autoFarmEnterWaitMs: 1800,
  autoFarmActionWaitMs: 1200,
  autoFarmRefreshFriendList: true,
  autoFarmReturnHome: true,
  autoFarmStopOnError: false,
};

function farmConfigPath() {
  return path.join(__dirname, "..", "data", "farm-config.json");
}

async function loadFarmConfig() {
  try {
    const raw = await fs.readFile(farmConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { ...FARM_CONFIG_DEFAULT, ...parsed };
    }
  } catch (_) {
    /* 无文件或解析失败 */
  }
  return { ...FARM_CONFIG_DEFAULT };
}

async function saveFarmConfig(partial) {
  const cur = await loadFarmConfig();
  const next = { ...cur, ...(partial && typeof partial === "object" ? partial : {}) };
  const dir = path.join(__dirname, "..", "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(farmConfigPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }
  const parsed = raw ? JSON.parse(raw) : {};
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid body");
  }
  return parsed;
}

function parseRequestUrl(req) {
  return new URL(req.url || "/", "http://127.0.0.1");
}

/**
 * @param {ReturnType<import('./config.js').getConfig>} config
 * @returns {{ emitter: import('node:events').EventEmitter } | null}
 */
function tryLoadWmpfEmitter(config) {
  if (config.runtimeTarget === "qq_ws") {
    return null;
  }
  if (config.useWmpfCdpBridge === false) {
    return null;
  }
  try {
    const wmpf = require(path.join(__dirname, "..", "wmpf", "src", "index.js"));
    if (wmpf && wmpf.debugMessageEmitter) {
      return { emitter: wmpf.debugMessageEmitter };
    }
  } catch (_) {
    /* 单独运行 gateway、未装 wmpf 时忽略 */
  }
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/**
 * @param {ReturnType<import('./config.js').getConfig>} config
 */
function createGateway(config) {
  /** @type {CdpSession | import('./cdp-wmpf-session').WmpfCdpSession | null} */
  let cdp = null;

  const wmpfBridge = tryLoadWmpfEmitter(config);

  const publicRoot = path.join(__dirname, "..", "public");
  const projectRoot = path.join(__dirname, "..");

  /** 并发多次 ensureCdp 时共用同一次 connect，避免重复建会话 */
  let ensureCdpInFlight = null;

  async function ensureCdp() {
    if (cdp) return cdp;
    if (!ensureCdpInFlight) {
      ensureCdpInFlight = (async () => {
        try {
          if (wmpfBridge) {
            cdp = new WmpfCdpSession(config, wmpfBridge.emitter);
          } else {
            cdp = new CdpSession({ url: config.cdpWsUrl, timeoutMs: config.cdpTimeoutMs });
          }
          await cdp.connect();
          return cdp;
        } catch (error) {
          if (cdp) {
            try {
              cdp.close();
            } catch (_) {}
          }
          cdp = null;
          throw error;
        } finally {
          ensureCdpInFlight = null;
        }
      })();
    }
    return ensureCdpInFlight;
  }

  const qqWsSession = new QqWsSession({
    path: config.qqWsPath,
    readyTimeoutMs: config.qqWsReadyTimeoutMs,
    callTimeoutMs: config.qqWsCallTimeoutMs,
  });
  qqWsSession.on("clientConnected", (_snapshot, client) => {
    console.log(`[gateway][qq_ws] client connected: id=${client.id} remote=${client.remoteAddress || "?"}`);
  });
  qqWsSession.on("hello", (_snapshot, client) => {
    const hello = client && client.hello ? client.hello : {};
    const appPlatform = hello.appPlatform || "unknown";
    const ready = hello.gameCtlReady === true ? "ready" : "not_ready";
    const version = hello.version || "?";
    console.log(`[gateway][qq_ws] hello: id=${client.id} appPlatform=${appPlatform} gameCtl=${ready} version=${version}`);
  });
  qqWsSession.on("clientDisconnected", (_snapshot, client) => {
    console.log(`[gateway][qq_ws] client disconnected: id=${client.id}`);
  });
  qqWsSession.on("clientError", (payload) => {
    if (!payload) return;
    console.log(`[gateway][qq_ws] client error: ${payload.error || "unknown"}`);
  });

  function getCdpSnapshot() {
    return cdp && typeof cdp.getStatusSnapshot === "function"
      ? cdp.getStatusSnapshot()
      : null;
  }

  function getQqWsSnapshot() {
    return qqWsSession.getStatusSnapshot();
  }

  function resolveAutomationRuntimeTarget() {
    if (config.runtimeTarget === "qq_ws") return "qq_ws";
    if (config.runtimeTarget === "auto" && qqWsSession.isReady()) return "qq_ws";
    return "cdp";
  }

  async function ensureAutomationSession() {
    const target = resolveAutomationRuntimeTarget();
    if (target === "qq_ws") {
      return await qqWsSession.connect();
    }
    return await ensureCdp();
  }

  function isQqRuntimeSession(session) {
    return session === qqWsSession;
  }

  async function ensureAutomationGameCtl(session) {
    if (isQqRuntimeSession(session)) {
      return await qqWsSession.ensureGameCtl(REQUIRED_GAME_CTL_METHODS);
    }
    return await ensureGameCtl(session, projectRoot, REQUIRED_GAME_CTL_METHODS);
  }

  async function callAutomationGameCtl(session, pathName, args) {
    if (isQqRuntimeSession(session)) {
      return await qqWsSession.call(pathName, args);
    }
    return await callGameCtl(session, pathName, args);
  }

  async function callSelectedRuntimePath(pathName, args) {
    const session = await ensureAutomationSession();
    return await callAutomationGameCtl(session, pathName, args);
  }

  function getAutomationTransportState() {
    return {
      configuredTarget: config.runtimeTarget,
      resolvedTarget: resolveAutomationRuntimeTarget(),
      cdp: getCdpSnapshot(),
      qqWs: getQqWsSnapshot(),
    };
  }

  function getQqBundleSnapshot() {
    return getQqBundleState(config);
  }

  const autoFarmManager = new AutoFarmManager({
    ensureSession: ensureAutomationSession,
    getSession: () => (resolveAutomationRuntimeTarget() === "qq_ws" ? qqWsSession : cdp),
    ensureGameCtl: ensureAutomationGameCtl,
    callGameCtl: callAutomationGameCtl,
    getTransportState: getAutomationTransportState,
    projectRoot,
  });
  const previewManager = new PreviewManager({
    ensureCdp,
    getCdp: () => cdp,
  });
  /** @type {WeakMap<any, Promise<any>>} */
  const previewInputQueues = new WeakMap();
  /** @type {WeakMap<any, { mode: string; session: any; currentX: number; currentY: number; fallbackFrom?: string | null }>} */
  const previewDragSessions = new WeakMap();
  loadFarmConfig()
    .then((savedConfig) => {
      autoFarmManager.updateConfig(savedConfig);
    })
    .catch(() => {});

  /**
   * 在 ensureCdp 尚未执行时，WmpfCdpSession 还未订阅 miniappconnected，会漏掉事件。
   * 在网关层先订阅，小程序或 DevTools 一连上就开始建会话并探测 ctx（与 cdp-wmpf-session 内逻辑叠加无害）。
   */
  function kickEnsureCdpOnTransport() {
    ensureCdp().catch(() => {});
  }
  if (wmpfBridge) {
    wmpfBridge.emitter.on("miniappconnected", kickEnsureCdpOnTransport);
  }

  function wrapEvalExpression(userCode) {
    const body = String(userCode || "").trim();
    return `(async () => {\n${body}\n})()`;
  }

  function wrapCallExpression(dotPath, args) {
    const parts = String(dotPath || "").split(".").filter(Boolean);
    if (parts.length === 0) throw new Error("call.path empty");
    const jsonArgs = JSON.stringify(args ?? []);
    return `(async () => {
      const _path = ${JSON.stringify(parts)};
      let cur = globalThis;
      for (let i = 0; i < _path.length; i++) {
        cur = cur[_path[i]];
        if (cur == null) throw new Error('call path not found at: ' + _path.slice(0, i + 1).join('.'));
      }
      if (typeof cur !== 'function') throw new Error('call path is not a function: ' + _path.join('.'));
      return await cur.apply(null, ${jsonArgs});
    })()`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function clampInt(value, defaultValue, min, max) {
    const n = Number.parseInt(String(value ?? ""), 10);
    const fallback = Number.isFinite(n) ? n : defaultValue;
    return Math.min(max, Math.max(min, fallback));
  }

  function makeTouchPoint(x, y) {
    return {
      x,
      y,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: 1,
    };
  }

  function enqueuePreviewInput(socket, task) {
    const prev = previewInputQueues.get(socket) || Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    previewInputQueues.set(socket, next.finally(() => {
      if (previewInputQueues.get(socket) === next) {
        previewInputQueues.delete(socket);
      }
    }));
    return next;
  }

  async function dispatchCdpTap(session, x, y, hold) {
    const point = makeTouchPoint(x, y);

    try {
      await session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      if (hold > 0) {
        await sleep(hold);
      }
      await session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      return { mode: "touch" };
    } catch (touchError) {
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 0,
      });
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      if (hold > 0) {
        await sleep(hold);
      }
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      return {
        mode: "mouse",
        fallbackFrom: touchError instanceof Error ? touchError.message : String(touchError),
      };
    }
  }

  async function beginCdpDrag(session, x, y) {
    const point = makeTouchPoint(x, y);
    try {
      await session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      return {
        mode: "touch",
        session,
        currentX: x,
        currentY: y,
        fallbackFrom: null,
      };
    } catch (touchError) {
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 0,
      });
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      return {
        mode: "mouse",
        session,
        currentX: x,
        currentY: y,
        fallbackFrom: touchError instanceof Error ? touchError.message : String(touchError),
      };
    }
  }

  async function moveCdpDrag(state, x, y) {
    if (state.mode === "touch") {
      await state.session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [makeTouchPoint(x, y)],
      });
    } else {
      await state.session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
    }
    state.currentX = x;
    state.currentY = y;
  }

  async function endCdpDrag(state, x, y) {
    if (state.currentX !== x || state.currentY !== y) {
      await moveCdpDrag(state, x, y);
    }
    if (state.mode === "touch") {
      await state.session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    } else {
      await state.session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
    }
    state.currentX = x;
    state.currentY = y;
  }

  async function dispatchCdpSwipe(session, x1, y1, x2, y2, durationMs, steps) {
    const startPoint = {
      x: x1,
      y: y1,
      radiusX: 1,
      radiusY: 1,
      force: 1,
      id: 1,
    };
    const totalSteps = Math.max(1, steps);
    const moveDelayMs = totalSteps > 0 ? Math.max(0, Math.round(durationMs / totalSteps)) : 0;

    try {
      await session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [startPoint],
      });
      for (let i = 1; i <= totalSteps; i++) {
        const ratio = i / totalSteps;
        await session.sendCommand("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{
            x: Math.round(x1 + (x2 - x1) * ratio),
            y: Math.round(y1 + (y2 - y1) * ratio),
            radiusX: 1,
            radiusY: 1,
            force: 1,
            id: 1,
          }],
        });
        if (moveDelayMs > 0 && i < totalSteps) {
          await sleep(moveDelayMs);
        }
      }
      await session.sendCommand("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      return { mode: "touch" };
    } catch (touchError) {
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: x1,
        y: y1,
        button: "left",
        buttons: 0,
        clickCount: 0,
      });
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: x1,
        y: y1,
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      for (let i = 1; i <= totalSteps; i++) {
        const ratio = i / totalSteps;
        await session.sendCommand("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(x1 + (x2 - x1) * ratio),
          y: Math.round(y1 + (y2 - y1) * ratio),
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        if (moveDelayMs > 0 && i < totalSteps) {
          await sleep(moveDelayMs);
        }
      }
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: x2,
        y: y2,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      return {
        mode: "mouse",
        fallbackFrom: touchError instanceof Error ? touchError.message : String(touchError),
      };
    }
  }

  /**
   * ping 时若只调 getStatusSnapshot 一次，往往仍是「探测中」：connect() 不等待 _prepareGameContext。
   * 在 wmpf 模式下短轮询快照，便于控制页一次 ping 就看到 ctxId（或 prepareError）。
   */
  async function waitCdpSnapshotForPing(session) {
    const snap0 =
      session && typeof session.getStatusSnapshot === "function"
        ? session.getStatusSnapshot()
        : null;
    const maxMs = config.pingContextWaitMs ?? 0;
    if (!snap0 || maxMs <= 0) return { snap: snap0, timedOut: false };
    if (snap0.mode !== "wmpf_bridge") return { snap: snap0, timedOut: false };
    if (snap0.contextReady) return { snap: snap0, timedOut: false };
    if (snap0.transportConnected === false) return { snap: snap0, timedOut: false };
    if (typeof session.requestPrepare === "function") {
      session.requestPrepare(snap0.prepareError ? "ping_retry" : "ping");
    }

    const deadline = Date.now() + maxMs;
    let snap =
      session && typeof session.getStatusSnapshot === "function"
        ? session.getStatusSnapshot()
        : snap0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      if (typeof session.requestPrepare === "function") {
        session.requestPrepare(snap.prepareError ? "ping_poll_retry" : "ping_poll");
      }
      snap = session.getStatusSnapshot();
      if (snap.contextReady || snap.prepareError) {
        return { snap, timedOut: false };
      }
    }
    return { snap, timedOut: true };
  }

  /**
   * @param {Record<string, unknown>} msg
   */
  async function dispatch(msg, socket) {
    const op = String(msg.op || "");

    if (op === "ping") {
      let timedOut = false;
      let snap = getCdpSnapshot();
      const resolvedRuntimeTarget = resolveAutomationRuntimeTarget();
      if (resolvedRuntimeTarget !== "qq_ws") {
        await ensureCdp();
        const result = await waitCdpSnapshotForPing(cdp);
        snap = result.snap;
        timedOut = result.timedOut;
      }
      return {
        pong: true,
        cdpUrl: config.cdpWsUrl,
        runtimeTarget: config.runtimeTarget,
        resolvedRuntimeTarget,
        cdp: snap,
        qqWs: getQqWsSnapshot(),
        preview: previewManager.getState(),
        cdpProbeTimedOut: timedOut,
      };
    }

    if (op === "eval") {
      const session = await ensureCdp();
      const execOpts = {
        executionContextId: config.executionContextId,
        awaitPromise: true,
      };
      const code = String(msg.code ?? "");
      const expr = wrapEvalExpression(code);
      const value = await session.evaluate(expr, execOpts);
      return value;
    }

    if (op === "call") {
      const p = String(msg.path ?? "");
      const args = Array.isArray(msg.args) ? msg.args : [];
      if (resolveAutomationRuntimeTarget() === "qq_ws") {
        return await callSelectedRuntimePath(p, args);
      }
      const session = await ensureCdp();
      const execOpts = {
        executionContextId: config.executionContextId,
        awaitPromise: true,
      };
      const expr = wrapCallExpression(p, args);
      return await session.evaluate(expr, execOpts);
    }

    if (op === "injectFile") {
      if (resolveAutomationRuntimeTarget() === "qq_ws") {
        throw new Error("injectFile not supported on qq_ws runtime");
      }
      const session = await ensureCdp();
      const execOpts = {
        executionContextId: config.executionContextId,
        awaitPromise: true,
      };
      const rel = String(msg.path ?? "");
      if (!rel) throw new Error("injectFile.path required");
      const base = path.join(__dirname, "..");
      const abs = path.resolve(base, rel);
      if (!abs.startsWith(base)) {
        throw new Error("injectFile.path must stay under project root");
      }
      const script = await fs.readFile(abs, "utf8");
      const expr = `(async () => { ${script}\n; return { injected: true, file: ${JSON.stringify(rel)} }; })()`;
      const value = await session.evaluate(expr, execOpts);
      return value;
    }

    if (op === "previewStatus") {
      return previewManager.getState();
    }

    if (op === "previewStart") {
      return await previewManager.start(socket, msg.options);
    }

    if (op === "previewStop") {
      previewManager.removeSocket(socket);
      return await previewManager.stop("ws");
    }

    if (op === "previewCapture") {
      return await previewManager.capture(msg.options);
    }

    const session = await ensureCdp();

    if (op === "previewTap") {
      const x = Number(msg.x);
      const y = Number(msg.y);
      const hold = msg.hold == null ? 32 : Number(msg.hold);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("previewTap.x / previewTap.y 必须为数字");
      }
      if (!Number.isFinite(hold) || hold < 0) {
        throw new Error("previewTap.hold 必须为非负数字");
      }
      const dispatchResult = await dispatchCdpTap(session, x, y, hold);
      return {
        x,
        y,
        hold,
        result: dispatchResult,
      };
    }

    if (op === "previewDragStart") {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("previewDragStart.x / y 必须为数字");
      }
      return await enqueuePreviewInput(socket, async () => {
        const existing = previewDragSessions.get(socket);
        if (existing) {
          try {
            await endCdpDrag(existing, existing.currentX, existing.currentY);
          } catch (_) {}
          previewDragSessions.delete(socket);
        }
        const state = await beginCdpDrag(session, x, y);
        previewDragSessions.set(socket, state);
        return {
          x,
          y,
          result: {
            mode: state.mode,
            fallbackFrom: state.fallbackFrom || null,
          },
        };
      });
    }

    if (op === "previewDragMove") {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("previewDragMove.x / y 必须为数字");
      }
      return await enqueuePreviewInput(socket, async () => {
        const state = previewDragSessions.get(socket);
        if (!state) {
          throw new Error("当前没有活动中的预览拖动");
        }
        await moveCdpDrag(state, x, y);
        return {
          x,
          y,
          result: {
            mode: state.mode,
            fallbackFrom: state.fallbackFrom || null,
          },
        };
      });
    }

    if (op === "previewDragEnd") {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("previewDragEnd.x / y 必须为数字");
      }
      return await enqueuePreviewInput(socket, async () => {
        const state = previewDragSessions.get(socket);
        if (!state) {
          throw new Error("当前没有活动中的预览拖动");
        }
        await endCdpDrag(state, x, y);
        previewDragSessions.delete(socket);
        return {
          x,
          y,
          result: {
            mode: state.mode,
            fallbackFrom: state.fallbackFrom || null,
          },
        };
      });
    }

    if (op === "previewSwipe") {
      const x1 = Number(msg.x1);
      const y1 = Number(msg.y1);
      const x2 = Number(msg.x2);
      const y2 = Number(msg.y2);
      const durationMs = clampInt(msg.durationMs, 220, 0, 5_000);
      const steps = clampInt(msg.steps, 8, 1, 60);
      if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) {
        throw new Error("previewSwipe.x1/y1/x2/y2 必须为数字");
      }
      const dispatchResult = await dispatchCdpSwipe(session, x1, y1, x2, y2, durationMs, steps);
      return {
        x1,
        y1,
        x2,
        y2,
        durationMs,
        steps,
        result: dispatchResult,
      };
    }

    throw new Error(`unknown op: ${op}`);
  }

  const httpServer = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end();
      return;
    }

    const urlPath = req.url.split("?")[0];

    if (req.method === "GET" && urlPath === "/api/health") {
      if (!cdp && resolveAutomationRuntimeTarget() !== "qq_ws") {
        setImmediate(() => {
          ensureCdp().catch(() => {});
        });
      }
      const payload = {
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        gateway: {
          cdpWsUrl: config.cdpWsUrl,
          wmpfBridge: !!wmpfBridge,
          runtimeTarget: config.runtimeTarget,
          resolvedRuntimeTarget: resolveAutomationRuntimeTarget(),
          qqWsPath: config.qqWsPath,
        },
        cdp: getCdpSnapshot(),
        qqWs: getQqWsSnapshot(),
        qqBundle: getQqBundleSnapshot(),
        autoFarm: autoFarmManager.getState(),
        preview: previewManager.getState(),
        cdpSessionInitialized: cdp != null,
        cdpWarmPending: cdp == null,
        wsClients: wss.clients.size,
      };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (req.method === "GET" && urlPath === "/api/qq-bundle") {
      try {
        const built = buildQqBundle({
          config,
          projectRoot,
        });
        const asRaw = req.url.includes("raw=1");
        const asDownload = req.url.includes("download=1");
        if (asRaw || asDownload) {
          const filename = built.meta.defaultFilename || "qq-miniapp-bootstrap.js";
          res.writeHead(200, {
            "Content-Type": "text/javascript; charset=utf-8",
            "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${filename}"`,
          });
          res.end(built.bundleText);
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data: built.meta }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && urlPath === "/api/qq-miniapp/find") {
      try {
        const requestUrl = parseRequestUrl(req);
        const target = resolveQqPatchTarget({
          targetPath: requestUrl.searchParams.get("targetPath"),
          appId: requestUrl.searchParams.get("appid"),
          fallbackTargetPath: config.qqGameJsPath,
          fallbackAppId: config.qqAppId,
          srcRoot: requestUrl.searchParams.get("srcRoot") || config.qqMiniappSrcRoot,
        });
        if (!target.targetPath) {
          throw new Error(target.targetError || "未找到可用的 QQ game.js");
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data: target }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && urlPath === "/api/qq-bundle/patch") {
      try {
        const parsed = await readJsonBody(req);
        const target = resolveQqPatchTarget({
          targetPath: parsed.targetPath,
          appId: parsed.appId,
          fallbackTargetPath: config.qqGameJsPath,
          fallbackAppId: config.qqAppId,
          srcRoot: parsed.srcRoot || config.qqMiniappSrcRoot,
        });
        if (!target.targetPath) {
          throw new Error(target.targetError || "未配置 QQ game.js 路径，也未提供 QQ appid");
        }
        const built = buildQqBundle({
          config,
          projectRoot,
        });
        const patch = patchQqGameFile(target.targetPath, built.bundleText, {
          noBackup: !!parsed.noBackup,
        });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          ok: true,
          data: {
            meta: built.meta,
            target,
            patch,
          },
        }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && urlPath === "/api/farm-config") {
      try {
        const data = await loadFarmConfig();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && urlPath === "/api/farm-config") {
      try {
        const parsed = await readJsonBody(req);
        const data = await saveFarmConfig(parsed);
        autoFarmManager.updateConfig(data);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && urlPath === "/api/auto-farm") {
      try {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data: autoFarmManager.getState() }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === "POST" && urlPath === "/api/auto-farm") {
      try {
        const parsed = await readJsonBody(req);
        const action = String(parsed.action || "update").trim();
        let savedConfig = null;
        if (parsed.config && typeof parsed.config === "object") {
          savedConfig = await saveFarmConfig(parsed.config);
          autoFarmManager.updateConfig(savedConfig);
        }

        let data;
        if (action === "start") {
          data = autoFarmManager.start(savedConfig || parsed.config);
        } else if (action === "stop") {
          data = autoFarmManager.stop("api");
        } else if (action === "runOnce") {
          data = await autoFarmManager.runOnce(savedConfig || parsed.config);
        } else if (action === "update") {
          if (!savedConfig && parsed.config && typeof parsed.config === "object") {
            autoFarmManager.updateConfig(parsed.config);
          }
          data = autoFarmManager.getState();
        } else {
          throw new Error(`unknown auto-farm action: ${action}`);
        }

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, data, savedConfig }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }

    let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
    rel = path.normalize(rel);
    if (rel.includes("..") || path.isAbsolute(rel)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const filePath = path.join(publicRoot, rel);
    if (!filePath.startsWith(publicRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      if (!fsSync.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const stat = fsSync.statSync(filePath);
      if (stat.isDirectory()) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      const ext = path.extname(filePath);
      res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
      fsSync.createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });

  qqWsSession.attach();

  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const urlPath = req && req.url ? req.url.split("?")[0] : "";
    if (urlPath === WS_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
    if (urlPath === config.qqWsPath) {
      qqWsSession.handleUpgrade(req, socket, head);
      return;
    }
    socket.destroy();
  });

  wss.on("connection", (socket) => {
    socket.on("message", async (data) => {
      let raw = data;
      if (Buffer.isBuffer(data)) raw = data.toString("utf8");
      else if (data instanceof ArrayBuffer) raw = Buffer.from(data).toString("utf8");

      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        socket.send(
          JSON.stringify({
            id: null,
            ok: false,
            error: "invalid JSON",
            detail: String(e),
          }),
        );
        return;
      }

      const reqId = msg.id != null ? msg.id : null;

      try {
        const result = await dispatch(msg, socket);
        socket.send(JSON.stringify({ id: reqId, ok: true, result }));
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        socket.send(
          JSON.stringify({
            id: reqId,
            ok: false,
            error: err.message,
            detail: /** @type any */ (err).exceptionDetails ?? undefined,
          }),
        );
      }
    });
    socket.on("close", () => {
      const dragState = previewDragSessions.get(socket);
      if (dragState) {
        previewDragSessions.delete(socket);
        void endCdpDrag(dragState, dragState.currentX, dragState.currentY).catch(() => {});
      }
      previewManager.removeSocket(socket);
      const state = previewManager.getState();
      if (state.running && state.subscriberCount === 0) {
        void previewManager.stop("all sockets closed");
      }
    });
  });

  return {
    httpServer,
    wss,
    close: () => {
      autoFarmManager.stop("gateway close");
      void previewManager.close();
      if (wmpfBridge) {
        wmpfBridge.emitter.off("miniappconnected", kickEnsureCdpOnTransport);
      }
      qqWsSession.close();
      wss.close();
      httpServer.close();
      if (cdp) cdp.close();
      cdp = null;
    },
    getCdp: () => cdp,
    getQqWsSession: () => qqWsSession,
  };
}

module.exports = { createGateway, WS_PATH };
