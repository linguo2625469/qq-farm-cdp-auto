"use strict";

const readline = require("node:readline");
const WebSocket = require("ws");

const PORT = Number(process.env.QQ_WS_TEST_PORT || 18788);
const HOST = process.env.QQ_WS_TEST_HOST || "127.0.0.1";
const PATH = process.env.QQ_WS_TEST_PATH || "/miniapp";

const wss = new WebSocket.Server({
  host: HOST,
  port: PORT,
  path: PATH,
});

let seq = 0;
let activeClientId = null;
const clients = new Map();

function now() {
  return new Date().toISOString();
}

function nextId(prefix) {
  seq += 1;
  return prefix + "-" + String(seq);
}

function log(line, extra) {
  const head = "[" + now().replace("T", " ").replace("Z", "") + "]";
  if (extra === undefined) {
    console.log(head, line);
    return;
  }
  console.log(head, line);
  console.log(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
}

function socketSend(socket, packet) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }
  socket.send(JSON.stringify(packet));
  return true;
}

function sendHelloAck(client, requestId) {
  return socketSend(client.socket, {
    id: requestId || nextId("helloAck"),
    type: "helloAck",
    ts: Date.now(),
    payload: {
      ok: true,
      sessionId: client.id,
      serverTime: now(),
    },
  });
}

function sendPong(client, requestId) {
  return socketSend(client.socket, {
    id: requestId || nextId("pong"),
    type: "pong",
    ts: Date.now(),
    payload: {},
  });
}

function sendPing(client) {
  return socketSend(client.socket, {
    id: nextId("ping"),
    type: "ping",
    ts: Date.now(),
    payload: {},
  });
}

function sendCall(client, pathName, args) {
  return socketSend(client.socket, {
    id: nextId("call"),
    type: "call",
    ts: Date.now(),
    payload: {
      path: pathName,
      args: Array.isArray(args) ? args : [],
    },
  });
}

function listClients() {
  if (clients.size === 0) {
    log("no connected clients");
    return;
  }
  for (const client of clients.values()) {
    const hello = client.hello || {};
    const methods = Array.isArray(hello.availableMethods) ? hello.availableMethods.join(", ") : "";
    log(
      "client " + client.id +
        " active=" + (client.id === activeClientId ? "yes" : "no") +
        " remote=" + (client.remoteAddress || "?") +
        " gameCtlReady=" + (hello.gameCtlReady === true ? "yes" : "no"),
      {
        client: hello.client || null,
        app: hello.app || null,
        version: hello.version || null,
        methods,
      },
    );
  }
}

function getActiveClient() {
  if (activeClientId && clients.has(activeClientId)) {
    return clients.get(activeClientId);
  }
  for (const client of clients.values()) {
    return client;
  }
  return null;
}

function parsePacket(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  return JSON.parse(text);
}

function summarizeResult(packet) {
  const payload = packet && packet.payload && typeof packet.payload === "object" ? packet.payload : {};
  const pathName = payload.path || null;
  if (payload.ok === true) {
    log("result ok" + (pathName ? " " + pathName : ""), payload.data);
    return;
  }
  log("result error" + (pathName ? " " + pathName : ""), payload.error || payload);
}

function handleClientMessage(client, packet) {
  if (!packet || typeof packet !== "object") {
    return;
  }
  if (packet.type === "hello") {
    client.hello = packet.payload && typeof packet.payload === "object" ? packet.payload : {};
    activeClientId = client.id;
    log("hello from " + client.id, client.hello);
    sendHelloAck(client, packet.id);
    return;
  }
  if (packet.type === "ping") {
    log("ping from " + client.id);
    sendPong(client, packet.id);
    return;
  }
  if (packet.type === "pong") {
    log("pong from " + client.id);
    return;
  }
  if (packet.type === "event") {
    log("event from " + client.id, packet.payload || {});
    return;
  }
  if (packet.type === "log") {
    log("log from " + client.id, packet.payload || {});
    return;
  }
  if (packet.type === "result") {
    summarizeResult(packet);
    return;
  }
  if (packet.type === "error") {
    log("error from " + client.id, packet.payload || {});
    return;
  }
  log("message from " + client.id, packet);
}

function printHelp() {
  console.log("");
  console.log("commands:");
  console.log("  help                show help");
  console.log("  clients             list connected clients");
  console.log("  use <clientId>      switch active client");
  console.log("  ping                send ping");
  console.log("  describe            call host.describe");
  console.log("  own                 call gameCtl.getFarmOwnership");
  console.log("  status              call gameCtl.getFarmStatus");
  console.log("  friends             call gameCtl.getFriendList");
  console.log("  raw <json>          send raw packet JSON");
  console.log("  quit                exit");
  console.log("");
}

function sendRaw(client, text) {
  const packet = JSON.parse(text);
  return socketSend(client.socket, packet);
}

function handleCommand(line) {
  const input = String(line || "").trim();
  if (!input) {
    return;
  }
  if (input === "help") {
    printHelp();
    return;
  }
  if (input === "clients") {
    listClients();
    return;
  }
  if (input === "quit") {
    process.exit(0);
    return;
  }

  const client = getActiveClient();
  if (!client) {
    log("no active client");
    return;
  }

  if (input.indexOf("use ") === 0) {
    const id = input.slice(4).trim();
    if (!clients.has(id)) {
      log("client not found: " + id);
      return;
    }
    activeClientId = id;
    log("active client -> " + id);
    return;
  }

  if (input === "ping") {
    sendPing(client);
    return;
  }
  if (input === "describe") {
    sendCall(client, "host.describe", []);
    return;
  }
  if (input === "own") {
    sendCall(client, "gameCtl.getFarmOwnership", []);
    return;
  }
  if (input === "status") {
    sendCall(client, "gameCtl.getFarmStatus", []);
    return;
  }
  if (input === "friends") {
    sendCall(client, "gameCtl.getFriendList", []);
    return;
  }
  if (input.indexOf("raw ") === 0) {
    sendRaw(client, input.slice(4));
    return;
  }

  log("unknown command: " + input);
}

wss.on("connection", (socket, req) => {
  const client = {
    id: nextId("client"),
    socket,
    hello: null,
    remoteAddress: req && req.socket ? req.socket.remoteAddress : null,
    connectedAt: now(),
  };
  clients.set(client.id, client);
  if (!activeClientId) {
    activeClientId = client.id;
  }
  log("client connected: " + client.id + " from " + (client.remoteAddress || "?"));

  socket.on("message", (raw) => {
    try {
      const packet = parsePacket(raw);
      handleClientMessage(client, packet);
    } catch (error) {
      log("invalid client message from " + client.id, String(error instanceof Error ? error.message : error));
    }
  });

  socket.on("close", () => {
    clients.delete(client.id);
    if (activeClientId === client.id) {
      activeClientId = null;
    }
    log("client disconnected: " + client.id);
  });

  socket.on("error", (error) => {
    log("client socket error: " + client.id, String(error instanceof Error ? error.message : error));
  });
});

wss.on("listening", () => {
  log("ws test server listening at ws://" + HOST + ":" + PORT + PATH);
  printHelp();
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", handleCommand);

process.on("SIGINT", () => {
  rl.close();
  wss.close(() => {
    process.exit(0);
  });
});
