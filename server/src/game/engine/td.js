'use strict';
// engine/td.js — Tower Defense (re-exports from engine.js)
const e = require('../engine');
module.exports = {
  createGame:         e.createGame,
  tick:               e.tick,
  getSnapshot:        e.getSnapshot,
  actionPlaceTower:   e.actionPlaceTower,
  actionUpgradePath:  e.actionUpgradePath,
  actionSellTower:    e.actionSellTower,
  actionStartWave:    e.actionStartWave,
  calcStats:          e.calcStats,
  getUpgradeCost:     e.getUpgradeCost,
  findPath:           e.findPath,
  // Constants
  COLS: e.COLS, ROWS: e.ROWS, ENTRY_COL: e.ENTRY_COL, TILE: e.TILE,
};
