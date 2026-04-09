"use strict";

const fs = require("node:fs");
const path = require("node:path");

let loaded = false;

function decodeQuotedValue(raw, quote) {
  const body = raw.slice(1, -1);
  if (quote === '"') {
    return body
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function stripInlineComment(raw) {
  const idx = raw.search(/\s#/);
  if (idx < 0) return raw;
  return raw.slice(0, idx).trimEnd();
}

function parseEnvText(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) {
      line = line.slice(7).trim();
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eqIndex + 1).trim();
    if (!value) {
      out[key] = "";
      continue;
    }
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value[value.length - 1] === quote && value.length >= 2) {
      out[key] = decodeQuotedValue(value, quote);
      continue;
    }
    out[key] = stripInlineComment(value);
  }
  return out;
}

function applyEnvFile(filePath, protectedKeys) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = parseEnvText(text);
  const keys = Object.keys(parsed);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (protectedKeys.has(key)) continue;
    process.env[key] = parsed[key];
  }
  return true;
}

function resolveEnvFile(projectRoot, rawPath) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.join(projectRoot, rawPath);
}

function loadEnvFiles(projectRoot) {
  if (loaded) return;
  loaded = true;

  const root = projectRoot || __dirname;
  const protectedKeys = new Set(Object.keys(process.env));
  const files = [
    path.join(root, ".env"),
    path.join(root, ".env.local"),
  ];
  const explicitFile = resolveEnvFile(root, process.env.FARM_ENV_FILE || "");
  if (explicitFile) files.push(explicitFile);

  for (let i = 0; i < files.length; i += 1) {
    applyEnvFile(files[i], protectedKeys);
  }
}

module.exports = {
  loadEnvFiles,
};
