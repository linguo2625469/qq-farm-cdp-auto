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
  "autoPlant",
]);

const QQ_RPC_ALLOWED_PATHS = Object.freeze([
  ...QQ_RPC_HOST_METHODS,
  ...QQ_RPC_GAME_CTL_METHODS.map((name) => "gameCtl." + name),
]);

module.exports = {
  QQ_RPC_ALLOWED_PATHS,
  QQ_RPC_GAME_CTL_METHODS,
  QQ_RPC_HOST_METHODS,
};
