'use strict';
/**
 * game/index.js — Main game module entry point
 *
 * Usage:
 *   const game = require('./game');
 *   game.engine.td.createGame(...)
 *   game.data.RACES
 *   game.data.GENERALS_FACTIONS
 *   game.data.BUILTIN_MAPS
 *
 * Or destructure by concern:
 *   const { td, vs, ta } = require('./game').engine;
 *   const { RACES, BUILTIN_MAPS } = require('./game').data;
 */

const engine = require('./engine/index');
const data   = require('./data/index');

module.exports = {
  engine,
  data,
  // Flat re-exports for backward compat (worker.js, socket.js)
  ...require('./engine'),
};
