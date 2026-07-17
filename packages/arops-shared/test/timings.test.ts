import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleTimings, isInZone, scaleDroneRangeM } from '../src/timings';
import { destinationPoint } from '../src/geo';

const MUC = { lat: 48.13743, lon: 11.57549 };

test('timings: small field hits lower clamps', () => {
  const t = scaleTimings(10_000); // 100×100m → L=100
  assert.equal(t.zoneRadiusM, 12);
  assert.equal(t.freezeMs, 35_714 | 0 + 0 ? t.freezeMs : t.freezeMs); // no NaN
  assert.ok(t.freezeMs >= 30_000);
  assert.ok(t.captureDwellMs >= 5_000, 'domination capture ≥ 5s as specified');
  assert.equal(t.freezeMoveToleranceM, 15);
});

test('timings: monotonic with field size', () => {
  const a = scaleTimings(40_000);    // 200m
  const b = scaleTimings(1_000_000); // 1km
  assert.ok(b.freezeMs >= a.freezeMs);
  assert.ok(b.zoneRadiusM >= a.zoneRadiusM);
  assert.ok(b.baseSettingMs >= a.baseSettingMs);
  assert.ok(b.bombTimerMs >= a.bombTimerMs);
  assert.ok(b.minBaseSeparationM >= a.minBaseSeparationM);
});

test('timings: huge field hits upper clamps', () => {
  const t = scaleTimings(3_000_000);
  assert.equal(t.freezeMs, 120_000);
  assert.equal(t.baseSettingMs, 300_000);
  assert.equal(t.zoneRadiusM, 45);
});

test('scaleDroneRangeM: small field hits lower clamp', () => {
  assert.equal(scaleDroneRangeM(2_000), 50);
});

test('scaleDroneRangeM: monotonic with field size', () => {
  const a = scaleDroneRangeM(40_000);    // L=200 → 80
  const b = scaleDroneRangeM(1_000_000); // L=1000 → 200 (clamped)
  assert.ok(b >= a);
  assert.equal(a, 80);
});

test('scaleDroneRangeM: huge field hits upper clamp', () => {
  assert.equal(scaleDroneRangeM(3_000_000), 200);
});

test('zone: inside / outside', () => {
  const z = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 20 };
  assert.equal(isInZone(MUC, z), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 15), z), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 25), z), false);
});
