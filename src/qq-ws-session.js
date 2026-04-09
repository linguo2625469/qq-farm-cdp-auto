"use strict";

const { EventEmitter } = require("node:events");
const WebSocket = require("ws");

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

class QqWsSession extends EventEmitter {
  /**
   * @param {{
   *   path?: string,
   *   readyTimeoutMs?: number,
   *   callTimeoutMs?: number,
   * }} [opts]
   */
  constructor(opts = {}) {
    super();
    this.path = opts.path || "/miniapp";
    this.readyTimeoutMs = Math.max(1000, Number(opts.readyTimeoutMs) || 15_000);
    this.callTimeoutMs = Math.max(1000, Number(opts.callTimeoutMs) || 15_000);
    this.server = null;
    this.clientSeq = 0;
    this.callSeq = 0;
    /** @type {Map<string, any>} */
    this.clients = new Map();
    /** @type {Map<string, { clientId: string, timer: NodeJS.Timeout, resolve: (value: any) => void, reject: (error: Error) => void }>} */
    this.pendingCalls = new Map();
    /** @type {Array<{ resolve: (client: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
    this.readyWaiters = [];
    this.activeClientId = null;
    this.lastLog = null;
    this.lastEvent = null;
    this.lastError = null;
    this.history = [];
    this.maxHistory = 40;
  }

  attach() {
    if (this.server) return this.server;
    this.server = new WebSocket.Server({ noServer: true });
    this.server.on("connection", (socket, req) => {
      this._handleConnection(socket, req);
    });
    return this.server;
  }

  handleUpgrade(req, socket, head) {
    const server = this.attach();
    server.handleUpgrade(req, socket, head, (ws) => {
      server.emit("connection", ws, req);
    });
  }

  close() {
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("qq ws session closed"));
    }
    for (const [id, pending] of this.pendingCalls.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("qq ws session closed"));
      this.pendingCalls.delete(id);
    }
    for (const client of this.clients.values()) {
      try {
        client.socket.close();
      } catch (_) {}
    }
    this.clients.clear();
    if (this.server) {
      try {
        this.server.close();
      } catch (_) {}
    }
    this.server = null;
    this.activeClientId = null;
  }

  isReady() {
    return !!this._getActiveReadyClient();
  }

  async connect(timeoutMs) {
    return await this.waitForReady(timeoutMs);
  }

  async waitForReady(timeoutMs) {
    const active = this._getActiveReadyClient();
    if (active) return this;

    const waitMs = Math.max(1000, Number(timeoutMs) || this.readyTimeoutMs);
    return await new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => resolve(this),
        reject,
        timer: setTimeout(() => {
          this.readyWaiters = this.readyWaiters.filter((item) => item !== waiter);
          reject(new Error(`qq ws runtime not ready within ${waitMs}ms`));
        }, waitMs),
      };
      this.readyWaiters.push(waiter);
    });
  }

  async ensureGameCtl() {
    const describe = await this.call("host.describe", []);
    const list = Array.isArray(describe && describe.availableMethods) ? describe.availableMethods : [];
    const gameCtlReady = !!(describe && describe.gameCtlReady);
    if (!gameCtlReady) {
      throw new Error("qq ws runtime gameCtl not ready");
    }
    const methods = {};
    for (let i = 0; i < list.length; i += 1) {
      const pathName = String(list[i] || "");
      if (pathName.indexOf("gameCtl.") !== 0) continue;
      methods[pathName.slice("gameCtl.".length)] = true;
    }
    return {
      injected: false,
      state: {
        hasGameCtl: true,
        methods,
        scriptHash: typeof describe.scriptHash === "string" ? describe.scriptHash : null,
      },
    };
  }

  async call(pathName, args, opts = {}) {
    const client = this._getActiveReadyClient();
    if (!client) {
      await this.waitForReady(opts.readyTimeoutMs);
    }
    const active = this._getActiveReadyClient();
    if (!active) {
      throw new Error("qq ws runtime not connected");
    }

    const reqId = "qqcall-" + (++this.callSeq);
    const packet = {
      id: reqId,
      type: "call",
      ts: Date.now(),
      payload: {
        path: String(pathName || ""),
        args: Array.isArray(args) ? args : [],
      },
    };

    return await new Promise((resolve, reject) => {
      const timeout = Math.max(1000, Number(opts.timeoutMs) || this.callTimeoutMs);
      const timer = setTimeout(() => {
        this.pendingCalls.delete(reqId);
        reject(new Error(`qq ws call timed out: ${packet.payload.path} (${timeout}ms)`));
      }, timeout);

      this.pendingCalls.set(reqId, {
        clientId: active.id,
        timer,
        resolve,
        reject,
      });

      try {
        active.socket.send(JSON.stringify(packet));
      } catch (error) {
        clearTimeout(timer);
        this.pendingCalls.delete(reqId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  getStatusSnapshot() {
    const clients = [];
    for (const client of this.clients.values()) {
      clients.push({
        id: client.id,
        remoteAddress: client.remoteAddress,
        connectedAt: client.connectedAt,
        lastHelloAt: client.lastHelloAt,
        ready: client.ready,
        app: client.hello && client.hello.app ? client.hello.app : null,
        appPlatform: client.hello && client.hello.appPlatform ? client.hello.appPlatform : null,
        gameCtlReady: client.hello ? !!client.hello.gameCtlReady : false,
        transportKind: client.hello && (client.hello.transportKind || client.hello.socketKind)
          ? (client.hello.transportKind || client.hello.socketKind)
          : null,
        version: client.hello && client.hello.version ? client.hello.version : null,
        phase: client.hello && client.hello.phase ? client.hello.phase : null,
        scriptHash: client.hello && client.hello.scriptHash ? client.hello.scriptHash : null,
        systemInfo: client.hello && client.hello.systemInfo ? client.hello.systemInfo : null,
        lastHelloAck: client.hello && client.hello.lastHelloAck ? client.hello.lastHelloAck : null,
        availableMethods: client.hello && Array.isArray(client.hello.availableMethods)
          ? [...client.hello.availableMethods]
          : [],
      });
    }
    return {
      mode: "qq_ws",
      path: this.path,
      connected: this.clients.size > 0,
      ready: this.isReady(),
      clientCount: this.clients.size,
      activeClientId: this.activeClientId,
      pendingCalls: this.pendingCalls.size,
      lastLog: this.lastLog,
      lastEvent: this.lastEvent,
      lastError: this.lastError,
      recentMessages: [...this.history],
      clients,
    };
  }

  _pushHistory(kind, clientId, payload) {
    const entry = {
      time: new Date().toISOString(),
      kind,
      clientId: clientId || null,
      payload: payload || null,
    };
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }
    return entry;
  }

  _resolveReadyWaiters() {
    if (!this.isReady()) return;
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(this);
    }
  }

  _nextClientId() {
    this.clientSeq += 1;
    return "qqws-client-" + this.clientSeq;
  }

  _getClient(id) {
    return id ? this.clients.get(id) || null : null;
  }

  _getActiveReadyClient() {
    const active = this._getClient(this.activeClientId);
    if (active && active.ready && active.socket.readyState === WebSocket.OPEN) {
      return active;
    }
    let fallback = null;
    for (const client of this.clients.values()) {
      if (client.ready && client.socket.readyState === WebSocket.OPEN) {
        fallback = client;
      }
    }
    if (fallback) {
      this.activeClientId = fallback.id;
      return fallback;
    }
    return null;
  }

  _handleConnection(socket, req) {
    const client = {
      id: this._nextClientId(),
      socket,
      remoteAddress: req && req.socket ? req.socket.remoteAddress : null,
      connectedAt: new Date().toISOString(),
      lastHelloAt: null,
      hello: null,
      ready: false,
    };
    this.clients.set(client.id, client);
    if (!this.activeClientId) {
      this.activeClientId = client.id;
    }
    this._pushHistory("connect", client.id, {
      remoteAddress: client.remoteAddress,
    });
    this.emit("clientConnected", this.getStatusSnapshot(), client);

    socket.on("message", (raw) => {
      this._handleMessage(client, raw);
    });
    socket.on("close", () => {
      this._handleClose(client);
    });
    socket.on("error", (error) => {
      this.lastError = {
        time: new Date().toISOString(),
        clientId: client.id,
        error: toErrorMessage(error),
      };
      this._pushHistory("socketError", client.id, this.lastError);
      this.emit("clientError", this.lastError, client);
    });
  }

  _handleClose(client) {
    this.clients.delete(client.id);
    if (this.activeClientId === client.id) {
      this.activeClientId = null;
    }
    for (const [id, pending] of this.pendingCalls.entries()) {
      if (pending.clientId !== client.id) continue;
      clearTimeout(pending.timer);
      pending.reject(new Error("qq ws client disconnected"));
      this.pendingCalls.delete(id);
    }
    this._pushHistory("disconnect", client.id, null);
    this.emit("clientDisconnected", this.getStatusSnapshot(), client);
  }

  _handleMessage(client, raw) {
    let packet;
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      packet = JSON.parse(text);
    } catch (error) {
      this.lastError = {
        time: new Date().toISOString(),
        clientId: client.id,
        error: "invalid_json: " + toErrorMessage(error),
      };
      return;
    }

    const type = packet && packet.type ? String(packet.type) : "";
    if (type === "hello") {
      client.hello = packet.payload && typeof packet.payload === "object" ? packet.payload : {};
      client.lastHelloAt = new Date().toISOString();
      client.ready = !!client.hello.gameCtlReady;
      this.activeClientId = client.id;
      this._pushHistory("hello", client.id, {
        appPlatform: client.hello.appPlatform || null,
        version: client.hello.version || null,
        ready: client.ready,
        scriptHash: client.hello.scriptHash || null,
      });
      this._send(client, {
        id: packet.id || ("helloAck-" + Date.now()),
        type: "helloAck",
        ts: Date.now(),
        payload: {
          ok: true,
          clientId: client.id,
          serverTime: new Date().toISOString(),
        },
      });
      this.emit("hello", this.getStatusSnapshot(), client);
      this._resolveReadyWaiters();
      return;
    }

    if (type === "event") {
      this.lastEvent = {
        time: new Date().toISOString(),
        clientId: client.id,
        payload: packet.payload || null,
      };
      this._pushHistory("event", client.id, packet.payload || null);
      if (packet.payload && packet.payload.name === "gameCtlReadyChanged") {
        client.ready = !!packet.payload.ready;
        if (client.ready) {
          this.activeClientId = client.id;
          this._resolveReadyWaiters();
        }
      }
      this.emit("event", this.lastEvent, client);
      return;
    }

    if (type === "log") {
      this.lastLog = {
        time: new Date().toISOString(),
        clientId: client.id,
        payload: packet.payload || null,
      };
      this._pushHistory("log", client.id, packet.payload || null);
      this.emit("log", this.lastLog, client);
      return;
    }

    if (type === "ping") {
      this._send(client, {
        id: packet.id || ("pong-" + Date.now()),
        type: "pong",
        ts: Date.now(),
        payload: {},
      });
      return;
    }

    if (type === "result") {
      const pending = packet && packet.id ? this.pendingCalls.get(String(packet.id)) : null;
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingCalls.delete(String(packet.id));
      const payload = packet.payload && typeof packet.payload === "object" ? packet.payload : {};
      if (payload.ok === false) {
        pending.reject(new Error(payload.error || "qq ws call failed"));
        return;
      }
      pending.resolve(payload.data);
      return;
    }

    if (type === "error") {
      this.lastError = {
        time: new Date().toISOString(),
        clientId: client.id,
        error: packet.payload && packet.payload.error ? packet.payload.error : "client_error",
        payload: packet.payload || null,
      };
      this._pushHistory("clientError", client.id, this.lastError);
      this.emit("clientError", this.lastError, client);
    }
  }

  _send(client, packet) {
    if (!client || !client.socket || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    client.socket.send(JSON.stringify(packet));
    return true;
  }
}

module.exports = {
  QqWsSession,
};
