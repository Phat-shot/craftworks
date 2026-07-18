import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePolygon, geofenceStatus, speedBetweenMps, isMovementPlausible,
} from '../src/geofence';
import { destinationPoint } from '../src/geo';
import { LatLon, TelemetrySample } from '../src/types';

const MUC: LatLon = { lat: 48.13743, lon: 11.57549 };
const T0 = 1_700_000_000_000;

function squareAround(center: LatLon, halfSideM: number): LatLon[] {
  const n = destinationPoint(center, 0, halfSideM);
  const s = destinationPoint(center, 180, halfSideM);
  return [
    destinationPoint(n, 90, halfSideM),
    destinationPoint(s, 90, halfSideM),
    destinationPoint(s, 270, halfSideM),
    destinationPoint(n, 270, halfSideM),
  ];
}

function sample(pos: LatLon, ts: number): TelemetrySample {
  return { lat: pos.lat, lon: pos.lon, ts, accuracyM: 5, headingDeg: null };
}

// ── validatePolygon ─────────────────────────────────────────

test('polygon: valid 200×200m square passes', () => {
  const sq = squareAround(MUC, 100); // 40,000 m²
  const r = validatePolygon(sq);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.ok(Math.abs(r.areaM2 - 40_000) < 150);
});

test('polygon: two points rejected', () => {
  const r = validatePolygon([MUC, destinationPoint(MUC, 0, 100)]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['too_few_points']);
});

test('polygon: tiny 10×10m square rejected as too small', () => {
  const r = validatePolygon(squareAround(MUC, 5)); // 100 m²
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('area_too_small'));
});

test('polygon: no upper area limit — a huge field is accepted', () => {
  const r = validatePolygon(squareAround(MUC, 1500)); // 9 km²
  assert.equal(r.ok, true);
  assert.ok(!r.errors.includes('area_too_large'));
});

test('polygon: bowtie rejected as self-intersecting', () => {
  const sq = squareAround(MUC, 100);
  const bowtie = [sq[0]!, sq[1]!, sq[3]!, sq[2]!];
  const r = validatePolygon(bowtie);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('self_intersecting'));
});

test('polygon: reports multiple errors at once', () => {
  // Tiny bowtie: both self-intersecting AND too small
  const sq = squareAround(MUC, 5);
  const bowtie = [sq[0]!, sq[1]!, sq[3]!, sq[2]!];
  const r = validatePolygon(bowtie);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('self_intersecting'));
  assert.ok(r.errors.includes('area_too_small'));
});

// ── geofenceStatus ──────────────────────────────────────────

test('geofence: center of field is inside with correct edge distance', () => {
  const sq = squareAround(MUC, 100);
  const s = geofenceStatus(MUC, sq, 10);
  assert.equal(s.state, 'inside');
  assert.ok(Math.abs(s.signedDistanceM - 100) < 1);
});

test('geofence: near edge triggers warning', () => {
  const sq = squareAround(MUC, 100);
  const nearEdge = destinationPoint(MUC, 0, 95); // 5m from north edge
  const s = geofenceStatus(nearEdge, sq, 10);
  assert.equal(s.state, 'warning');
  assert.ok(s.signedDistanceM > 0 && s.signedDistanceM <= 10);
});

test('geofence: outside gives negative distance', () => {
  const sq = squareAround(MUC, 100);
  const out = destinationPoint(MUC, 0, 130); // 30m past edge
  const s = geofenceStatus(out, sq, 10);
  assert.equal(s.state, 'outside');
  assert.ok(Math.abs(s.signedDistanceM + 30) < 1, `signed ${s.signedDistanceM} ≈ -30`);
});

// ── movement plausibility ───────────────────────────────────

test('plausibility: walking speed accepted', () => {
  // 15m in 10s = 1.5 m/s
  const a = sample(MUC, T0);
  const b = sample(destinationPoint(MUC, 0, 15), T0 + 10_000);
  assert.equal(isMovementPlausible(a, b), true);
});

test('plausibility: sprint accepted', () => {
  // 80m in 10s = 8 m/s
  const a = sample(MUC, T0);
  const b = sample(destinationPoint(MUC, 0, 80), T0 + 10_000);
  assert.equal(isMovementPlausible(a, b), true);
});

test('plausibility: teleport rejected', () => {
  // 500m in 10s = 50 m/s
  const a = sample(MUC, T0);
  const b = sample(destinationPoint(MUC, 0, 500), T0 + 10_000);
  assert.equal(isMovementPlausible(a, b), false);
});

test('plausibility: GPS jitter in short gaps tolerated', () => {
  // 20m jump within 1s — implied 20 m/s, but gap < minGapMs so accepted
  const a = sample(MUC, T0);
  const b = sample(destinationPoint(MUC, 0, 20), T0 + 1000);
  assert.equal(isMovementPlausible(a, b), true);
});

test('speedBetween: correct value', () => {
  const a = sample(MUC, T0);
  const b = sample(destinationPoint(MUC, 90, 100), T0 + 20_000);
  const v = speedBetweenMps(a, b);
  assert.ok(Math.abs(v - 5) < 0.01, `100m/20s should be 5 m/s, got ${v}`);
});

// ── sortPolygonPoints ───────────────────────────────────────
import { sortPolygonPoints, validatePolygon as vp2 } from '../src/geofence';

test('sortPolygonPoints repairs tap-order self-intersection', () => {
  const a = MUC;
  const b = destinationPoint(MUC, 90, 200);
  const c = destinationPoint(b, 0, 150);
  const d = destinationPoint(MUC, 0, 150);
  // Zigzag tap order a,c,b,d → self-intersecting bowtie
  const bowtie = [a, c, b, d];
  assert.ok(!vp2(bowtie).ok, 'bowtie must be invalid');
  const fixed = sortPolygonPoints(bowtie);
  const check = vp2(fixed);
  assert.ok(!check.errors.includes('self_intersecting'), 'sorted must not self-intersect');
  assert.ok(check.ok, JSON.stringify(check));
});
