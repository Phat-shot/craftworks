'use strict';
/**
 * data/maps.js — Builtin map registry
 * Single source of truth for all builtin maps.
 * Workshop route and socket.js both import from here.
 */
const { TA_SEQUENCES } = require('../builtin-maps');

const BUILTIN_MAPS = [
  // ── Tower Defense ─────────────────────────────────────
  {
    id: 'builtin_td_default',
    title: 'Grünes Tal', icon: '🌿', game_mode: 'td', difficulty: 'normal',
    description: 'Klassische TD-Karte',
    bg_style: 'grass', path_style: 'dirt',
    available_races: ['standard','orcs','techies','elemente','urwald'],
    config: {
      difficulty: 'normal', bg_style: 'grass',
      available_races: ['standard','orcs','techies','elemente','urwald'],
    },
  },
  {
    id: 'builtin_td_desert',
    title: 'Wüstenpfad', icon: '🏜️', game_mode: 'td', difficulty: 'hard',
    description: 'Schnelle Gegner, Gruppen-Spawn',
    bg_style: 'desert', path_style: 'sand',
    available_races: ['standard','techies'],
    config: { difficulty: 'hard', bg_style: 'desert', available_races: ['standard','techies'] },
  },
  // ── VS Mode ───────────────────────────────────────────
  {
    id: 'builtin_vs_arena',
    title: 'Zentralarena', icon: '⚔️', game_mode: 'vs', difficulty: 'normal',
    description: 'VS: Kommandozentrale zerstören',
    config: { difficulty: 'normal' },
  },
  // ── Time Attack (2D) ──────────────────────────────────
  {
    id: 'builtin_ta_spiral',
    title: 'Spirale', icon: '🌀', game_mode: 'time_attack', difficulty: 'normal',
    description: 'Time Attack: 50 zufällige Runden, 10–30 Mauern vorbelegt',
    cols: 35, rows: 50,
    available_races: ['standard','orcs','techies','elemente','urwald'],
    config: {
      difficulty: 'normal', bg_style: 'grass',
      available_races: ['standard','orcs','techies','elemente','urwald'],
      ta_layout: {
        cols: 35, rows: 50, rounds: 10,
        gold_per_round: 15, wood_per_round: 2,
        prebuilt_towers: [], prebuilt_sequences: TA_SEQUENCES,
        round_selection: 'random',
      },
    },
  },
  // ── Time Attack (3D) ──────────────────────────────────
  {
    id: 'builtin_ta_spiral_3d',
    title: 'Spirale 3D', icon: '🌐', game_mode: 'time_attack', difficulty: 'normal',
    description: 'Time Attack in 3D — Three.js Low-Poly Renderer',
    cols: 35, rows: 50, renderer: 'threejs',
    available_races: ['standard'],
    config: {
      difficulty: 'normal', bg_style: 'grass', renderer: 'threejs',
      available_races: ['standard'],
      ta_layout: {
        cols: 35, rows: 50, rounds: 10,
        gold_per_round: 15, wood_per_round: 2,
        prebuilt_towers: [], prebuilt_sequences: TA_SEQUENCES,
        round_selection: 'random',
      },
    },
  },
];

/** Find a builtin map by id */
function findBuiltinMap(id) {
  return BUILTIN_MAPS.find(m => m.id === id) || null;
}

/** Get all maps for a given game_mode */
function getMapsByMode(mode) {
  return BUILTIN_MAPS.filter(m => m.game_mode === mode);
}

module.exports = { BUILTIN_MAPS, findBuiltinMap, getMapsByMode };
