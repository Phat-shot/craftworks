import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isInZone, distanceToZoneM, validateZones, scaleTimings,
} from '../src/timings';
import { destinationPoint, polygonAreaM2 } from '../src/geo';
import { LatLon } from '../src/types';

const MUC: LatLon = { lat: 48.13743, lon: 11.57549 };
const zone = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 15 };

test('isInZone: inside / rim / outside', () => {
  assert.equal(isInZone(MUC, zone), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 14), zone), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 16), zone), false);
});

test('distanceToZone: signed', () => {
  const inside = distanceToZoneM(destinationPoint(MUC, 90, 5), zone);
  const outside = distanceToZoneM(destinationPoint(MUC, 90, 25), zone);
  assert.ok(inside < 0 && Math.abs(inside + 10) < 0.5);
  assert.ok(outside > 0 && Math.abs(outside - 10) < 0.5);
});

test('scaleTimings: bigger field → longer timings, within clamps', () => {
  // freezeMs' 3-30s range is narrow enough that a 200m and a 1km field both
  // saturate the upper clamp (not useful for demonstrating monotonicity) —
  // a small field well under the ceiling is needed for `tiny` instead.
  const tiny = scaleTimings(400);        // 20x20m, L=20 — stays unclamped
  const small = scaleTimings(40_000);    // 200x200m park, L=200
  const big = scaleTimings(1_000_000);   // 1km², L=1000
  assert.ok(small.freezeMs > tiny.freezeMs);
  assert.ok(big.captureDwellMs >= small.captureDwellMs);
  assert.ok(tiny.freezeMs >= 3_000, 'freeze floor');
  assert.ok(big.freezeMs <= 30_000, 'freeze cap');
  assert.ok(small.captureDwellMs >= 5_000, 'user-specified 5s minimum dwell');
  assert.equal(small.freezeMoveToleranceM, 15, 'move tolerance fixed (GPS drift)');
});

test('scaleTimings: matches real polygon area', () => {
  const field = [0, 90, 180, 270].map(b => destinationPoint(MUC, b, 200));
  const t = scaleTimings(polygonAreaM2(field));
  assert.ok(t.zoneRadiusM >= 12 && t.zoneRadiusM <= 45);
  assert.ok(t.minBaseSeparationM >= 60);
});

test('validateZones: valid trio passes', () => {
  const field = [0, 90, 180, 270].map(b => destinationPoint(MUC, b, 200));
  const zones = [
    { id: 'a', ...destinationPoint(MUC, 0, 100), radiusM: 15 },
    { id: 'b', ...destinationPoint(MUC, 120, 100), radiusM: 15 },
    { id: 'c', ...destinationPoint(MUC, 240, 100), radiusM: 15 },
  ];
  assert.deepEqual(validateZones(zones, field), { ok: true, errors: [] });
});

test('validateZones: outside field rejected', () => {
  const field = [0, 90, 180, 270].map(b => destinationPoint(MUC, b, 200));
  const r = validateZones([{ id: 'a', ...destinationPoint(MUC, 0, 400), radiusM: 15 }], field);
  assert.ok(r.errors.includes('outside_field'));
});

test('validateZones: overlapping zones rejected', () => {
  const field = [0, 90, 180, 270].map(b => destinationPoint(MUC, b, 200));
  const zones = [
    { id: 'a', ...MUC, radiusM: 15 },
    { id: 'b', ...destinationPoint(MUC, 0, 30), radiusM: 15 },
  ];
  const r = validateZones(zones, field);
  assert.ok(r.errors.includes('zones_too_close'));
});
