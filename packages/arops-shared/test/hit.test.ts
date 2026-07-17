import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateHit, hitToleranceDeg } from '../src/hit';
import { destinationPoint, bearingDeg } from '../src/geo';
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

// ── Happy path ──────────────────────────────────────────────

test('hit: dead-center aim at 50m is a confident hit', () => {
  const target = destinationPoint(MUC, 0, 50); // 50m north
  const v = validateHit(attempt(MUC, 0, target)); // aiming exactly north
  assert.equal(v.hit, true);
  assert.equal(v.reason, null);
  assert.ok(v.confidence > 0.7, `confidence ${v.confidence} should be > 0.7`);
  assert.ok(v.angleDeltaDeg! < 0.1);
});

test('hit: works for arbitrary bearings', () => {
  for (const brg of [37, 123, 258, 341]) {
    const target = destinationPoint(MUC, brg, 40);
    const v = validateHit(attempt(MUC, brg, target));
    assert.equal(v.hit, true, `bearing ${brg} should hit`);
  }
});

// ── Hard fails ──────────────────────────────────────────────

test('miss: no compass heading', () => {
  const target = destinationPoint(MUC, 0, 50);
  const v = validateHit(attempt(MUC, null, target));
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'no_heading');
  assert.equal(v.confidence, 0);
});

test('miss: stale target sample (time skew)', () => {
  const target = destinationPoint(MUC, 0, 50);
  const v = validateHit(
    attempt(MUC, 0, target, {}, { ts: T0 - 8000 }) // target sample 8s old (> 5s limit)
  );
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'time_skew');
});

test('miss: out of range', () => {
  const target = destinationPoint(MUC, 0, 200); // beyond 75m default
  const v = validateHit(attempt(MUC, 0, target));
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'out_of_range');
});

test('miss: aiming 90° away', () => {
  const target = destinationPoint(MUC, 0, 50); // target north
  const v = validateHit(attempt(MUC, 90, target)); // aiming east
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'outside_cone');
  assert.ok(Math.abs(v.angleDeltaDeg! - 90) < 0.1);
});

test('miss: slightly outside the cone at long range', () => {
  // At 70m with 5+5m accuracy: tolerance = 10 + atan(10/70) ≈ 18.1°
  const target = destinationPoint(MUC, 0, 70);
  const v = validateHit(attempt(MUC, 25, target)); // 25° off
  assert.equal(v.hit, false);
  assert.equal(v.reason, 'outside_cone');
});

// ── Tolerance behavior ──────────────────────────────────────

test('tolerance: widens as GPS accuracy degrades', () => {
  const tGood = hitToleranceDeg(50, 5);    // 5m combined error at 50m
  const tBad = hitToleranceDeg(50, 25);    // 25m combined error
  assert.ok(tBad > tGood, `bad GPS (${tBad}°) should give wider cone than good (${tGood}°)`);
});

test('tolerance: narrows with distance (same accuracy)', () => {
  const tNear = hitToleranceDeg(15, 10);
  const tFar = hitToleranceDeg(70, 10);
  assert.ok(tNear > tFar, `near (${tNear}°) should be wider than far (${tFar}°)`);
});

test('tolerance: capped at maxToleranceDeg', () => {
  const t = hitToleranceDeg(2, 50); // absurd: 50m error at 2m distance
  assert.equal(t, DEFAULT_HIT_CONFIG.maxToleranceDeg);
});

test('hit: bad GPS at close range still hits inside widened cone', () => {
  // 20m distance, poor accuracy on both sides (12m each → 24m combined)
  // tolerance = 10 + atan(24/20) ≈ 60.2° → capped at 40°
  const target = destinationPoint(MUC, 0, 20);
  const v = validateHit(
    attempt(MUC, 30, target, { accuracyM: 12 }, { accuracyM: 12 }) // 30° off
  );
  assert.equal(v.hit, true, `30° off should hit inside ${v.toleranceDeg}° cone`);
});

// ── Confidence ordering ─────────────────────────────────────

test('confidence: centered aim scores higher than edge-of-cone aim', () => {
  const target = destinationPoint(MUC, 0, 50);
  const centered = validateHit(attempt(MUC, 0, target));
  const offAxis = validateHit(attempt(MUC, 12, target)); // near cone edge
  assert.ok(
    centered.confidence > offAxis.confidence,
    `${centered.confidence} > ${offAxis.confidence}`
  );
});

test('confidence: fresh samples score higher than near-stale ones', () => {
  const target = destinationPoint(MUC, 0, 50);
  const fresh = validateHit(attempt(MUC, 0, target));
  const stale = validateHit(attempt(MUC, 0, target, {}, { ts: T0 - 2500 }));
  assert.ok(fresh.confidence > stale.confidence);
});

// ── Verdict diagnostics ─────────────────────────────────────

test('verdict: reports distance and bearing delta correctly', () => {
  const target = destinationPoint(MUC, 45, 60);
  const trueBearing = bearingDeg(MUC, target);
  const v = validateHit(attempt(MUC, trueBearing + 5, target));
  assert.ok(Math.abs(v.distanceM - 60) < 0.1);
  assert.ok(Math.abs(v.angleDeltaDeg! - 5) < 0.1);
});

test('verdict: deterministic (same input → same output)', () => {
  const target = destinationPoint(MUC, 10, 45);
  const a = validateHit(attempt(MUC, 12, target));
  const b = validateHit(attempt(MUC, 12, target));
  assert.deepEqual(a, b);
});

// ── pickTargetSample (interpolation) ────────────────────────
import { pickTargetSample } from '../src/hit';

test('pickTargetSample: interpolates between bracketing samples', () => {
  const a = sample(MUC, { ts: T0 });
  const b = sample(destinationPoint(MUC, 0, 10), { ts: T0 + 2000 }); // 10m north in 2s
  const mid = pickTargetSample([a, b], T0 + 1000)!;
  // Halfway → ~5m north of MUC
  const d = Math.abs(5 - (mid.lat - MUC.lat) / (b.lat - MUC.lat) * 10);
  assert.ok(d < 0.1, `interpolated ~5m, off by ${d}`);
  assert.equal(mid.ts, T0 + 1000);
});

test('pickTargetSample: falls back to nearest outside the bracket', () => {
  const a = sample(MUC, { ts: T0 });
  const b = sample(destinationPoint(MUC, 0, 10), { ts: T0 + 2000 });
  const late = pickTargetSample([a, b], T0 + 9000)!;
  assert.equal(late.ts, b.ts); // nearest = b, no extrapolation
});

test('pickTargetSample: empty buffer → null', () => {
  assert.equal(pickTargetSample([], T0), null);
});
