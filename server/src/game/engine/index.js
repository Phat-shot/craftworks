'use strict';
/**
 * engine/index.js — Game engine grouped by mode
 * Import a whole mode: const { createGame } = require('./engine/td')
 * Or everything:       const engine = require('./engine')
 */
module.exports = {
  td:  require('./td'),
  vs:  require('./vs'),
  ta:  require('./ta'),
  pve: require('./pve'),
};
