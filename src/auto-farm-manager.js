"use strict";

const { ensureGameCtl, callGameCtl } = require("./game-ctl-utils");
const { runAutoFarmCycle } = require("./auto-farm-executor");
const {
  normalizeAutoPlantMode,
  normalizeAutoPlantSource,
  readAutoPlantSelectedSeedKey,
} = require("./auto-farm-plant-config");

function toBool(value, defaultValue) {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (!text) return defaultValue;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return defaultValue;
}

function toInt(value, defaultValue, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  const fallback = Number.isFinite(n) ? n : defaultValue;
  return Math.min(max, Math.max(min, fallback));
}

function normalizeAutoFarmConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const autoFarmPlantMode = normalizeAutoPlantMode(src.autoFarmPlantMode);
  const autoFarmPlantSource = normalizeAutoPlantSource(src.autoFarmPlantSource, src.autoFarmPlantMode);
  return {
    autoFarmOwnEnabled: toBool(src.autoFarmOwnEnabled, true),
    autoFarmFriendEnabled: toBool(src.autoFarmFriendEnabled, false),
    autoFarmOwnIntervalSec: toInt(src.autoFarmOwnIntervalSec, 30, 5, 3600),
    autoFarmFriendIntervalSec: toInt(src.autoFarmFriendIntervalSec, 90, 10, 3600),
    autoFarmMaxFriends: toInt(src.autoFarmMaxFriends, 5, 1, 50),
    autoFarmEnterWaitMs: toInt(src.autoFarmEnterWaitMs, 1800, 0, 15000),
    autoFarmActionWaitMs: toInt(src.autoFarmActionWaitMs, 1200, 0, 10000),
    autoFarmRefreshFriendList: toBool(src.autoFarmRefreshFriendList, true),
    autoFarmReturnHome: toBool(src.autoFarmReturnHome, true),
    autoFarmStopOnError: toBool(src.autoFarmStopOnError, false),
    autoFarmPlantMode,
    autoFarmPlantSource,
    autoFarmPlantSelectedSeedKey: readAutoPlantSelectedSeedKey(src),
  };
}

class AutoFarmManager {
  /**
   * @param {{
   *   ensureSession?: () => Promise<any>,
   *   getSession?: () => any,
   *   ensureGameCtl?: (session: any) => Promise<{ injected: boolean, state?: any }>,
   *   callGameCtl?: (session: any, pathName: string, args: any[]) => Promise<any>,
   *   getTransportState?: () => any,
   *   ensureCdp?: () => Promise<any>,
   *   getCdp?: () => any,
   *   projectRoot: string,
   * }} opts
   */
  constructor(opts) {
    this.projectRoot = opts.projectRoot;
    this.ensureSession = typeof opts.ensureSession === "function"
      ? opts.ensureSession
      : opts.ensureCdp;
    this.getSession = typeof opts.getSession === "function"
      ? opts.getSession
      : opts.getCdp;
    this.getTransportState = typeof opts.getTransportState === "function"
      ? opts.getTransportState
      : () => null;
    this.ensureGameCtlImpl = typeof opts.ensureGameCtl === "function"
      ? opts.ensureGameCtl
      : this._ensureGameCtlViaCdp.bind(this);
    this.callGameCtlImpl = typeof opts.callGameCtl === "function"
      ? opts.callGameCtl
      : this._callGameCtlDirect.bind(this);
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.nextRunAt = null;
    this.lastStartedAt = null;
    this.lastFinishedAt = null;
    this.lastOwnRunAt = 0;
    this.lastFriendRunAt = 0;
    this.lastError = null;
    this.lastResult = null;
    this.recentEvents = [];
    this.config = normalizeAutoFarmConfig({});
  }

  updateConfig(raw) {
    this.config = normalizeAutoFarmConfig({ ...this.config, ...(raw && typeof raw === "object" ? raw : {}) });
    return this.config;
  }

  getState() {
    return {
      running: this.running,
      busy: this.busy,
      nextRunAt: this.nextRunAt,
      lastStartedAt: this.lastStartedAt,
      lastFinishedAt: this.lastFinishedAt,
      lastOwnRunAt: this.lastOwnRunAt ? new Date(this.lastOwnRunAt).toISOString() : null,
      lastFriendRunAt: this.lastFriendRunAt ? new Date(this.lastFriendRunAt).toISOString() : null,
      lastError: this.lastError,
      lastResult: this.lastResult,
      config: { ...this.config },
      recentEvents: [...this.recentEvents],
      runtime: this.getTransportState(),
    };
  }

  start(rawConfig) {
    if (rawConfig) this.updateConfig(rawConfig);
    if (!this.config.autoFarmOwnEnabled && !this.config.autoFarmFriendEnabled) {
      throw new Error("自动化已启动的项目为空，请至少启用自己农场或好友偷菜");
    }
    this.running = true;
    this._pushEvent("info", "自动化已启动");
    this._schedule(50);
    return this.getState();
  }

  stop(reason = "manual") {
    this.running = false;
    this.nextRunAt = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this._pushEvent("info", `自动化已停止: ${reason}`);
    return this.getState();
  }

  async runOnce(rawConfig) {
    if (rawConfig) this.updateConfig(rawConfig);
    if (!this.config.autoFarmOwnEnabled && !this.config.autoFarmFriendEnabled) {
      throw new Error("自动化已启动的项目为空，请至少启用自己农场或好友偷菜");
    }
    if (this.busy) {
      throw new Error("自动化正在执行中");
    }
    return await this._runCycle(true);
  }

  _pushEvent(level, message, extra) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
    };
    if (extra !== undefined) entry.extra = extra;
    this.recentEvents.push(entry);
    if (this.recentEvents.length > 40) {
      this.recentEvents.splice(0, this.recentEvents.length - 40);
    }
  }

  _schedule(delayMs) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(25, Number(delayMs) || 25);
    this.nextRunAt = new Date(Date.now() + delay).toISOString();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this._tick().catch((error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        this.lastFinishedAt = new Date().toISOString();
        this.lastError = err.message;
        this._pushEvent("error", `调度异常: ${err.message}`);
        if (this.config.autoFarmStopOnError) {
          this.stop(`error: ${err.message}`);
          return;
        }
        if (this.running) {
          this._schedule(1000);
        }
      });
    }, delay);
  }

  _computeNextDelayMs(now) {
    const delays = [];
    if (this.config.autoFarmOwnEnabled) {
      const ownDueAt = this.lastOwnRunAt > 0
        ? this.lastOwnRunAt + this.config.autoFarmOwnIntervalSec * 1000
        : now;
      delays.push(Math.max(0, ownDueAt - now));
    }
    if (this.config.autoFarmFriendEnabled) {
      const friendDueAt = this.lastFriendRunAt > 0
        ? this.lastFriendRunAt + this.config.autoFarmFriendIntervalSec * 1000
        : now;
      delays.push(Math.max(0, friendDueAt - now));
    }
    if (delays.length === 0) return 1000;
    return Math.max(250, Math.min(...delays));
  }

  _getDueFlags(now, force) {
    const ownDue = !!this.config.autoFarmOwnEnabled && (
      force || this.lastOwnRunAt <= 0 || now - this.lastOwnRunAt >= this.config.autoFarmOwnIntervalSec * 1000
    );
    const friendDue = !!this.config.autoFarmFriendEnabled && (
      force || this.lastFriendRunAt <= 0 || now - this.lastFriendRunAt >= this.config.autoFarmFriendIntervalSec * 1000
    );
    return { ownDue, friendDue };
  }

  async _tick() {
    if (!this.running) return;
    if (this.busy) {
      this._schedule(500);
      return;
    }
    const now = Date.now();
    const due = this._getDueFlags(now, false);
    if (!due.ownDue && !due.friendDue) {
      this._schedule(this._computeNextDelayMs(now));
      return;
    }
    let shouldReschedule = true;
    try {
      await this._runCycle(false, due);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (this.config.autoFarmStopOnError) {
        shouldReschedule = false;
        this.stop(`error: ${err.message}`);
        return;
      }
    } finally {
      if (shouldReschedule && this.running) {
        this._schedule(this._computeNextDelayMs(Date.now()));
      }
    }
  }

  async _ensureGameCtlViaCdp(session) {
    return await ensureGameCtl(session, this.projectRoot, [
      "getFarmOwnership",
      "getFarmStatus",
      "getFriendList",
      "enterOwnFarm",
      "enterFriendFarm",
      "triggerOneClickOperation",
      "getSeedList",
      "getShopSeedList",
      "buyShopGoods",
      "clickMatureEffect",
      "plantSingleLand",
      "plantSeedsOnLands",
    ]);
  }

  async _callGameCtlDirect(session, pathName, args) {
    return await callGameCtl(session, pathName, args);
  }

  async _runCycle(force, dueFlags) {
    const now = Date.now();
    const due = dueFlags || this._getDueFlags(now, force);
    if (!due.ownDue && !due.friendDue) {
      return this.getState();
    }

    this.busy = true;
    this.lastStartedAt = new Date().toISOString();
    this.lastError = null;
    if (due.ownDue) this.lastOwnRunAt = now;
    if (due.friendDue) this.lastFriendRunAt = now;

    try {
      const session = await this.ensureSession();
      const injectState = await this.ensureGameCtlImpl(session);
      const transportState = this.getTransportState();
      const isQqRuntime = !!(transportState && transportState.resolvedTarget === "qq_ws");
      const cycleOpts = {
        ownFarmEnabled: due.ownDue,
        friendStealEnabled: due.friendDue,
        autoPlantMode: this.config.autoFarmPlantMode || "none",
        autoPlantSource: this.config.autoFarmPlantSource || "auto",
        autoPlantSelectedSeedKey: this.config.autoFarmPlantSelectedSeedKey || "",
        useClientAutoPlant: isQqRuntime,
        enterWaitMs: this.config.autoFarmEnterWaitMs,
        actionWaitMs: this.config.autoFarmActionWaitMs,
        maxFriends: this.config.autoFarmMaxFriends,
        refreshFriendList: this.config.autoFarmRefreshFriendList,
        returnHome: this.config.autoFarmReturnHome,
        stopOnError: this.config.autoFarmStopOnError,
      };
      const result = await runAutoFarmCycle({
        session,
        callGameCtl: this.callGameCtlImpl.bind(this),
        options: cycleOpts,
      });
      this.lastFinishedAt = new Date().toISOString();
      this.lastResult = {
        injected: injectState.injected,
        due,
        result,
      };
      this._pushEvent(
        "info",
        `执行完成: own=${due.ownDue ? "on" : "off"}, friend=${due.friendDue ? "on" : "off"}`,
        {
          injected: injectState.injected,
          ownActions: Array.isArray(result?.ownFarm?.tasks?.actions) ? result.ownFarm.tasks.actions.length : 0,
          friendVisits: Array.isArray(result?.friendSteal?.visits) ? result.friendSteal.visits.length : 0,
        },
      );
      return this.getState();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastFinishedAt = new Date().toISOString();
      this.lastError = err.message;
      this._pushEvent("error", `执行失败: ${err.message}`);
      throw err;
    } finally {
      this.busy = false;
    }
  }
}

module.exports = {
  AutoFarmManager,
  normalizeAutoFarmConfig,
};
