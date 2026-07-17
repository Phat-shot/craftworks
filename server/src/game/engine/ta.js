'use strict';
// engine/ta.js — Time Attack (re-exports from engine.js)
const e = require('../engine');
module.exports = {
  createTimeAttackGame: e.createTimeAttackGame,
  tickTimeAttack:       e.tickTimeAttack,
  getTaSnapshot:        e.getTaSnapshot,
  actionTaPlaceTower:   e.actionTaPlaceTower,
  actionTaRemoveTower:  e.actionTaRemoveTower,
  actionTaReady:        e.actionTaReady,
};
