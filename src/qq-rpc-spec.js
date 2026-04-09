"use strict";

const QQ_RPC_HOST_METHODS = Object.freeze([
  "host.ping",
  "host.describe",
]);

const QQ_RPC_GAME_CTL_METHODS = Object.freeze([
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
  "autoPlant",
]);

module.exports = {
  QQ_RPC_GAME_CTL_METHODS,
  QQ_RPC_HOST_METHODS,
};
