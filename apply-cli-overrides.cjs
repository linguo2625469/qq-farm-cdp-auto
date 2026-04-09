"use strict";

let applied = false;

function readOption(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === name && i + 1 < argv.length) {
      return String(argv[i + 1] || "");
    }
    if (arg.indexOf(name + "=") === 0) {
      return arg.slice(name.length + 1);
    }
  }
  return "";
}

function applyIfPresent(envKey, value) {
  if (value == null || value === "") return;
  process.env[envKey] = String(value);
}

function normalizeRuntime(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "qq" || value === "qq_ws") return "qq_ws";
  if (value === "wx" || value === "wechat" || value === "cdp") return "cdp";
  if (value === "auto") return "auto";
  return "";
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function applyCliOverrides(argv) {
  if (applied) return;
  applied = true;

  const args = Array.isArray(argv) ? argv : process.argv.slice(2);

  const runtime =
    normalizeRuntime(readOption(args, "--runtime")) ||
    (hasFlag(args, "--qq") ? "qq_ws" : "") ||
    (hasFlag(args, "--wx") ? "cdp" : "");
  applyIfPresent("FARM_RUNTIME_TARGET", runtime);

  applyIfPresent("FARM_GATEWAY_PORT", readOption(args, "--gateway-port"));
  applyIfPresent("FARM_GATEWAY_HOST", readOption(args, "--gateway-host"));
  applyIfPresent("FARM_CDP_WS", readOption(args, "--cdp-ws"));
  applyIfPresent("FARM_QQ_GAME_JS", readOption(args, "--qq-game-js"));
  applyIfPresent("FARM_QQ_HOST_WS_URL", readOption(args, "--qq-host-ws-url"));
  applyIfPresent("FARM_QQ_HOST_VERSION", readOption(args, "--qq-host-version"));
}

module.exports = {
  applyCliOverrides,
};
