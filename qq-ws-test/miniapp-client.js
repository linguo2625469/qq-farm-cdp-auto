// Test-only miniapp host.
// Production QQ route should use the generated bundle from:
// 1. button.js
// 2. qq-host.js
// 3. scripts/patch-qq-miniapp.cjs
(function () {
  var G = typeof globalThis !== "undefined" ? globalThis : Function("return this")();
  if (G.__qqFarmWsTest && G.__qqFarmWsTest.__installed) {
    return;
  }

  var mini = G.wx || G.qq || null;
  var defaults = {
    url: "ws://127.0.0.1:18788/miniapp",
    reconnectMs: 3000,
    heartbeatMs: 15000,
    callTimeoutMs: 15000,
    readyPollMs: 2000,
    autoStart: true
  };

  var state = {
    url: defaults.url,
    phase: "idle",
    seq: 0,
    socket: null,
    transportKind: null,
    reconnectTimer: null,
    heartbeatTimer: null,
    readyPollTimer: null,
    manualStop: false,
    lastHelloAck: null,
    lastGameCtlReady: null,
    clientId: "qq-miniapp-" + Math.random().toString(36).slice(2, 10)
  };

  function now() {
    return Date.now();
  }

  function nextId(prefix) {
    state.seq += 1;
    return prefix + "-" + state.seq;
  }

  function safeConsole(level, message, extra) {
    var text = "[qq-ws-test][" + level + "] " + message;
    try {
      if (extra === undefined) console.log(text);
      else console.log(text, extra);
    } catch (_) {}
  }

  function showToast(message) {
    if (!mini || typeof mini.showToast !== "function") return;
    try {
      mini.showToast({
        title: String(message || "").slice(0, 7),
        icon: "none",
        duration: 1000
      });
    } catch (_) {}
  }

  function setPhase(phase) {
    state.phase = phase;
  }

  function clearTimer(name) {
    if (state[name]) {
      clearTimeout(state[name]);
      clearInterval(state[name]);
      state[name] = null;
    }
  }

  function getGameCtl() {
    var ctl = G.gameCtl || (G.GameGlobal && G.GameGlobal.gameCtl);
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
    if (G.qq) return "qq";
    if (G.wx) return "wx";
    return "unknown";
  }

  function collectAvailableMethods() {
    var list = ["host.ping", "host.describe"];
    var ctl = getGameCtl();
    if (!ctl) return list;
    var candidates = [
      "getFarmOwnership",
      "getFarmStatus",
      "getFriendList",
      "enterOwnFarm",
      "enterFriendFarm",
      "triggerOneClickOperation",
      "autoPlant"
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var key = candidates[i];
      if (typeof ctl[key] === "function") {
        list.push("gameCtl." + key);
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
      transportKind: state.transportKind,
      gameCtlReady: !!ctl,
      availableMethods: collectAvailableMethods(),
      lastHelloAck: state.lastHelloAck,
      appPlatform: getAppPlatform(systemInfo),
      systemInfo: systemInfo,
      scriptHash: ctl && typeof ctl.__scriptHash === "string" ? ctl.__scriptHash : null
    };
  }

  function normalizeMessageData(raw) {
    if (typeof raw === "string") return raw;
    if (raw && typeof raw.data === "string") return raw.data;
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
    if (!state.socket || state.socket.readyState !== 1) {
      return false;
    }
    var text = JSON.stringify(packet);
    try {
      if (state.transportKind === "websocket") {
        state.socket.raw.send(text);
      } else if (state.transportKind === "socketTask") {
        state.socket.raw.send({ data: text });
      } else {
        return false;
      }
      return true;
    } catch (error) {
      safeConsole("error", "send failed", String(error && error.message ? error.message : error));
      return false;
    }
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
    safeConsole(level, message, extra);
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
      version: "mvp-1",
      gameCtlReady: !!getGameCtl(),
      availableMethods: collectAvailableMethods(),
      transportKind: state.transportKind,
      appPlatform: getAppPlatform(systemInfo),
      systemInfo: systemInfo
    });
  }

  function sendPong(requestId) {
    return sendTyped("pong", {}, requestId || nextId("pong"));
  }

  function sendReadyEvent(ready) {
    return sendTyped("event", {
      name: "gameCtlReadyChanged",
      ready: !!ready,
      availableMethods: collectAvailableMethods()
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
    if (pathName === "host.ping") {
      return {
        pong: true,
        now: new Date().toISOString(),
        gameCtlReady: !!getGameCtl()
      };
    }
    if (pathName === "host.describe") {
      return getStatus();
    }

    var ctl = getGameCtl();
    if (!ctl) {
      throw new Error("gameCtl_not_ready");
    }

    if (pathName === "gameCtl.getFarmOwnership") {
      return ctl.getFarmOwnership.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.getFarmStatus") {
      return ctl.getFarmStatus.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.getFriendList") {
      return ctl.getFriendList.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.enterOwnFarm") {
      return ctl.enterOwnFarm.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.enterFriendFarm") {
      return ctl.enterFriendFarm.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.triggerOneClickOperation") {
      return ctl.triggerOneClickOperation.apply(ctl, Array.isArray(args) ? args : []);
    }
    if (pathName === "gameCtl.autoPlant") {
      return ctl.autoPlant.apply(ctl, Array.isArray(args) ? args : []);
    }

    throw new Error("call_path_not_allowed: " + pathName);
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
    sendLog("info", "received call " + pathName);

    withTimeout(Promise.resolve().then(function () {
      return invokeAllowed(pathName, args);
    }), defaults.callTimeoutMs).then(function (result) {
      sendResult(packet.id, pathName, true, result, null);
    }, function (error) {
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
      if (state.transportKind === "websocket") {
        state.socket.raw.close();
      } else if (state.transportKind === "socketTask") {
        state.socket.raw.close({});
      }
    } catch (_) {}
    state.socket = null;
    state.transportKind = null;
  }

  function handleOpen(kind, rawSocket) {
    clearTimer("reconnectTimer");
    state.socket = {
      raw: rawSocket,
      readyState: 1
    };
    state.transportKind = kind;
    setPhase("connected");
    showToast("ws ok");
    sendLog("info", "socket connected", { kind: kind, url: state.url });
    sendHello();
    startHeartbeat();
  }

  function handleClose(kind, detail) {
    if (state.socket) {
      state.socket.readyState = 3;
    }
    setPhase("disconnected");
    stopHeartbeat();
    state.socket = null;
    state.transportKind = kind || state.transportKind;
    sendLog("warn", "socket closed", detail || null);
    scheduleReconnect("closed");
  }

  function handleError(kind, error) {
    sendLog("error", "socket error", {
      kind: kind,
      error: String(error && error.message ? error.message : error)
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
    sendLog("info", "received packet", packet);
  }

  function openWithWebSocket(url) {
    if (typeof G.WebSocket !== "function") {
      return false;
    }

    var ws;
    try {
      ws = new G.WebSocket(url);
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
        sendLog("error", "invalid packet", String(error && error.message ? error.message : error));
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
        sendLog("error", "invalid packet", String(error && error.message ? error.message : error));
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

  function connect(url) {
    if (url) {
      state.url = String(url);
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
    safeConsole("info", "stopped");
  }

  function start(url) {
    state.manualStop = false;
    if (!state.readyPollTimer) {
      startReadyPoll();
    }
    return connect(url || state.url);
  }

  G.__qqFarmWsTest = {
    __installed: true,
    defaults: defaults,
    start: start,
    stop: stop,
    status: getStatus,
    sendHello: sendHello,
    invokeLocal: invokeAllowed
  };

  startReadyPoll();
  if (defaults.autoStart) {
    start(defaults.url);
  }
})();
