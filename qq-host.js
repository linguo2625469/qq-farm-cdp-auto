(function () {
  var root = typeof globalThis !== "undefined" ? globalThis : Function("return this")();
  if (root.__qqFarmHost && root.__qqFarmHost.__installed) {
    return;
  }

  var mini = root.wx || root.qq || null;
  var allowedPaths = __QQ_FARM_ALLOWED_RPC_PATHS__;
  var allowedPathMap = {};
  for (var i = 0; i < allowedPaths.length; i += 1) {
    allowedPathMap[allowedPaths[i]] = true;
  }

  var defaults = {
    url: "__QQ_FARM_HOST_WS_URL__",
    reconnectMs: 3000,
    heartbeatMs: 15000,
    callTimeoutMs: 15000,
    readyPollMs: 2000,
    autoStart: true,
    expectedAppPlatform: "qq"
  };

  var state = {
    url: defaults.url,
    phase: "idle",
    seq: 0,
    socket: null,
    socketKind: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    readyPollTimer: null,
    manualStop: false,
    lastHelloAck: null,
    lastGameCtlReady: null,
    lastError: null,
    clientId: "qq-farm-" + Math.random().toString(36).slice(2, 10)
  };

  function now() {
    return Date.now();
  }

  function nextId(prefix) {
    state.seq += 1;
    return prefix + "-" + state.seq;
  }

  function logLocal(level, message, extra) {
    var text = "[qq-host][" + level + "] " + message;
    try {
      if (extra === undefined) {
        console.log(text);
      } else {
        console.log(text, extra);
      }
    } catch (_) {}
  }

  function setPhase(phase) {
    state.phase = phase;
  }

  function clearTimer(name) {
    if (!state[name]) return;
    clearTimeout(state[name]);
    clearInterval(state[name]);
    state[name] = null;
  }

  function getGameCtl() {
    var ctl = root.gameCtl || (root.GameGlobal && root.GameGlobal.gameCtl);
    return ctl && typeof ctl === "object" ? ctl : null;
  }

  function getSystemInfo() {
    if (!mini || typeof mini.getSystemInfoSync !== "function") {
      return null;
    }
    try {
      return mini.getSystemInfoSync();
    } catch (_) {
      return null;
    }
  }

  function getAppPlatform(systemInfo) {
    var info = systemInfo || getSystemInfo();
    if (info && typeof info.AppPlatform === "string" && info.AppPlatform) {
      return info.AppPlatform;
    }
    if (root.qq) return "qq";
    if (root.wx) return "wx";
    return "unknown";
  }

  function getScriptHash() {
    var ctl = getGameCtl();
    if (ctl && typeof ctl.__scriptHash === "string" && ctl.__scriptHash) {
      return ctl.__scriptHash;
    }
    var meta = root.__qqFarmBundleMeta;
    if (meta && typeof meta.scriptHash === "string" && meta.scriptHash) {
      return meta.scriptHash;
    }
    return "__QQ_FARM_BUNDLE_HASH__";
  }

  function sanitizeSystemInfo(systemInfo) {
    var info = systemInfo || getSystemInfo();
    if (!info || typeof info !== "object") return null;
    return {
      brand: info.brand || null,
      model: info.model || null,
      platform: info.platform || null,
      AppPlatform: info.AppPlatform || null,
      windowWidth: info.windowWidth || null,
      windowHeight: info.windowHeight || null,
      pixelRatio: info.pixelRatio || null,
      SDKVersion: info.SDKVersion || null,
      MiniAppVersion: info.MiniAppVersion || null
    };
  }

  function collectAvailableMethods() {
    var list = ["host.ping", "host.describe"];
    var ctl = getGameCtl();
    if (!ctl) return list;
    for (var i = 0; i < allowedPaths.length; i += 1) {
      var pathName = allowedPaths[i];
      if (pathName.indexOf("gameCtl.") !== 0) continue;
      var methodName = pathName.slice("gameCtl.".length);
      if (typeof ctl[methodName] === "function") {
        list.push(pathName);
      }
    }
    return list;
  }

  function getStatus() {
    var ctl = getGameCtl();
    var systemInfo = getSystemInfo();
    return {
      clientId: state.clientId,
      url: state.url,
      phase: state.phase,
      socketKind: state.socketKind,
      transportKind: state.socketKind,
      gameCtlReady: !!ctl,
      availableMethods: collectAvailableMethods(),
      lastHelloAck: state.lastHelloAck,
      appPlatform: getAppPlatform(systemInfo),
      systemInfo: sanitizeSystemInfo(systemInfo),
      scriptHash: getScriptHash(),
      hostVersion: "__QQ_FARM_HOST_VERSION__"
    };
  }

  function normalizeMessageData(raw) {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw.data === "string") return raw.data;
    if (raw && raw.data && typeof TextDecoder === "function" && raw.data instanceof ArrayBuffer) {
      try {
        return new TextDecoder("utf-8").decode(new Uint8Array(raw.data));
      } catch (_) {}
    }
    if (raw && raw.data && typeof ArrayBuffer !== "undefined" && raw.data instanceof ArrayBuffer) {
      try {
        return String.fromCharCode.apply(null, new Uint8Array(raw.data));
      } catch (_) {}
    }
    return String(raw && raw.data != null ? raw.data : raw);
  }

  function parsePacket(raw) {
    return JSON.parse(normalizeMessageData(raw));
  }

  function sendPacket(packet) {
    if (!state.socket) return false;
    var text = JSON.stringify(packet);
    try {
      if (state.socketKind === "websocket") {
        if (state.socket.readyState !== 1) return false;
        state.socket.send(text);
        return true;
      }
      if (state.socketKind === "socketTask") {
        state.socket.send({ data: text });
        return true;
      }
    } catch (error) {
      state.lastError = error && error.message ? error.message : String(error);
      logLocal("error", "send failed", state.lastError);
    }
    return false;
  }

  function sendTyped(type, payload, id) {
    return sendPacket({
      id: id || nextId(type),
      type: type,
      ts: now(),
      payload: payload || {}
    });
  }

  function sendLog(level, message, extra) {
    logLocal(level, message, extra);
    sendTyped("log", {
      level: level,
      message: message,
      extra: extra === undefined ? null : extra
    });
  }

  function sendHello() {
    var systemInfo = getSystemInfo();
    return sendTyped("hello", {
      client: "qq-miniapp",
      app: "qq-farm",
      version: "__QQ_FARM_HOST_VERSION__",
      gameCtlReady: !!getGameCtl(),
      availableMethods: collectAvailableMethods(),
      socketKind: state.socketKind,
      transportKind: state.socketKind,
      appPlatform: getAppPlatform(systemInfo),
      systemInfo: sanitizeSystemInfo(systemInfo),
      scriptHash: getScriptHash()
    });
  }

  function sendPong(requestId) {
    return sendTyped("pong", {}, requestId || nextId("pong"));
  }

  function sendReadyEvent(ready) {
    return sendTyped("event", {
      name: "gameCtlReadyChanged",
      ready: !!ready,
      availableMethods: collectAvailableMethods(),
      scriptHash: getScriptHash()
    });
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error("timeout"));
      }, Math.max(1, Number(timeoutMs) || defaults.callTimeoutMs));

      Promise.resolve(promise).then(function (value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function invokeAllowed(pathName, args) {
    pathName = String(pathName || "");
    if (!allowedPathMap[pathName]) {
      throw new Error("call_path_not_allowed: " + pathName);
    }

    if (pathName === "host.ping") {
      return {
        pong: true,
        now: new Date().toISOString(),
        gameCtlReady: !!getGameCtl(),
        phase: state.phase
      };
    }
    if (pathName === "host.describe") {
      return getStatus();
    }

    var ctl = getGameCtl();
    if (!ctl) {
      throw new Error("gameCtl_not_ready");
    }

    var methodName = pathName.slice("gameCtl.".length);
    if (!methodName || typeof ctl[methodName] !== "function") {
      throw new Error("call_path_not_ready: " + pathName);
    }
    return ctl[methodName].apply(ctl, Array.isArray(args) ? args : []);
  }

  function sendResult(requestId, pathName, ok, data, error) {
    return sendTyped("result", {
      ok: !!ok,
      path: pathName || null,
      data: ok ? data : null,
      error: ok ? null : String(error || "unknown_error")
    }, requestId);
  }

  function handleCall(packet) {
    var payload = packet && packet.payload && typeof packet.payload === "object" ? packet.payload : {};
    var pathName = String(payload.path || "");
    var args = Array.isArray(payload.args) ? payload.args : [];

    withTimeout(Promise.resolve().then(function () {
      return invokeAllowed(pathName, args);
    }), defaults.callTimeoutMs).then(function (result) {
      sendResult(packet.id, pathName, true, result, null);
    }, function (error) {
      sendLog("warn", "call failed", {
        path: pathName,
        error: error && error.message ? error.message : String(error)
      });
      sendResult(
        packet.id,
        pathName,
        false,
        null,
        error && error.message ? error.message : String(error)
      );
    });
  }

  function scheduleReconnect(reason) {
    clearTimer("reconnectTimer");
    if (state.manualStop) {
      return;
    }
    state.reconnectTimer = setTimeout(function () {
      sendLog("info", "reconnecting", { reason: reason || "unknown" });
      connect(state.url);
    }, defaults.reconnectMs);
  }

  function closeCurrentSocket() {
    if (!state.socket) return;
    try {
      if (state.socketKind === "websocket" && typeof state.socket.close === "function") {
        state.socket.close();
      } else if (state.socketKind === "socketTask" && typeof state.socket.close === "function") {
        state.socket.close({});
      }
    } catch (_) {}
    state.socket = null;
    state.socketKind = null;
  }

  function handleOpen(kind, rawSocket) {
    clearTimer("reconnectTimer");
    state.socket = rawSocket;
    state.socketKind = kind;
    state.lastError = null;
    setPhase("connected");
    sendLog("info", "socket connected", { kind: kind, url: state.url });
    sendHello();
    startHeartbeat();
  }

  function handleClose(kind, detail) {
    setPhase("disconnected");
    stopHeartbeat();
    state.socket = null;
    state.socketKind = kind || state.socketKind;
    sendLog("warn", "socket closed", detail || null);
    scheduleReconnect("closed");
  }

  function handleError(kind, error) {
    state.lastError = error && error.message ? error.message : String(error);
    sendLog("error", "socket error", {
      kind: kind,
      error: state.lastError
    });
  }

  function handleIncoming(packet) {
    if (!packet || typeof packet !== "object") {
      return;
    }
    if (packet.type === "helloAck") {
      state.lastHelloAck = packet.payload || {};
      setPhase("ready");
      sendLog("info", "hello ack", state.lastHelloAck);
      return;
    }
    if (packet.type === "ping") {
      sendPong(packet.id);
      return;
    }
    if (packet.type === "pong") {
      return;
    }
    if (packet.type === "call") {
      handleCall(packet);
      return;
    }
  }

  function openWithWebSocket(url) {
    if (typeof root.WebSocket !== "function") {
      return false;
    }

    var ws;
    try {
      ws = new root.WebSocket(url);
    } catch (error) {
      handleError("websocket", error);
      return false;
    }

    ws.onopen = function () {
      handleOpen("websocket", ws);
    };
    ws.onmessage = function (event) {
      try {
        handleIncoming(parsePacket(event.data));
      } catch (error) {
        handleError("websocket", error);
      }
    };
    ws.onerror = function (error) {
      handleError("websocket", error);
    };
    ws.onclose = function (event) {
      handleClose("websocket", {
        code: event && event.code,
        reason: event && event.reason
      });
    };
    return true;
  }

  function openWithMiniSocket(url) {
    if (!mini || typeof mini.connectSocket !== "function") {
      return false;
    }

    var task;
    try {
      task = mini.connectSocket({ url: url });
    } catch (error) {
      handleError("socketTask", error);
      return false;
    }

    if (!task || typeof task.onOpen !== "function") {
      handleError("socketTask", "connectSocket returned invalid task");
      return false;
    }

    task.onOpen(function () {
      handleOpen("socketTask", task);
    });
    task.onMessage(function (event) {
      try {
        handleIncoming(parsePacket(event));
      } catch (error) {
        handleError("socketTask", error);
      }
    });
    task.onError(function (error) {
      handleError("socketTask", error);
    });
    task.onClose(function (event) {
      handleClose("socketTask", event || null);
    });
    return true;
  }

  function canStartOnCurrentPlatform(force) {
    if (force) return true;
    if (!defaults.expectedAppPlatform) return true;
    var platform = getAppPlatform();
    if (!platform || platform === "unknown") return true;
    return platform === defaults.expectedAppPlatform;
  }

  function connect(url, force) {
    if (url) {
      state.url = String(url);
    }
    if (!canStartOnCurrentPlatform(!!force)) {
      setPhase("platform_mismatch");
      logLocal("warn", "skip start on platform", getAppPlatform());
      return false;
    }

    closeCurrentSocket();
    setPhase("connecting");

    if (openWithWebSocket(state.url)) {
      return true;
    }
    if (openWithMiniSocket(state.url)) {
      return true;
    }

    setPhase("unavailable");
    sendLog("error", "no websocket api available");
    return false;
  }

  function startHeartbeat() {
    stopHeartbeat();
    state.heartbeatTimer = setInterval(function () {
      sendTyped("ping", {});
    }, defaults.heartbeatMs);
  }

  function stopHeartbeat() {
    clearTimer("heartbeatTimer");
  }

  function startReadyPoll() {
    clearTimer("readyPollTimer");
    state.lastGameCtlReady = !!getGameCtl();
    state.readyPollTimer = setInterval(function () {
      var ready = !!getGameCtl();
      if (ready === state.lastGameCtlReady) {
        return;
      }
      state.lastGameCtlReady = ready;
      sendReadyEvent(ready);
      if (ready) {
        sendHello();
      }
    }, defaults.readyPollMs);
  }

  function stop() {
    state.manualStop = true;
    clearTimer("reconnectTimer");
    stopHeartbeat();
    clearTimer("readyPollTimer");
    closeCurrentSocket();
    setPhase("stopped");
    logLocal("info", "stopped");
  }

  function start(url, opts) {
    opts = opts && typeof opts === "object" ? opts : {};
    state.manualStop = false;
    if (opts.url) {
      state.url = String(opts.url);
    } else if (url) {
      state.url = String(url);
    }
    if (!state.readyPollTimer) {
      startReadyPoll();
    }
    return connect(state.url, !!opts.force);
  }

  function configure(next) {
    if (!next || typeof next !== "object") return getStatus();
    if (next.url) {
      state.url = String(next.url);
    }
    if (next.reconnectMs != null) {
      defaults.reconnectMs = Math.max(500, Number(next.reconnectMs) || defaults.reconnectMs);
    }
    if (next.heartbeatMs != null) {
      defaults.heartbeatMs = Math.max(1000, Number(next.heartbeatMs) || defaults.heartbeatMs);
    }
    if (next.callTimeoutMs != null) {
      defaults.callTimeoutMs = Math.max(1000, Number(next.callTimeoutMs) || defaults.callTimeoutMs);
    }
    if (next.readyPollMs != null) {
      defaults.readyPollMs = Math.max(300, Number(next.readyPollMs) || defaults.readyPollMs);
      if (state.readyPollTimer) {
        startReadyPoll();
      }
    }
    if (typeof next.expectedAppPlatform === "string") {
      defaults.expectedAppPlatform = next.expectedAppPlatform || null;
    }
    return getStatus();
  }

  root.__qqFarmHost = {
    __installed: true,
    __hostVersion: "__QQ_FARM_HOST_VERSION__",
    __bundleHash: "__QQ_FARM_BUNDLE_HASH__",
    defaults: defaults,
    start: start,
    stop: stop,
    connect: connect,
    configure: configure,
    status: getStatus,
    sendHello: sendHello,
    invokeLocal: invokeAllowed,
    logLocal: logLocal
  };

  startReadyPoll();
  if (defaults.autoStart) {
    start(defaults.url);
  }
})();
