"use strict";

function wait(ms) {
  const delayMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function summarizeFarmStatus(status) {
  if (!status || typeof status !== "object") return null;
  return {
    farmType: status.farmType ?? null,
    totalGrids: status.totalGrids ?? null,
    stageCounts: status.stageCounts ?? null,
    workCounts: status.workCounts ?? null,
  };
}

function getWorkCount(status, key) {
  if (!status || !status.workCounts || typeof status.workCounts !== "object") return 0;
  return Number(status.workCounts[key]) || 0;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withSilent(opts, extra) {
  const base = opts && typeof opts === "object" ? { ...opts } : {};
  return { ...base, ...(extra && typeof extra === "object" ? extra : {}), silent: true };
}

async function getFarmOwnership(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.getFarmOwnership", [withSilent(opts)]);
}

async function getFarmStatus(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.getFarmStatus", [withSilent(opts)]);
}

async function getFriendList(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.getFriendList", [withSilent(opts, { waitRefresh: true })]);
}

async function enterOwnFarm(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.enterOwnFarm", [withSilent(opts)]);
}

async function enterFriendFarm(session, callGameCtl, target, opts) {
  return await callGameCtl(session, "gameCtl.enterFriendFarm", [target, withSilent(opts)]);
}

async function triggerOneClickOperation(session, callGameCtl, typeOrIndex, opts) {
  return await callGameCtl(session, "gameCtl.triggerOneClickOperation", [typeOrIndex, withSilent(opts)]);
}

async function runCurrentFarmOneClickTasks(session, callGameCtl, opts) {
  const actionWaitMs = Math.max(0, Number(opts && opts.actionWaitMs) || 0);
  const statusBefore = await getFarmStatus(session, callGameCtl, {
    includeGrids: false,
    includeLandIds: false,
  });
  const farmType = statusBefore && statusBefore.farmType ? statusBefore.farmType : "unknown";
  const includeCollect = !opts || opts.includeCollect !== false;
  const includeWater = !opts || opts.includeWater !== false;
  const includeEraseGrass = !opts || opts.includeEraseGrass !== false;
  const includeKillBug = !opts || opts.includeKillBug !== false;
  const specs = [];

  if (includeCollect) specs.push({ key: "collect", op: "HARVEST" });
  if (farmType === "own") {
    if (includeEraseGrass) specs.push({ key: "eraseGrass", op: "ERASE_GRASS" });
    if (includeKillBug) specs.push({ key: "killBug", op: "KILL_BUG" });
    if (includeWater) specs.push({ key: "water", op: "WATER" });
  }

  const actions = [];
  let currentStatus = statusBefore;

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const beforeCount = getWorkCount(currentStatus, spec.key);
    if (beforeCount <= 0) continue;

    try {
      const trigger = await triggerOneClickOperation(session, callGameCtl, spec.op, {
        includeBefore: false,
        includeAfter: false,
      });
      if (actionWaitMs > 0) {
        await wait(actionWaitMs);
      }
      currentStatus = await getFarmStatus(session, callGameCtl, {
        includeGrids: false,
        includeLandIds: false,
      });
      const afterCount = getWorkCount(currentStatus, spec.key);
      actions.push({
        ok: true,
        key: spec.key,
        op: spec.op,
        beforeCount,
        afterCount,
        trigger,
      });
    } catch (error) {
      actions.push({
        ok: false,
        key: spec.key,
        op: spec.op,
        beforeCount,
        error: toErrorMessage(error),
      });
      if (opts && opts.stopOnError) break;
    }
  }

  return {
    farmType,
    before: summarizeFarmStatus(statusBefore),
    after: summarizeFarmStatus(currentStatus),
    actions,
  };
}

async function autoPlant(session, callGameCtl, mode, opts) {
  if (!mode || mode === "none") return null;
  return await callGameCtl(session, "gameCtl.autoPlant", [withSilent({ mode: mode })]);
}

async function runOwnFarmAutomation(session, callGameCtl, opts) {
  const enterWaitMs = Math.max(0, Number(opts && opts.enterWaitMs) || 0);
  const actionWaitMs = Math.max(0, Number(opts && opts.actionWaitMs) || 0);
  let ownership = null;
  try {
    ownership = await getFarmOwnership(session, callGameCtl, { allowWeakUi: true });
  } catch (_) {
    ownership = null;
  }

  let enterOwn = null;
  if (!ownership || ownership.farmType !== "own") {
    enterOwn = await enterOwnFarm(session, callGameCtl, {
      waitMs: enterWaitMs,
      includeAfterOwnership: true,
    });
  }

  const tasks = await runCurrentFarmOneClickTasks(session, callGameCtl, {
    includeCollect: !opts || opts.includeCollect !== false,
    includeWater: !opts || opts.includeWater !== false,
    includeEraseGrass: !opts || opts.includeEraseGrass !== false,
    includeKillBug: !opts || opts.includeKillBug !== false,
    actionWaitMs: opts && opts.actionWaitMs,
    stopOnError: !!(opts && opts.stopOnError),
  });

  // 自动种植
  const plantMode = opts && opts.autoPlantMode ? opts.autoPlantMode : "none";
  let plantResult = null;
  if (plantMode !== "none") {
    try {
      if (actionWaitMs > 0) {
        await wait(actionWaitMs);
      }
      plantResult = await autoPlant(session, callGameCtl, plantMode);
    } catch (error) {
      plantResult = { ok: false, error: toErrorMessage(error) };
    }
  }

  return {
    ok: true,
    enterOwn,
    tasks,
    plantResult,
  };
}

async function runFriendStealAutomation(session, callGameCtl, opts) {
  const enterWaitMs = Math.max(0, Number(opts && opts.enterWaitMs) || 0);
  const actionWaitMs = Math.max(0, Number(opts && opts.actionWaitMs) || 0);
  const maxFriends = Math.max(0, Number(opts && opts.maxFriends) || 0) || 5;
  const friendData = await getFriendList(session, callGameCtl, {
    refresh: !opts || opts.refresh !== false,
    sort: true,
    includeSelf: false,
  });
  const friendList = Array.isArray(friendData && friendData.list) ? friendData.list : [];
  const candidates = friendList
    .filter((item) => item && item.workCounts && (Number(item.workCounts.collect) || 0) > 0)
    .sort((a, b) => {
      const diff = (Number(b && b.workCounts && b.workCounts.collect) || 0)
        - (Number(a && a.workCounts && a.workCounts.collect) || 0);
      if (diff !== 0) return diff;
      return (Number(a && a.rank) || 0) - (Number(b && b.rank) || 0);
    })
    .slice(0, maxFriends);
  const visits = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const friend = candidates[i];
    try {
      const enter = await enterFriendFarm(session, callGameCtl, friend.gid, {
        waitMs: enterWaitMs,
        includeAfterOwnership: true,
      });
      const beforeStatus = await getFarmStatus(session, callGameCtl, {
        includeGrids: false,
        includeLandIds: false,
      });
      if (beforeStatus.farmType !== "friend") {
        visits.push({
          ok: false,
          friend,
          enter,
          reason: "not_in_friend_farm",
          status: summarizeFarmStatus(beforeStatus),
        });
        continue;
      }

      const collectBefore = getWorkCount(beforeStatus, "collect");
      if (collectBefore <= 0) {
        visits.push({
          ok: true,
          friend,
          enter,
          reason: "no_collectable_after_enter",
          before: summarizeFarmStatus(beforeStatus),
          after: summarizeFarmStatus(beforeStatus),
        });
        continue;
      }

      const trigger = await triggerOneClickOperation(session, callGameCtl, "HARVEST", {
        includeBefore: false,
        includeAfter: false,
      });
      if (actionWaitMs > 0) {
        await wait(actionWaitMs);
      }
      const afterStatus = await getFarmStatus(session, callGameCtl, {
        includeGrids: false,
        includeLandIds: false,
      });
      const collectAfter = getWorkCount(afterStatus, "collect");
      visits.push({
        ok: true,
        friend,
        enter,
        before: summarizeFarmStatus(beforeStatus),
        after: summarizeFarmStatus(afterStatus),
        trigger,
        collectBefore,
        collectAfter,
      });
    } catch (error) {
      visits.push({
        ok: false,
        friend,
        error: toErrorMessage(error),
      });
      if (opts && opts.stopOnError) break;
    }
  }

  let returnHome = null;
  if (!opts || opts.returnHome !== false) {
    try {
      returnHome = await enterOwnFarm(session, callGameCtl, {
        waitMs: enterWaitMs,
        includeAfterOwnership: true,
      });
    } catch (error) {
      returnHome = {
        ok: false,
        error: toErrorMessage(error),
      };
    }
  }

  return {
    ok: true,
    requestedRefresh: !!(friendData && friendData.requestedRefresh),
    refreshed: !!(friendData && friendData.refreshed),
    refreshError: friendData && friendData.refreshError ? friendData.refreshError : null,
    refreshMode: friendData && friendData.refreshMode ? friendData.refreshMode : "none",
    totalCandidates: Number(friendData && friendData.count) || friendList.length,
    stealableCandidates: candidates.length,
    visits,
    returnHome,
  };
}

async function runAutoFarmCycle({ session, callGameCtl, options }) {
  const opts = options && typeof options === "object" ? options : {};
  const startedAt = new Date().toISOString();
  const ownFarmEnabled = opts.ownFarmEnabled !== false;
  const friendStealEnabled = !!opts.friendStealEnabled;
  const payload = {
    ok: true,
    startedAt,
    ownFarmEnabled,
    friendStealEnabled,
    initialOwnership: null,
    ownFarm: null,
    friendSteal: null,
    finalOwnership: null,
  };

  try {
    payload.initialOwnership = await getFarmOwnership(session, callGameCtl, { allowWeakUi: true });
  } catch (_) {
    payload.initialOwnership = null;
  }

  if (ownFarmEnabled) {
    payload.ownFarm = await runOwnFarmAutomation(session, callGameCtl, {
      includeCollect: opts.includeCollect !== false,
      includeWater: opts.includeWater !== false,
      includeEraseGrass: opts.includeEraseGrass !== false,
      includeKillBug: opts.includeKillBug !== false,
      autoPlantMode: opts.autoPlantMode || "none",
      enterWaitMs: opts.enterWaitMs,
      actionWaitMs: opts.actionWaitMs,
      stopOnError: !!opts.stopOnError,
    });
  }

  if (friendStealEnabled) {
    payload.friendSteal = await runFriendStealAutomation(session, callGameCtl, {
      refresh: opts.refreshFriendList !== false,
      maxFriends: opts.maxFriends,
      enterWaitMs: opts.enterWaitMs,
      actionWaitMs: opts.actionWaitMs,
      returnHome: opts.returnHome !== false,
      stopOnError: !!opts.stopOnError,
    });
  }

  try {
    payload.finalOwnership = await getFarmOwnership(session, callGameCtl, { allowWeakUi: true });
  } catch (_) {
    payload.finalOwnership = null;
  }

  payload.finishedAt = new Date().toISOString();
  return payload;
}

module.exports = {
  runAutoFarmCycle,
};
