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
// ── validateHitLateral (Sniper: fixed lateral tolerance, not a widening cone) ──
(0, node_test_1.test)('lateral: dead-center aim within range is a hit', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 60); // 60m north, within DEFAULT_HIT_CONFIG.maxRangeM (75)
    const v = (0, hit_1.validateHitLateral)(attempt(MUC, 0, target), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(v.hit, true, JSON.stringify(v));
    strict_1.default.equal(v.reason, null);
});
(0, node_test_1.test)('lateral: small lateral offset within the 2m tolerance still hits at long range', () => {
    // 1.8° off at 60m ≈ 1.9m lateral offset — inside a 2m tolerance, still within maxRangeM.
    const target = (0, geo_1.destinationPoint)(MUC, 1.8, 60);
    const v = (0, hit_1.validateHitLateral)(attempt(MUC, 0, target), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(v.hit, true, `lateral offset should be within tolerance: ${JSON.stringify(v)}`);
});
(0, node_test_1.test)('lateral: offset beyond the tolerance is rejected regardless of confidence', () => {
    // 5.7° off at 60m ≈ 6m lateral offset — well beyond a 2m tolerance, still within maxRangeM.
    const target = (0, geo_1.destinationPoint)(MUC, 5.7, 60);
    const v = (0, hit_1.validateHitLateral)(attempt(MUC, 0, target), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(v.hit, false, JSON.stringify(v));
    strict_1.default.equal(v.reason, 'outside_lateral');
});
(0, node_test_1.test)('lateral: same angular offset accepted at short range, rejected at long range (unlike a cone, tolerance does not widen)', () => {
    // 5.7° at 10m ≈ 1m lateral offset — within a 2m tolerance.
    const near = (0, geo_1.destinationPoint)(MUC, 5.7, 10);
    const vNear = (0, hit_1.validateHitLateral)(attempt(MUC, 0, near), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(vNear.hit, true, `short-range small lateral offset should hit: ${JSON.stringify(vNear)}`);
    // Same 5.7° at 60m ≈ 6m lateral offset — beyond the same fixed 2m tolerance (both within maxRangeM).
    const far = (0, geo_1.destinationPoint)(MUC, 5.7, 60);
    const vFar = (0, hit_1.validateHitLateral)(attempt(MUC, 0, far), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(vFar.hit, false, `long-range same angle should miss under a fixed lateral tolerance: ${JSON.stringify(vFar)}`);
    strict_1.default.equal(vFar.reason, 'outside_lateral', `should miss due to lateral tolerance, not range: ${JSON.stringify(vFar)}`);
});
(0, node_test_1.test)('lateral: beyond max range is rejected regardless of lateral offset', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, types_1.DEFAULT_HIT_CONFIG.maxRangeM * 2 + 10);
    const v = (0, hit_1.validateHitLateral)(attempt(MUC, 0, target), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'out_of_range');
});
(0, node_test_1.test)('lateral: missing shooter heading is rejected (still needs an aim ray)', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 50);
    const v = (0, hit_1.validateHitLateral)(attempt(MUC, null, target), types_1.DEFAULT_HIT_CONFIG, 2);
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'no_heading');
});
// ── validateHitOmni (Bomber: any bearing within range, no aiming) ──────────
(0, node_test_1.test)('omni: target directly ahead within range is a hit', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 20);
    const v = (0, hit_1.validateHitOmni)(attempt(MUC, 0, target));
    strict_1.default.equal(v.hit, true);
});
(0, node_test_1.test)('omni: target directly BEHIND the shooter within range is still a hit (no aiming required)', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 180, 20);
    const v = (0, hit_1.validateHitOmni)(attempt(MUC, 0, target));
    strict_1.default.equal(v.hit, true, `omnidirectional hit should not care about bearing: ${JSON.stringify(v)}`);
});
(0, node_test_1.test)('omni: works with no shooter heading at all (unlike validateHit/validateHitLateral)', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 90, 20);
    const v = (0, hit_1.validateHitOmni)(attempt(MUC, null, target));
    strict_1.default.equal(v.hit, true, `omnidirectional hit should not require a heading: ${JSON.stringify(v)}`);
});
(0, node_test_1.test)('omni: beyond max range is rejected', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 45, types_1.DEFAULT_HIT_CONFIG.maxRangeM * 2);
    const v = (0, hit_1.validateHitOmni)(attempt(MUC, null, target));
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'out_of_range');
});
(0, node_test_1.test)('omni: excessive time skew between samples is rejected', () => {
    const target = (0, geo_1.destinationPoint)(MUC, 0, 10);
    const v = (0, hit_1.validateHitOmni)(attempt(MUC, null, target, {}, { ts: T0 + types_1.DEFAULT_HIT_CONFIG.maxTimeSkewMs * 2 }));
    strict_1.default.equal(v.hit, false);
    strict_1.default.equal(v.reason, 'time_skew');
});
