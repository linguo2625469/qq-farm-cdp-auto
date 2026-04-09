"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { QQ_RPC_ALLOWED_PATHS } = require("./qq-rpc-spec");

const MARKER_START = "// >>> QQ_FARM_AUTOMATION START >>>";
const MARKER_END = "// <<< QQ_FARM_AUTOMATION END <<<";
const DEFAULT_QQ_BUNDLE_FILENAME = "qq-miniapp-bootstrap.js";

function replaceAll(source, token, value) {
  return String(source).split(token).join(value);
}

function escapeDoubleQuotedString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sha1Hex(source) {
  return crypto.createHash("sha1").update(source, "utf8").digest("hex");
}

function normalizeWsUrl(rawUrl, config) {
  if (rawUrl) return String(rawUrl).trim();
  return `ws://127.0.0.1:${config.gatewayPort}${config.qqWsPath}`;
}

function loadSource(projectRoot, relPath) {
  return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
}

function renderHostSource(hostTemplate, replacements) {
  let text = String(hostTemplate);
  Object.keys(replacements).forEach((key) => {
    text = replaceAll(text, key, replacements[key]);
  });
  return text;
}

function getQqBundleState(config) {
  const outputPath = config.qqBundleOutPath || path.join(path.join(__dirname, ".."), "dist", DEFAULT_QQ_BUNDLE_FILENAME);
  return {
    defaultFilename: DEFAULT_QQ_BUNDLE_FILENAME,
    outputPath,
    hostWsUrl: normalizeWsUrl(config.qqHostWsUrl, config),
    hostVersion: config.qqHostVersion || "qq-host-1",
    targetConfigured: !!config.qqGameJsPath,
    targetPath: config.qqGameJsPath || null,
  };
}

function buildQqBundle(options = {}) {
  const projectRoot = options.projectRoot || path.join(__dirname, "..");
  const config = options.config;
  const state = getQqBundleState(config);
  const hostWsUrl = normalizeWsUrl(options.hostWsUrl || state.hostWsUrl, config);
  const hostVersion = options.hostVersion || state.hostVersion || "qq-host-1";
  const buttonSource = loadSource(projectRoot, "button.js");
  const hostTemplate = loadSource(projectRoot, "qq-host.js");
  const hashSeed = JSON.stringify({
    hostVersion,
    hostWsUrl,
    allowedPaths: QQ_RPC_ALLOWED_PATHS,
    buttonSha1: sha1Hex(buttonSource),
    hostTemplateSha1: sha1Hex(hostTemplate),
  });
  const scriptHash = sha1Hex(hashSeed).slice(0, 16);
  const generatedAt = new Date().toISOString();

  const hostSource = renderHostSource(hostTemplate, {
    "__QQ_FARM_ALLOWED_RPC_PATHS__": JSON.stringify(QQ_RPC_ALLOWED_PATHS, null, 2),
    "__QQ_FARM_HOST_WS_URL__": escapeDoubleQuotedString(hostWsUrl),
    "__QQ_FARM_HOST_VERSION__": escapeDoubleQuotedString(hostVersion),
    "__QQ_FARM_BUNDLE_HASH__": scriptHash,
  });

  const bundleBody = `;(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : Function("return this")();
  var meta = {
    hostVersion: ${JSON.stringify(hostVersion)},
    scriptHash: ${JSON.stringify(scriptHash)},
    generatedAt: ${JSON.stringify(generatedAt)},
    wsUrl: ${JSON.stringify(hostWsUrl)}
  };
  root.__qqFarmBundleMeta = meta;

  function attachScriptHash() {
    var ctl = root.gameCtl || (root.GameGlobal && root.GameGlobal.gameCtl);
    if (!ctl || typeof ctl !== "object") return false;
    ctl.__scriptHash = meta.scriptHash;
    return true;
  }

  function installButtonLayer() {
    if (attachScriptHash()) return true;
    try {
${buttonSource.split("\n").map((line) => "      " + line).join("\n")}
      attachScriptHash();
      return true;
    } catch (error) {
      try {
        console.log("[qq-bundle][warn] button.js install deferred", error && error.message ? error.message : String(error));
      } catch (_) {}
      return false;
    }
  }

  function ensureButtonLayer() {
    var attempts = 0;
    var maxAttempts = 120;
    function tick() {
      if (installButtonLayer()) return;
      attempts += 1;
      if (attempts >= maxAttempts) return;
      setTimeout(tick, 500);
    }
    tick();
  }

  ensureButtonLayer();
})();

${hostSource}
`;

  const bundleText = [
    MARKER_START,
    `// generatedAt=${generatedAt}`,
    `// scriptHash=${scriptHash}`,
    bundleBody.trimEnd(),
    MARKER_END,
    "",
  ].join("\n");

  return {
    bundleText,
    meta: {
      generatedAt,
      scriptHash,
      hostWsUrl,
      hostVersion,
      defaultFilename: DEFAULT_QQ_BUNDLE_FILENAME,
      outputPath: state.outputPath,
      targetConfigured: state.targetConfigured,
      targetPath: state.targetPath,
    },
  };
}

function ensureParentDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function patchQqGameFile(targetPath, bundleText, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const original = fs.readFileSync(absoluteTarget, "utf8");
  const hasMarkers = original.includes(MARKER_START) && original.includes(MARKER_END);
  let next = "";

  if (hasMarkers) {
    const startIndex = original.indexOf(MARKER_START);
    const endIndex = original.indexOf(MARKER_END);
    next =
      original.slice(0, startIndex) +
      bundleText +
      original.slice(endIndex + MARKER_END.length);
  } else {
    next = `${original.trimEnd()}\n\n${bundleText}`;
  }

  let backupPath = null;
  if (!options.noBackup) {
    backupPath = absoluteTarget + ".qq-farm.bak";
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, original, "utf8");
    }
  }

  fs.writeFileSync(absoluteTarget, next, "utf8");
  return {
    targetPath: absoluteTarget,
    backupPath,
    replacedExistingBlock: hasMarkers,
  };
}

module.exports = {
  MARKER_START,
  MARKER_END,
  DEFAULT_QQ_BUNDLE_FILENAME,
  buildQqBundle,
  ensureParentDir,
  getQqBundleState,
  patchQqGameFile,
};
