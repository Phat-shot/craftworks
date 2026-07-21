import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHitLateral, validateHitOmni } from '../src/hit';
import { destinationPoint } from '../src/geo';
import {
  LatLon, TelemetrySample, HitAttempt, DEFAULT_HIT_CONFIG,
} from '../src/types';

const MUC: LatLon = { lat: 48.13743, lon: 11.57549 };
const T0 = 1_700_000_000_000;

function sample(pos: LatLon, over: Partial<TelemetrySample> = {}): TelemetrySample {
  return {
    lat: pos.lat, lon: pos.lon,
    ts: T0, accuracyM: 5, headingDeg: null,
    ...over,
  };
}

function attempt(
  shooterPos: LatLon, heading: number | null,
  targetPos: LatLon,
  shooterOver: Partial<TelemetrySample> = {},
  targetOver: Partial<TelemetrySample> = {}
): HitAttempt {
  return {
    shooterId: 'A', targetId: 'B',
    shooter: sample(shooterPos, { headingDeg: heading, ...shooterOver }),
    target: sample(targetPos, targetOver),
  };
}

// ── validateHitLateral (Sniper: fixed lateral tolerance, not a widening cone) ──

test('lateral: dead-center aim within range is a hit', () => {
  const target = destinationPoint(MUC, 0, 60); // 60m north, within DEFAULT_HIT_CONFIG.maxRangeM (75)
  const v = validateHitLateral(attempt(MUC, 0, target), DEFAULT_HIT_CONFIG, 2);
  assert.equal(v.hit, true, JSON.stringify(v));
  assert.equal(v.reason, null);
});

test('lateral: small lateral offset within the 2m tolerance still hits at long range', () => {
  // 1.8° off at 60m ≈ 1.9m lateral offset — inside a 2m tolerance, still within maxRangeM.
  const target = destinationPoint(MUC, 1.8, 60);
  const v = validateHitLateral(attempt(MUC, 0, target), DEFAULT_HIT_CONFIG, 2);
  assert.equal(v.hit, true, `lateral offset should be within tolerance: ${JSON.stringify(v)}`);
});

test('lateral: offset beyond the tolerance is rejected regardless of confidence', () => {
  // 5.7° off at 60m ≈ 6m lateral offset — well beyond a 2m tolerance, still within maxRangeM.
  const target = destinationPoint(MUC, 5.7, 60);
  const v = validateHitLateral(attempt(MUC, 0, target), DEFAULT_HIT_CONFIG, 2);
  assert.equal(v.hit, false, JSON.stringify(v));
  assert.equal(v.reason, 'outside_lateral');
});

test('lateral: same angular offset accepted at short range, rejected at long range (unlike a cone, tolerance does not widen)', () => {
  // 5.7° at 10m ≈ 1m lateral offset — within a 2m tolerance.
  const near = destinationPoint(MUC, 5.7, 10);
  const vNear = validateHitLateral(attempt(MUC, 0, near), DEFAULT_HIT_CONFIG, 2);
  assert.equal(vNear.hit, true, `short-range small lateral offset should hit: ${JSON.stringify(vNear)}`);

  // Same 5.7° at 60m ≈ 6m lateral offset — beyond the same fixed 2m tolerance (both within maxRangeM).
  const far = destinationPoint(MUC, 5.7, 60);
  const vFar = validateHitLateral(attempt(MUC, 0, far), DEFAULT_HIT_CONFIG, 2);
  assert.equal(vFar.hit, false, `long-range same angle should miss under a fixed lateral tolerance: ${JSON.stringify(vFar)}`);
  assert.equal(vFar.reason, 'outside_lateral', `should miss due to lateral tolerance, not range: ${JSON.stringify(vFar)}`);
});

test('lateral: beyond max range is rejected regardless of lateral offset', () => {
  const target = destinationPoint(MUC, 0, DEFAULT_HIT_CONFIG.maxRangeM * 2 + 10);
  const v = validateHitLateral(attempt(MUC, 0, target), DEFAULT_HIT_CONFIG, 2);
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'out_of_range');
});

test('lateral: missing shooter heading is rejected (still needs an aim ray)', () => {
  const target = destinationPoint(MUC, 0, 50);
  const v = validateHitLateral(attempt(MUC, null, target), DEFAULT_HIT_CONFIG, 2);
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'no_heading');
});

// ── validateHitOmni (Bomber: any bearing within range, no aiming) ──────────

test('omni: target directly ahead within range is a hit', () => {
  const target = destinationPoint(MUC, 0, 20);
  const v = validateHitOmni(attempt(MUC, 0, target));
  assert.equal(v.hit, true);
});

test('omni: target directly BEHIND the shooter within range is still a hit (no aiming required)', () => {
  const target = destinationPoint(MUC, 180, 20);
  const v = validateHitOmni(attempt(MUC, 0, target));
  assert.equal(v.hit, true, `omnidirectional hit should not care about bearing: ${JSON.stringify(v)}`);
});

test('omni: works with no shooter heading at all (unlike validateHit/validateHitLateral)', () => {
  const target = destinationPoint(MUC, 90, 20);
  const v = validateHitOmni(attempt(MUC, null, target));
  assert.equal(v.hit, true, `omnidirectional hit should not require a heading: ${JSON.stringify(v)}`);
});

test('omni: beyond max range is rejected', () => {
  const target = destinationPoint(MUC, 45, DEFAULT_HIT_CONFIG.maxRangeM * 2);
  const v = validateHitOmni(attempt(MUC, null, target));
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'out_of_range');
});

test('omni: excessive time skew between samples is rejected', () => {
  const target = destinationPoint(MUC, 0, 10);
  const v = validateHitOmni(attempt(MUC, null, target, {}, { ts: T0 + DEFAULT_HIT_CONFIG.maxTimeSkewMs * 2 }));
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'time_skew');
});
