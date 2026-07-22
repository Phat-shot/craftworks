"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const simScript_1 = require("../src/simScript");
(0, node_test_1.test)('simScript: every snippet has a unique key', () => {
    const keys = simScript_1.SIM_SNIPPETS.map(s => s.key);
    strict_1.default.equal(new Set(keys).size, keys.length);
});
(0, node_test_1.test)('simScript: every bot id is unique within its snippet', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        const ids = s.bots.map(b => b.id);
        strict_1.default.equal(new Set(ids).size, ids.length, `duplicate bot id in ${s.key}`);
    }
});
(0, node_test_1.test)('simScript: shoot/checkpoint actor refs resolve to a known bot or the tester', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        const knownIds = new Set(['tester', ...s.bots.map(b => b.id)]);
        for (const beat of s.shoots) {
            strict_1.default.ok(knownIds.has(beat.shooterId), `${s.key}: unknown shooterId ${beat.shooterId}`);
            strict_1.default.ok(knownIds.has(beat.targetId), `${s.key}: unknown targetId ${beat.targetId}`);
        }
    }
});
(0, node_test_1.test)('simScript: per-actor route/shoot timestamps are non-decreasing', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        for (const bot of s.bots) {
            const ts = bot.route.map(w => w.tMs);
            strict_1.default.deepEqual(ts, [...ts].sort((a, b) => a - b), `${s.key}/${bot.id}: route not chronological`);
            strict_1.default.equal(bot.route[0]?.tMs, 0, `${s.key}/${bot.id}: route must start at tMs=0`);
        }
        const shootTs = s.shoots.map(b => b.tMs);
        strict_1.default.deepEqual(shootTs, [...shootTs].sort((a, b) => a - b), `${s.key}: shoots not chronological`);
    }
});
(0, node_test_1.test)('simScript: every beat/checkpoint fits inside durationMs', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        for (const beat of s.shoots) {
            strict_1.default.ok(beat.tMs < s.durationMs, `${s.key}: shoot at ${beat.tMs} exceeds durationMs ${s.durationMs}`);
        }
        for (const cp of s.checkpoints) {
            strict_1.default.ok(cp.tMs < s.durationMs, `${s.key}: checkpoint at ${cp.tMs} exceeds durationMs ${s.durationMs}`);
        }
        for (const bot of s.bots) {
            for (const w of bot.route) {
                strict_1.default.ok(w.tMs < s.durationMs, `${s.key}/${bot.id}: waypoint at ${w.tMs} exceeds durationMs ${s.durationMs}`);
            }
        }
    }
});
(0, node_test_1.test)('simScript: domination/seek_destroy snippets declare zones, others do not need to', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        if (s.subMode === 'domination' || s.subMode === 'seek_destroy') {
            strict_1.default.ok((s.zones?.length ?? 0) >= 1, `${s.key}: needs at least one zone`);
        }
    }
});
(0, node_test_1.test)('simScript: field side is positive and reasonable', () => {
    for (const s of simScript_1.SIM_SNIPPETS) {
        strict_1.default.ok(s.fieldSideM >= 10 && s.fieldSideM <= 500, `${s.key}: implausible fieldSideM ${s.fieldSideM}`);
    }
});
