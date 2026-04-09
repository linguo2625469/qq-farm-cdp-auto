#!/usr/bin/env node
/**
 * 单进程同时启动 wmpf（Frida + 调试 + CDP）与 WebSocket 网关，无需子进程 spawn。
 */
"use strict";

require("./load-env.cjs").loadEnvFiles(__dirname);
require("./apply-cli-overrides.cjs").applyCliOverrides(process.argv.slice(2));

const { getConfig } = require("./src/config");
const config = getConfig();

if (config.runtimeTarget !== "qq_ws") {
  require("./wmpf/src/index.js");
}
require("./src/index.js");
