"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const hit_1 = require("../src/hit");
const geo_1 = require("../src/geo");
const types_1 = require("../src/types");
const MUC = { lat: 48.13743, lon: 11.57549 };
const T0 = 1700000000000;
function sample(pos, over = {}) {
    return {
        lat: pos.lat, lon: pos.lon,
        ts: T0, accuracyM: 5, headingDeg: null,
        ...over,
    };
}
function attempt(shooterPos, heading, targetPos, shooterOver = {}, targetOver = {}) {
    return {
        shooterId: 'A', targetId: 'B',
        shooter: sample(shooterPos, { headingDeg: heading, ...shooterOver }),
        target: sample(targetPos, targetOver),
    };
}
// ── Happy path ──────────────────────────────────────────────
(0, node_test_1.test)('hit: dead-center aim at 50m is a confident hit', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50); // 50m north
    const v = (0, hit_1.validateHit)(attempt(MUC, 0, target)); // aiming exactly north
    strict_1.default.equal(v.hit, true);
    strict_1.default.equal(v.reason, null);
    strict_1.default.ok(v.confidence > 0.7, `confidence ${v.confidence} should be > 0.7`);
    strict_1.default.ok(v.angleDeltaDeg < 0.1);
});
(0, node_test_1.test)('hit: works for arbitrary bearings', () => {
    for (const brg of [37, 123, 258, 341]) {
        const target = (0, geo_1.destinationPoint)(MUC, brg, 40);
        const v = (0, hit_1.validateHit)(attempt(MUC, brg, target));
        strict_1.default.equal(v.hit, true, `bearing ${brg} should hit`);
    }
});
// ── Hard fails ──────────────────────────────────────────────
(0, node_test_1.test)('miss: no compass heading', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50);
    const v = (0, hit_1.validateHit)(attempt(MUC, null, target));
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'no_heading');
    strict_1.default.equal(v.confidence, 0);
});
(0, node_test_1.test)('miss: stale target sample (time skew)', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50);
    const v = (0, hit_1.validateHit)(attempt(MUC, 0, target, {}, { ts: T0 - 8000 }) // target sample 8s old (> 5s limit)
    );
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'time_skew');
});
(0, node_test_1.test)('miss: out of range', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 200); // beyond 75m default
    const v = (0, hit_1.validateHit)(attempt(MUC, 0, target));
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'out_of_range');
});
(0, node_test_1.test)('miss: aiming 90° away', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50); // target north
    const v = (0, hit_1.validateHit)(attempt(MUC, 90, target)); // aiming east
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'outside_cone');
    strict_1.default.ok(Math.abs(v.angleDeltaDeg - 90) < 0.1);
});
(0, node_test_1.test)('miss: slightly outside the cone at long range', () => {
    // At 70m with 5+5m accuracy: tolerance = 10 + atan(10/70) ≈ 18.1°
    const target = (0, geo_1.destinationPoint)(MUC, 0, 70);
    const v = (0, hit_1.validateHit)(attempt(MUC, 25, target)); // 25° off
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'outside_cone');
});
// ── Tolerance behavior ──────────────────────────────────────
(0, node_test_1.test)('tolerance: widens as GPS accuracy degrades', () => {
    const tGood = (0, hit_1.hitToleranceDeg)(50, 5); // 5m combined error at 50m
    const tBad = (0, hit_1.hitToleranceDeg)(50, 25); // 25m combined error
    strict_1.default.ok(tBad > tGood, `bad GPS (${tBad}°) should give wider cone than good (${tGood}°)`);
});
(0, node_test_1.test)('tolerance: narrows with distance (same accuracy)', () => {
    const tNear = (0, hit_1.hitToleranceDeg)(15, 10);
    const tFar = (0, hit_1.hitToleranceDeg)(70, 10);
    strict_1.default.ok(tNear > tFar, `near (${tNear}°) should be wider than far (${tFar}°)`);
});
(0, node_test_1.test)('tolerance: capped at maxToleranceDeg', () => {
    const t = (0, hit_1.hitToleranceDeg)(2, 50); // absurd: 50m error at 2m distance
    strict_1.default.equal(t, types_1.DEFAULT_HIT_CONFIG.maxToleranceDeg);
});
(0, node_test_1.test)('hit: bad GPS at close range still hits inside widened cone', () => {
    // 20m distance, poor accuracy on both sides (12m each → 24m combined)
    // tolerance = 10 + atan(24/20) ≈ 60.2° → capped at 40°
    const target = (0, geo_1.destinationPoint)(MUC, 0, 20);
    const v = (0, hit_1.validateHit)(attempt(MUC, 30, target, { accuracyM: 12 }, { accuracyM: 12 }) // 30° off
    );
    strict_1.default.equal(v.hit, true, `30° off should hit inside ${v.toleranceDeg}° cone`);
});
// ── Confidence ordering ─────────────────────────────────────
(0, node_test_1.test)('confidence: centered aim scores higher than edge-of-cone aim', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50);
    const centered = (0, hit_1.validateHit)(attempt(MUC, 0, target));
    const offAxis = (0, hit_1.validateHit)(attempt(MUC, 12, target)); // near cone edge
    strict_1.default.ok(centered.confidence > offAxis.confidence, `${centered.confidence} > ${offAxis.confidence}`);
});
(0, node_test_1.test)('confidence: fresh samples score higher than near-stale ones', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50);
    const fresh = (0, hit_1.validateHit)(attempt(MUC, 0, target));
    const stale = (0, hit_1.validateHit)(attempt(MUC, 0, target, {}, { ts: T0 - 2500 }));
    strict_1.default.ok(fresh.confidence > stale.confidence);
});
// ── Verdict diagnostics ─────────────────────────────────────
(0, node_test_1.test)('verdict: reports distance and bearing delta correctly', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 45, 60);
    const trueBearing = (0, geo_1.bearingDeg)(MUC, target);
    const v = (0, hit_1.validateHit)(attempt(MUC, trueBearing + 5, target));
    strict_1.default.ok(Math.abs(v.distanceM - 60) < 0.1);
    strict_1.default.ok(Math.abs(v.angleDeltaDeg - 5) < 0.1);
});
(0, node_test_1.test)('verdict: deterministic (same input → same output)', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 10, 45);
    const a = (0, hit_1.validateHit)(attempt(MUC, 12, target));
    const b = (0, hit_1.validateHit)(attempt(MUC, 12, target));
    strict_1.default.deepEqual(a, b);
});
// ── pickTargetSample (interpolation) ────────────────────────
const hit_2 = require("../src/hit");
(0, node_test_1.test)('pickTargetSample: interpolates between bracketing samples', () => {
    const a = sample(MUC, { ts: T0 });
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 10), { ts: T0 + 2000 }); // 10m north in 2s
    const mid = (0, hit_2.pickTargetSample)([a, b], T0 + 1000);
    // Halfway → ~5m north of MUC
    const d = Math.abs(5 - (mid.lat - MUC.lat) / (b.lat - MUC.lat) * 10);
    strict_1.default.ok(d < 0.1, `interpolated ~5m, off by ${d}`);
    strict_1.default.equal(mid.ts, T0 + 1000);
});
(0, node_test_1.test)('pickTargetSample: falls back to nearest outside the bracket', () => {
    const a = sample(MUC, { ts: T0 });
    const b = sample((0, geo_1.destinationPoint)(MUC, 0, 10), { ts: T0 + 2000 });
    const late = (0, hit_2.pickTargetSample)([a, b], T0 + 9000);
    strict_1.default.equal(late.ts, b.ts); // nearest = b, no extrapolation
});
(0, node_test_1.test)('pickTargetSample: empty buffer → null', () => {
    strict_1.default.equal((0, hit_2.pickTargetSample)([], T0), null);
});
