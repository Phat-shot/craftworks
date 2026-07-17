'use strict';
/**
 * data/index.js — Central data export
 * Import everything from one place: require('../data')
 */
const races    = require('./races');
const factions = require('./factions');
const maps     = require('./maps');

module.exports = {
  // Races (TD)
  ...races,
  // Factions (VS generals)
  ...factions,
  // Maps
  ...maps,
};
