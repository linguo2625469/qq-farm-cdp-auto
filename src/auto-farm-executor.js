"use strict";

const {
  normalizeAutoPlantMode,
  normalizeAutoPlantSource,
  readAutoPlantSelectedSeedKey,
} = require("./auto-farm-plant-config");

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

function normalizeText(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeMatchText(value) {
  return normalizeText(value).replace(/\s+/g, "").toLowerCase();
}

function toPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getPriorityId(item) {
  return (
    toPositiveNumber(item && item.seedId)
    || toPositiveNumber(item && item.itemId)
    || toPositiveNumber(item && item.goodsId)
    || 0
  );
}

function makeSeedKey(source, item) {
  if (source === "shop") {
    return `${source}:${toPositiveNumber(item && item.goodsId) || toPositiveNumber(item && item.itemId) || toPositiveNumber(item && item.seedId) || 0}`;
  }
  return `${source}:${toPositiveNumber(item && item.itemId) || toPositiveNumber(item && item.seedId) || toPositiveNumber(item && item.goodsId) || 0}`;
}

function decorateSeedList(list, source, opts) {
  const availableOnly = !opts || opts.availableOnly !== false;
  return (Array.isArray(list) ? list : [])
    .filter((item) => !!item && !item.isMultiLandPlant)
    .filter((item) => {
      if (source !== "backpack" || !availableOnly) return true;
      return (Number(item.count) || 0) > 0;
    })
    .map((item) => ({
      ...item,
      source,
      key: makeSeedKey(source, item),
    }));
}

function compareSeedMetrics(a, b) {
  const keys = ["level", "layer", "rarity"];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const diff = (Number(a && a[key]) || 0) - (Number(b && b[key]) || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function isBetterSeed(next, current, order) {
  if (!current) return true;
  const metricDiff = compareSeedMetrics(next, current);
  if (metricDiff !== 0) {
    return order === "lowest" ? metricDiff < 0 : metricDiff > 0;
  }

  if (next.source !== current.source) {
    if (next.source === "backpack") return true;
    if (current.source === "backpack") return false;
  }

  return getPriorityId(next) < getPriorityId(current);
}

function pickPrioritySeed(list, order) {
  const items = Array.isArray(list) ? list : [];
  let best = null;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item) continue;
    if (isBetterSeed(item, best, order)) {
      best = item;
    }
  }
  return best;
}

function parseSeedKey(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const match = raw.match(/^(backpack|shop):(.*)$/i);
  if (!match) {
    return {
      source: null,
      raw,
      idOrName: raw,
    };
  }
  return {
    source: String(match[1]).toLowerCase(),
    raw,
    idOrName: normalizeText(match[2]),
  };
}

function matchSeedCandidate(item, target) {
  if (!item) return false;
  const parsed = parseSeedKey(target);
  if (!parsed || !parsed.idOrName) return false;

  if (parsed.source && item.source !== parsed.source) return false;
  if (item.key === parsed.raw) return true;

  const targetId = toPositiveNumber(parsed.idOrName);
  if (targetId != null) {
    if (toPositiveNumber(item.seedId) === targetId) return true;
    if (toPositiveNumber(item.itemId) === targetId) return true;
    if (toPositiveNumber(item.goodsId) === targetId) return true;
  }

  const targetText = normalizeMatchText(parsed.idOrName);
  return !!targetText && normalizeMatchText(item.name) === targetText;
}

function filterCandidatesBySource(list, source) {
  if (source === "auto") return Array.isArray(list) ? list.slice() : [];
  return (Array.isArray(list) ? list : []).filter((item) => item && item.source === source);
}

function collectEmptyLandIds(status) {
  const grids = Array.isArray(status && status.grids) ? status.grids : [];
  const seen = new Set();
  const out = [];

  for (let i = 0; i < grids.length; i += 1) {
    const grid = grids[i];
    const landId = toPositiveNumber(grid && grid.landId);
    if (landId == null || seen.has(landId)) continue;
    if (grid && grid.stageKind === "empty") {
      seen.add(landId);
      out.push(landId);
    }
  }

  return out;
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

async function getSeedList(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.getSeedList", [withSilent(opts)]);
}

async function getShopSeedList(session, callGameCtl, opts) {
  return await callGameCtl(session, "gameCtl.getShopSeedList", [withSilent(opts)]);
}

async function buyShopGoods(session, callGameCtl, goodsId, num, price) {
  return await callGameCtl(session, "gameCtl.buyShopGoods", [goodsId, num, price]);
}

async function plantSeedsOnLands(session, callGameCtl, seedIdOrItemId, landIds, opts) {
  return await callGameCtl(session, "gameCtl.plantSeedsOnLands", [
    seedIdOrItemId,
    Array.isArray(landIds) ? landIds : [landIds],
    withSilent(opts),
  ]);
}

async function clickMatureEffect(session, callGameCtl, landId, opts) {
  return await callGameCtl(session, "gameCtl.clickMatureEffect", [
    landId,
    withSilent(opts),
  ]);
}

function collectMatureLandIds(status) {
  const grids = Array.isArray(status && status.grids) ? status.grids : [];
  const seen = new Set();
  const out = [];

  for (let i = 0; i < grids.length; i += 1) {
    const grid = grids[i];
    const landId = toPositiveNumber(grid && grid.landId);
    if (landId == null || seen.has(landId)) continue;
    if (!grid || grid.stageKind !== "mature") continue;
    if (!(grid.canCollect || grid.canHarvest || grid.canSteal || grid.isMature)) continue;
    seen.add(landId);
    out.push(landId);
  }

  return out;
}

async function runSupplementalMatureEffectHarvest(session, callGameCtl, opts) {
  const rawOpts = opts && typeof opts === "object" ? opts : {};
  const actionWaitMs = Math.max(0, Number(rawOpts.actionWaitMs) || 0);
  const statusBefore = await getFarmStatus(session, callGameCtl, {
    includeGrids: true,
    includeLandIds: false,
  });
  const farmType = statusBefore && statusBefore.farmType ? statusBefore.farmType : "unknown";
  const candidateLandIds = collectMatureLandIds(statusBefore);

  if (candidateLandIds.length === 0) {
    return {
      ok: true,
      completed: true,
      farmType,
      action: "skip",
      candidateCount: 0,
      candidateLandIds: [],
      remainingCount: 0,
      remainingLandIds: [],
      before: summarizeFarmStatus(statusBefore),
      after: summarizeFarmStatus(statusBefore),
      actions: [],
    };
  }

  const actions = [];
  for (let i = 0; i < candidateLandIds.length; i += 1) {
    const landId = candidateLandIds[i];
    try {
      const result = await clickMatureEffect(session, callGameCtl, landId, {
        waitForResult: rawOpts.waitForResult !== false,
        timeoutMs: rawOpts.timeoutMs,
        pollMs: rawOpts.pollMs,
        fallbackDispatch: rawOpts.fallbackDispatch !== false,
      });
      actions.push({
        ok: !!(result && result.ok),
        landId,
        result,
      });
    } catch (error) {
      actions.push({
        ok: false,
        landId,
        error: toErrorMessage(error),
      });
      if (rawOpts.stopOnError) break;
    }

    if (actionWaitMs > 0 && i < candidateLandIds.length - 1) {
      await wait(actionWaitMs);
    }
  }

  const statusAfter = await getFarmStatus(session, callGameCtl, {
    includeGrids: true,
    includeLandIds: false,
  });
  const remainingLandIds = collectMatureLandIds(statusAfter);
  const completed = remainingLandIds.length === 0;

  return {
    ok: completed,
    completed,
    farmType,
    action: "supplemental_mature_effect_harvest",
    candidateCount: candidateLandIds.length,
    candidateLandIds,
    remainingCount: remainingLandIds.length,
    remainingLandIds,
    before: summarizeFarmStatus(statusBefore),
    after: summarizeFarmStatus(statusAfter),
    actions,
  };
}

async function getAutoPlantSeedCatalog(session, callGameCtl, opts) {
  const includeBackpack = !opts || opts.includeBackpack !== false;
  const includeShop = !opts || opts.includeShop !== false;
  const availableOnly = !opts || opts.availableOnly !== false;
  const catalog = {
    fetchedAt: new Date().toISOString(),
    availableOnly,
    backpack: [],
    shop: [],
    all: [],
    counts: {
      backpack: 0,
      shop: 0,
      all: 0,
    },
    errors: {},
  };

  const tasks = [];

  if (includeBackpack) {
    tasks.push(
      getSeedList(session, callGameCtl, {
        availableOnly,
        sortMode: opts && opts.sortMode != null ? opts.sortMode : 3,
      })
        .then((list) => {
          catalog.backpack = decorateSeedList(list, "backpack", { availableOnly });
        })
        .catch((error) => {
          catalog.errors.backpack = toErrorMessage(error);
        }),
    );
  }

  if (includeShop) {
    tasks.push(
      getShopSeedList(session, callGameCtl, {
        ensureData: !opts || opts.ensureShopData !== false,
        shopId: opts && opts.shopId != null ? opts.shopId : 2,
        sortByLevel: true,
        availableOnly: true,
        closeOverlayAfterEnsure: !!(opts && opts.closeOverlayAfterEnsure),
      })
        .then((list) => {
          catalog.shop = decorateSeedList(list, "shop", { availableOnly: false });
        })
        .catch((error) => {
          catalog.errors.shop = toErrorMessage(error);
        }),
    );
  }

  await Promise.all(tasks);

  catalog.all = catalog.backpack.concat(catalog.shop);
  catalog.counts = {
    backpack: catalog.backpack.length,
    shop: catalog.shop.length,
    all: catalog.all.length,
  };

  return catalog;
}

function resolveSelectedSeedTarget(catalog, source, selectedSeedKey) {
  const parsed = parseSeedKey(selectedSeedKey);
  const strictSource = source === "auto" ? (parsed && parsed.source ? parsed.source : "auto") : source;
  const candidates = filterCandidatesBySource(catalog && catalog.all, strictSource);
  const matched = candidates.find((item) => matchSeedCandidate(item, selectedSeedKey)) || null;

  if (matched) {
    return {
      candidate: matched,
      reason: null,
    };
  }

  if (strictSource === "backpack") {
    return { candidate: null, reason: "selected_seed_not_found_in_backpack" };
  }
  if (strictSource === "shop") {
    return { candidate: null, reason: "selected_seed_not_found_in_shop" };
  }
  return { candidate: null, reason: "selected_seed_not_found" };
}

function resolvePrioritySeedTarget(catalog, source, mode) {
  const candidates = filterCandidatesBySource(catalog && catalog.all, source);
  const order = mode === "lowest" ? "lowest" : "highest";
  const candidate = pickPrioritySeed(candidates, order);
  if (candidate) {
    return { candidate, reason: null };
  }
  if (source === "backpack") return { candidate: null, reason: "no_seeds_in_backpack" };
  if (source === "shop") return { candidate: null, reason: "no_seeds_in_shop" };
  return { candidate: null, reason: "no_seed_available" };
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
  let specialCollect = null;

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const beforeCount = getWorkCount(currentStatus, spec.key);
    if (beforeCount <= 0) {
      if (spec.key === "collect" && (!opts || opts.includeSpecialCollect !== false)) {
        try {
          specialCollect = await runSupplementalMatureEffectHarvest(session, callGameCtl, {
            actionWaitMs,
            timeoutMs: opts && opts.timeoutMs,
            pollMs: opts && opts.pollMs,
            stopOnError: !!(opts && opts.stopOnError),
          });
          if (specialCollect.candidateCount > 0) {
            currentStatus = await getFarmStatus(session, callGameCtl, {
              includeGrids: false,
              includeLandIds: false,
            });
          }
        } catch (error) {
          specialCollect = {
            ok: false,
            error: toErrorMessage(error),
          };
          if (opts && opts.stopOnError) break;
        }
      }
      continue;
    }

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

      if (spec.key === "collect" && (!opts || opts.includeSpecialCollect !== false)) {
        try {
          specialCollect = await runSupplementalMatureEffectHarvest(session, callGameCtl, {
            actionWaitMs,
            timeoutMs: opts && opts.timeoutMs,
            pollMs: opts && opts.pollMs,
            stopOnError: !!(opts && opts.stopOnError),
          });
          if (specialCollect.candidateCount > 0) {
            currentStatus = await getFarmStatus(session, callGameCtl, {
              includeGrids: false,
              includeLandIds: false,
            });
          }
        } catch (error) {
          specialCollect = {
            ok: false,
            error: toErrorMessage(error),
          };
          if (opts && opts.stopOnError) break;
        }
      }
    } catch (error) {
      actions.push({
        ok: false,
        key: spec.key,
        op: spec.op,
        beforeCount,
        error: toErrorMessage(error),
      });

      if (spec.key === "collect" && (!opts || opts.includeSpecialCollect !== false) && (!opts || !opts.stopOnError)) {
        try {
          specialCollect = await runSupplementalMatureEffectHarvest(session, callGameCtl, {
            actionWaitMs,
            timeoutMs: opts && opts.timeoutMs,
            pollMs: opts && opts.pollMs,
            stopOnError: false,
          });
          if (specialCollect.candidateCount > 0) {
            currentStatus = await getFarmStatus(session, callGameCtl, {
              includeGrids: false,
              includeLandIds: false,
            });
          }
        } catch (supplementError) {
          specialCollect = {
            ok: false,
            error: toErrorMessage(supplementError),
          };
        }
      }

      if (opts && opts.stopOnError) break;
    }
  }

  return {
    farmType,
    before: summarizeFarmStatus(statusBefore),
    after: summarizeFarmStatus(currentStatus),
    actions,
    specialCollect,
  };
}

async function autoPlant(session, callGameCtl, opts) {
  const rawOpts = opts && typeof opts === "object" ? opts : {};
  const mode = normalizeAutoPlantMode(rawOpts.autoPlantMode ?? rawOpts.mode);
  const source = normalizeAutoPlantSource(rawOpts.autoPlantSource ?? rawOpts.source, rawOpts.autoPlantMode ?? rawOpts.mode);
  const selectedSeedKey = readAutoPlantSelectedSeedKey(rawOpts);

  if (mode === "none") {
    return {
      ok: true,
      mode,
      source,
      action: "skip",
    };
  }

  const status = await getFarmStatus(session, callGameCtl, {
    includeGrids: true,
    includeLandIds: false,
  });

  if (!status || status.farmType !== "own") {
    return {
      ok: false,
      mode,
      source,
      reason: "not_own_farm",
      status: summarizeFarmStatus(status),
    };
  }

  const emptyLandIds = collectEmptyLandIds(status);
  if (emptyLandIds.length === 0) {
    return {
      ok: true,
      mode,
      source,
      action: "no_empty_lands",
      emptyCount: 0,
    };
  }

  if (mode === "selected" && !selectedSeedKey) {
    return {
      ok: false,
      mode,
      source,
      reason: "selected_seed_required",
      emptyCount: emptyLandIds.length,
    };
  }

  const parsedSelected = parseSeedKey(selectedSeedKey);
  const needBackpack = mode !== "selected"
    ? source !== "shop"
    : source !== "shop" || !parsedSelected || parsedSelected.source === "backpack";
  const needShop = mode !== "selected"
    ? source !== "backpack"
    : source !== "backpack" || !parsedSelected || parsedSelected.source === "shop";

  const catalog = await getAutoPlantSeedCatalog(session, callGameCtl, {
    includeBackpack: needBackpack,
    includeShop: needShop,
    availableOnly: true,
    ensureShopData: true,
  });

  const catalogErrors = Object.keys(catalog.errors || {});
  if (catalogErrors.length > 0 && catalog.counts.all <= 0) {
    return {
      ok: false,
      mode,
      source,
      reason: "seed_catalog_error",
      catalog,
      emptyCount: emptyLandIds.length,
    };
  }

  const target = mode === "selected"
    ? resolveSelectedSeedTarget(catalog, source, selectedSeedKey)
    : resolvePrioritySeedTarget(catalog, source, mode);

  if (!target.candidate) {
    return {
      ok: false,
      mode,
      source,
      reason: target.reason,
      selectedSeedKey: selectedSeedKey || null,
      emptyCount: emptyLandIds.length,
      catalogCounts: catalog.counts,
      catalogErrors: catalog.errors,
    };
  }

  const chosen = target.candidate;
  let buyResult = null;

  if (chosen.source === "shop") {
    if (toPositiveNumber(chosen.goodsId) == null) {
      return {
        ok: false,
        mode,
        source,
        reason: "shop_seed_goods_id_missing",
        selectedSeedKey: chosen.key,
        targetSeed: chosen,
        emptyCount: emptyLandIds.length,
      };
    }

    buyResult = await buyShopGoods(
      session,
      callGameCtl,
      chosen.goodsId,
      emptyLandIds.length,
      chosen.price,
    );
    if (!buyResult || !buyResult.ok) {
      return {
        ok: false,
        mode,
        source,
        reason: "buy_failed",
        selectedSeedKey: chosen.key,
        targetSeed: chosen,
        emptyCount: emptyLandIds.length,
        buyResult,
      };
    }

    const buyWaitMs = rawOpts.buyWaitMs == null
      ? Math.max(120, Number(rawOpts.actionWaitMs) || 0)
      : Math.max(0, Number(rawOpts.buyWaitMs) || 0);
    if (buyWaitMs > 0) {
      await wait(buyWaitMs);
    }
  }

  const plantSeedId = chosen.seedId ?? chosen.itemId ?? chosen.goodsId;
  const plantResult = await plantSeedsOnLands(session, callGameCtl, plantSeedId, emptyLandIds, {
    waitForResult: rawOpts.waitForResult !== false,
    timeoutMs: rawOpts.timeoutMs,
    pollMs: rawOpts.pollMs,
    intervalMs: rawOpts.intervalMs,
    stopOnError: !!rawOpts.stopOnError,
  });

  return {
    ok: !!(plantResult && plantResult.ok),
    mode,
    source,
    action: plantResult && plantResult.action ? plantResult.action : "plant_single_batch",
    emptyCount: emptyLandIds.length,
    seedId: plantSeedId,
    seedName: chosen.name || null,
    seedSource: chosen.source,
    selectedSeedKey: chosen.key,
    targetSeed: chosen,
    buyResult,
    plantResult,
    catalogCounts: catalog.counts,
    catalogErrors: catalog.errors,
  };
}

/**
 * QQ 端直接调用客户端 gameCtl.autoPlant，所有逻辑在游戏上下文内完成，
 * 避免多次 WebSocket 往返导致的超时问题。
 */
async function runClientAutoPlant(session, callGameCtl, opts) {
  const plantMode = normalizeAutoPlantMode(opts && opts.autoPlantMode);
  const plantSource = normalizeAutoPlantSource(opts && opts.autoPlantSource, opts && opts.autoPlantMode);
  const selectedKey = readAutoPlantSelectedSeedKey(opts);

  // 把 "backpack:123" / "shop:456" 格式拆出原始 ID
  let selectedSeedId = undefined;
  if (selectedKey) {
    const match = selectedKey.match(/^(?:backpack|shop):(.+)$/i);
    selectedSeedId = match ? match[1].trim() : selectedKey;
  }

  return await callGameCtl(session, "gameCtl.autoPlant", [{
    mode: plantMode,
    source: plantSource,
    selectedSeedId,
    buyWaitMs: opts && opts.buyWaitMs,
    waitForResult: true,
    timeoutMs: opts && opts.timeoutMs,
    pollMs: opts && opts.pollMs,
    intervalMs: opts && opts.intervalMs,
    stopOnError: !!(opts && opts.stopOnError),
  }]);
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
    includeSpecialCollect: !opts || opts.includeSpecialCollect !== false,
    actionWaitMs: opts && opts.actionWaitMs,
    timeoutMs: opts && opts.timeoutMs,
    pollMs: opts && opts.pollMs,
    stopOnError: !!(opts && opts.stopOnError),
  });

  const plantMode = normalizeAutoPlantMode(opts && opts.autoPlantMode);
  let plantResult = null;
  if (plantMode !== "none") {
    try {
      if (actionWaitMs > 0) {
        await wait(actionWaitMs);
      }
      
        plantResult = await autoPlant(session, callGameCtl, {
          autoPlantMode: plantMode,
          autoPlantSource: opts && opts.autoPlantSource,
          autoFarmPlantSelectedSeedKey: opts && opts.autoPlantSelectedSeedKey,
          actionWaitMs: opts && opts.actionWaitMs,
          buyWaitMs: opts && opts.buyWaitMs,
          timeoutMs: opts && opts.timeoutMs,
          pollMs: opts && opts.pollMs,
          intervalMs: opts && opts.intervalMs,
          stopOnError: !!(opts && opts.stopOnError),
        });
      
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
  const includeSpecialCollect = !opts || opts.includeSpecialCollect !== false;
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
        let specialCollect = null;
        let finalStatus = beforeStatus;
        if (includeSpecialCollect) {
          try {
            specialCollect = await runSupplementalMatureEffectHarvest(session, callGameCtl, {
              actionWaitMs,
              timeoutMs: opts && opts.timeoutMs,
              pollMs: opts && opts.pollMs,
              stopOnError: !!(opts && opts.stopOnError),
            });
            if (specialCollect.candidateCount > 0) {
              finalStatus = await getFarmStatus(session, callGameCtl, {
                includeGrids: false,
                includeLandIds: false,
              });
            }
          } catch (error) {
            specialCollect = {
              ok: false,
              error: toErrorMessage(error),
            };
          }
        }

        visits.push({
          ok: !specialCollect || specialCollect.ok !== false,
          friend,
          enter,
          reason: specialCollect && specialCollect.candidateCount > 0
            ? "special_collect_only"
            : "no_collectable_after_enter",
          before: summarizeFarmStatus(beforeStatus),
          after: summarizeFarmStatus(finalStatus),
          specialCollect,
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
      let finalStatus = afterStatus;
      let specialCollect = null;
      if (includeSpecialCollect) {
        try {
          specialCollect = await runSupplementalMatureEffectHarvest(session, callGameCtl, {
            actionWaitMs,
            timeoutMs: opts && opts.timeoutMs,
            pollMs: opts && opts.pollMs,
            stopOnError: !!(opts && opts.stopOnError),
          });
          if (specialCollect.candidateCount > 0) {
            finalStatus = await getFarmStatus(session, callGameCtl, {
              includeGrids: false,
              includeLandIds: false,
            });
          }
        } catch (error) {
          specialCollect = {
            ok: false,
            error: toErrorMessage(error),
          };
        }
      }
      const collectAfter = getWorkCount(finalStatus, "collect");
      visits.push({
        ok: !specialCollect || specialCollect.ok !== false,
        friend,
        enter,
        before: summarizeFarmStatus(beforeStatus),
        after: summarizeFarmStatus(finalStatus),
        afterOneClick: summarizeFarmStatus(afterStatus),
        trigger,
        collectBefore,
        collectAfter,
        specialCollect,
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
      autoPlantSource: opts.autoPlantSource || "auto",
      autoPlantSelectedSeedKey: opts.autoPlantSelectedSeedKey || "",
      includeSpecialCollect: opts.includeSpecialCollect !== false,
      useClientAutoPlant: !!opts.useClientAutoPlant,
      enterWaitMs: opts.enterWaitMs,
      actionWaitMs: opts.actionWaitMs,
      buyWaitMs: opts.buyWaitMs,
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
      intervalMs: opts.intervalMs,
      stopOnError: !!opts.stopOnError,
    });
  }

  if (friendStealEnabled) {
    payload.friendSteal = await runFriendStealAutomation(session, callGameCtl, {
      refresh: opts.refreshFriendList !== false,
      maxFriends: opts.maxFriends,
      enterWaitMs: opts.enterWaitMs,
      actionWaitMs: opts.actionWaitMs,
      includeSpecialCollect: opts.includeSpecialCollect !== false,
      timeoutMs: opts.timeoutMs,
      pollMs: opts.pollMs,
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
  getAutoPlantSeedCatalog,
  runAutoFarmCycle,
};
