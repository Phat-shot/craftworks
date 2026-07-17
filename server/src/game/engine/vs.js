'use strict';
// engine/vs.js — VS / Generals (re-exports from engine.js)
const e = require('../engine');
module.exports = {
  createVsGame:  e.createVsGame,
  tickVs:        e.tickVs,
  getVsSnapshot: e.getVsSnapshot,
  actionVs:      e.actionVs,
  VS_COLS: e.VS_COLS, VS_ROWS: e.VS_ROWS,
};
