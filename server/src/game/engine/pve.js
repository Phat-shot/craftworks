'use strict';
// engine/pve.js — PvE (re-exports from engine.js)
const e = require('../engine');
module.exports = {
  createPveGame:  e.createPveGame,
  tickPve:        e.tickPve,
  getPveSnapshot: e.getPveSnapshot,
};
