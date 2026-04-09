#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const projectRoot = path.join(__dirname, "..");
require(path.join(projectRoot, "load-env.cjs")).loadEnvFiles(projectRoot);
require(path.join(projectRoot, "apply-cli-overrides.cjs")).applyCliOverrides(process.argv.slice(2));

const { getConfig } = require(path.join(projectRoot, "src", "config.js"));
const {
  buildQqBundle,
  ensureParentDir,
  patchQqGameFile,
  resolveQqPatchTarget,
} = require(path.join(projectRoot, "src", "qq-bundle.js"));

function parseArgs(argv) {
  const out = {
    target: "",
    appId: "",
    srcRoot: "",
    out: "",
    bundleOnly: false,
    noBackup: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--target" || arg === "-t") {
      out.target = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--out" || arg === "-o") {
      out.out = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--appid" || arg === "--qq-appid") {
      out.appId = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--qq-miniapp-src-root") {
      out.srcRoot = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--bundle-only") {
      out.bundleOnly = true;
      continue;
    }
    if (arg === "--no-backup") {
      out.noBackup = true;
      continue;
    }
  }

  return out;
}

function main() {
  const config = getConfig();
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(args.out || config.qqBundleOutPath || path.join(projectRoot, "dist", "qq-miniapp-bootstrap.js"));
  const built = buildQqBundle({
    config,
    projectRoot,
  });
  const bundleText = built.bundleText;

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, bundleText, "utf8");
  console.log(`[qq-patch] bootstrap bundle written: ${outPath}`);

  const target = resolveQqPatchTarget({
    targetPath: args.target,
    appId: args.appId,
    fallbackTargetPath: config.qqGameJsPath,
    fallbackAppId: config.qqAppId,
    srcRoot: args.srcRoot || config.qqMiniappSrcRoot,
  });

  if (args.bundleOnly || !target.targetPath) {
    if (!target.targetPath) {
      console.log("[qq-patch] no target game.js configured; bundle-only mode");
      if (target.targetError) {
        console.log(`[qq-patch] ${target.targetError}`);
      } else {
        console.log("[qq-patch] set FARM_QQ_GAME_JS / FARM_QQ_APPID or use --target / --qq-appid to patch automatically");
      }
    }
    return;
  }

  if (target.targetMode === "auto") {
    console.log(`[qq-patch] resolved appid ${target.appId} -> ${target.targetPath}`);
  }

  const result = patchQqGameFile(target.targetPath, bundleText, { noBackup: args.noBackup });
  console.log(`[qq-patch] patched target: ${result.targetPath}`);
  console.log(`[qq-patch] mode: ${result.replacedExistingBlock ? "replace" : "append"}`);
  if (!args.noBackup) {
    console.log(`[qq-patch] backup: ${result.targetPath}.qq-farm.bak`);
  }
}

main();
