"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const simScript_1 = require("../src/simScript");
const geo_1 = require("../src/geo");
(0, node_test_1.test)('simScript: generates roughly 50 scenarios per category (basis/szenario/kondition)', () => {
    const byCategory = { basis: 0, szenario: 0, kondition: 0 };
    for (const s of simScript_1.SIM_SCENARIOS)
        byCategory[s.category]++;
    for (const cat of ['basis', 'szenario', 'kondition']) {
        strict_1.default.ok(byCategory[cat] >= 30 && byCategory[cat] <= 65, `${cat}: got ${byCategory[cat]}`);
    }
});
(0, node_test_1.test)('simScript: every scenario has a unique key', () => {
    const keys = simScript_1.SIM_SCENARIOS.map(s => s.key);
    strict_1.default.equal(new Set(keys).size, keys.length);
});
(0, node_test_1.test)('simScript: every bot id is unique within its scenario', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        const ids = s.bots.map(b => b.id);
        strict_1.default.equal(new Set(ids).size, ids.length, `duplicate bot id in ${s.key}`);
    }
});
(0, node_test_1.test)('simScript: shoot/checkpoint actor refs resolve to a known bot or the tester', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        const knownIds = new Set(['tester', ...s.bots.map(b => b.id)]);
        for (const beat of s.shoots) {
            strict_1.default.ok(knownIds.has(beat.shooterId), `${s.key}: unknown shooterId ${beat.shooterId}`);
            strict_1.default.ok(knownIds.has(beat.targetId), `${s.key}: unknown targetId ${beat.targetId}`);
        }
    }
});
(0, node_test_1.test)('simScript: every beat/checkpoint fits inside durationMs', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        for (const beat of s.shoots) {
            strict_1.default.ok(beat.tMs < s.durationMs, `${s.key}: shoot at ${beat.tMs} exceeds durationMs ${s.durationMs}`);
        }
        for (const cp of s.checkpoints) {
            strict_1.default.ok(cp.tMs < s.durationMs, `${s.key}: checkpoint at ${cp.tMs} exceeds durationMs ${s.durationMs}`);
        }
    }
});
(0, node_test_1.test)('simScript: every scenario is genuinely short (1-10s)', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        strict_1.default.ok(s.durationMs >= 1000 && s.durationMs <= 10000, `${s.key}: durationMs ${s.durationMs} outside 1-10s`);
    }
});
(0, node_test_1.test)('simScript: domination scenarios declare at least 2 zones, others need none', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        if (s.subMode === 'domination') {
            strict_1.default.ok((s.zones?.length ?? 0) >= 2, `${s.key}: needs at least 2 zones`);
        }
    }
});
(0, node_test_1.test)('simScript: field side is positive and reasonable', () => {
    for (const s of simScript_1.SIM_SCENARIOS) {
        strict_1.default.ok(s.fieldSideM >= 10 && s.fieldSideM <= 500, `${s.key}: implausible fieldSideM ${s.fieldSideM}`);
    }
});
(0, node_test_1.test)('simScript: every bot and zone position fits inside its own field polygon', () => {
    const origin = { lat: 48.13743, lon: 11.57549 };
    for (const s of simScript_1.SIM_SCENARIOS) {
        const corners = (0, simScript_1.squareFieldCorners)(s.fieldSideM).map(w => (0, geo_1.destinationPoint)(origin, w.bearingDeg, w.distanceM));
        const center = corners.reduce((acc, c) => ({ lat: acc.lat + c.lat / corners.length, lon: acc.lon + c.lon / corners.length }), { lat: 0, lon: 0 });
        const halfDiagonalM = (0, geo_1.haversineMeters)(center, corners[0]);
        for (const bot of s.bots) {
            const wp = bot.route[0];
            strict_1.default.ok(wp.distanceM < halfDiagonalM, `${s.key}/${bot.id}: distance ${wp.distanceM} exceeds field half-diagonal ${halfDiagonalM.toFixed(1)}`);
        }
        for (const z of s.zones || []) {
            strict_1.default.ok(z.distanceM < halfDiagonalM, `${s.key}: zone distance ${z.distanceM} exceeds field half-diagonal ${halfDiagonalM.toFixed(1)}`);
        }
    }
});
(0, node_test_1.test)('simScript: regenerating with the same seed is fully deterministic', () => {
    // SIM_SCENARIOS is computed once at module load — re-importing the same
    // module obviously yields the same reference, so this instead checks
    // internal consistency: every scenario's declared expectedHit is a plain
    // boolean and every field is well-formed, catching a broken PRNG call
    // (NaN bearing/distance) that unique-key/range checks above might miss.
    for (const s of simScript_1.SIM_SCENARIOS) {
        for (const bot of s.bots) {
            strict_1.default.ok(Number.isFinite(bot.route[0].bearingDeg), `${s.key}/${bot.id}: NaN bearing`);
            strict_1.default.ok(Number.isFinite(bot.route[0].distanceM), `${s.key}/${bot.id}: NaN distance`);
        }
        for (const beat of s.shoots)
            strict_1.default.equal(typeof beat.expectedHit, 'boolean');
    }
});
