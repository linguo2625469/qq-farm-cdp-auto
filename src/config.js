/**
 * 配置：环境变量优先，便于本地与部署切换。
 *
 * FARM_CDP_WS          与 wmpf 的 CDP 代理一致，默认 ws://127.0.0.1:62000
 * FARM_GATEWAY_HOST    网关监听地址，默认 127.0.0.1（勿对公网暴露）
 * FARM_GATEWAY_PORT    HTTP + WebSocket 同端口，默认 8787（页面 http://127.0.0.1:8787/ ，WS 路径 /ws）
 * FARM_EXECUTION_CONTEXT_ID  可选，小游戏 JS 上下文的 Runtime.executionContextId（数字）
 * FARM_GATEWAY_CONTEXT_NAME  自动扫描时匹配的 jscontext 名称，默认 gameContext（与 wmpf --auto-context-name 一致）
 * FARM_GATEWAY_USE_WMPF_BRIDGE  设为 0 时强制走直连 ws:// CDP（旧行为）；默认启用 wmpf 桥接
 * FARM_PING_CONTEXT_WAIT_MS  ping 时最多等待小游戏上下文探测完成的毫秒数（0=不等待，仅返回当前快照）
 * FARM_RUNTIME_TARGET   运行时目标：cdp | qq_ws | auto，默认 cdp
 * FARM_QQ_WS_PATH       QQ 小程序宿主接入路径，默认 /miniapp
 * FARM_QQ_WS_READY_TIMEOUT_MS  等待 QQ 宿主就绪超时，默认 15000ms
 * FARM_QQ_WS_CALL_TIMEOUT_MS   QQ 宿主单次 RPC 超时，默认 15000ms
 * FARM_QQ_GAME_JS       QQ 小程序 game.js 目标路径（用于一键打补丁）
 * FARM_QQ_HOST_WS_URL   生成 QQ 宿主 bundle 时写入的本地 WebSocket 地址
 * FARM_QQ_HOST_VERSION  QQ 宿主版本号，默认 qq-host-1
 * FARM_QQ_BUNDLE_OUT    生成 bundle 的默认输出路径
 */

function parseIntEnv(name, defaultValue) {
  const v = process.env[name];
  if (v == null || v === "") return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

function getConfig() {
  return {
    cdpWsUrl: process.env.FARM_CDP_WS || "ws://127.0.0.1:62000",
    gatewayHost: process.env.FARM_GATEWAY_HOST || "127.0.0.1",
    gatewayPort: parseIntEnv("FARM_GATEWAY_PORT", 8787),
    /** @type {number | undefined} */
    executionContextId: (() => {
      const raw = process.env.FARM_EXECUTION_CONTEXT_ID;
      if (raw == null || raw === "") return undefined;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : undefined;
    })(),
    /** 单次 CDP 请求超时（毫秒）。默认收紧到 8s，避免网页端注入长时间卡死。 */
    cdpTimeoutMs: parseIntEnv("FARM_CDP_TIMEOUT_MS", 8_000),
    /** 与 wmpf 自动农场一致，用于 waitForMiniappJsContext / selectExecutionContext */
    gatewayContextName: process.env.FARM_GATEWAY_CONTEXT_NAME || "gameContext",
    /** 为 "0" 或 "false" 时禁用 wmpf InternalCdpClient 桥接 */
    useWmpfCdpBridge: !/^0|false$/i.test(String(process.env.FARM_GATEWAY_USE_WMPF_BRIDGE ?? "1")),
    /** ping 内轮询 getStatusSnapshot，直到 ctx 就绪或失败；默认 8000ms，0 表示不等待 */
    pingContextWaitMs: parseIntEnv("FARM_PING_CONTEXT_WAIT_MS", 8000),
    runtimeTarget: (() => {
      const raw = String(process.env.FARM_RUNTIME_TARGET || "cdp").trim().toLowerCase();
      return ["cdp", "qq_ws", "auto"].includes(raw) ? raw : "cdp";
    })(),
    qqWsPath: process.env.FARM_QQ_WS_PATH || "/miniapp",
    qqWsReadyTimeoutMs: parseIntEnv("FARM_QQ_WS_READY_TIMEOUT_MS", 15_000),
    qqWsCallTimeoutMs: parseIntEnv("FARM_QQ_WS_CALL_TIMEOUT_MS", 15_000),
    qqGameJsPath: process.env.FARM_QQ_GAME_JS || "",
    qqHostWsUrl: process.env.FARM_QQ_HOST_WS_URL || "",
    qqHostVersion: process.env.FARM_QQ_HOST_VERSION || "qq-host-1",
    qqBundleOutPath: process.env.FARM_QQ_BUNDLE_OUT || "",
  };
}

module.exports = { getConfig };
