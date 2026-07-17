'use strict';
/**
 * data/races.js — TD race definitions
 * Each race has: td_towers (ordered), ta_block (effect type), colors, description
 */

const RACES = {
  standard: {
    id: 'standard', name: 'Standard', icon: '⚔️', color: '#c0a060',
    desc: 'Dart · Gift · Kanone',
    td_towers: ['dart','poison','splash','frost','lightning'],
    ta_block: 'slow_block',
    ta_block_name: 'Slow',
    lore: 'Ausgewogene Allround-Rasse.',
  },
  orcs: {
    id: 'orcs', name: 'Orcs', icon: '💀', color: '#80c020',
    desc: 'Fleischwolf · Wurfspeer · Kriegstrommel',
    td_towers: ['fleischwolf','wurfspeer','kriegstrommel','frost','lightning'],
    ta_block: 'spike_block',
    ta_block_name: 'Spike (Root 1s)',
    lore: 'Brutale Nahkampf- und Belagerungswaffen.',
  },
  techies: {
    id: 'techies', name: 'Techies', icon: '⚙️', color: '#60a8d0',
    desc: 'Mörser · Elektrozaun · Raketenwerfer',
    td_towers: ['mortar','electrofence','rocket','frost','lightning'],
    ta_block: 'mine_block',
    ta_block_name: 'Mine (Stun 1s)',
    lore: 'Explosiver AoE-Schaden und Elektrofallen.',
  },
  elemente: {
    id: 'elemente', name: 'Elemente', icon: '🌊', color: '#40c0e0',
    desc: 'Magmaquelle · Sturmstrudel · Eisspitze',
    td_towers: ['magma','storm','icepike','frost','lightning'],
    ta_block: 'freeze_block',
    ta_block_name: 'Freeze (Slow 50% 2s)',
    lore: 'Naturgewalten: Feuer, Sturm und Eis.',
  },
  urwald: {
    id: 'urwald', name: 'Urwald', icon: '🌿', color: '#40a840',
    desc: 'Rankenfalle · Giftpilz · Mondlichtaltar',
    td_towers: ['vinetrap','poisonshroom','moonaltar','frost','lightning'],
    ta_block: 'root_block',
    ta_block_name: 'Root (Root 1s)',
    lore: 'Vergiftung und Wurzelfallen aus dem Dschungel.',
  },
};

const RACE_IDS = Object.keys(RACES);
const DEFAULT_RACE = 'standard';

module.exports = { RACES, RACE_IDS, DEFAULT_RACE };
