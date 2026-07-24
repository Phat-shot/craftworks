'use strict';
// ═══════════════════════════════════════════════════════════
//  Comic-map generation — pure, synchronous, deterministic (no
//  network, no DB). See src/game/comic_map.js's header for why.
//  Run: node server/test/comic_map.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const { generateComicMapFeatures, polygonSeed } = require('../src/game/comic_map');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

/** Axis-aligned square polygon, `halfSizeDeg` degrees from center to edge. */
function square(lat, lon, halfSizeDeg) {
  return [
    { lat: lat - halfSizeDeg, lon: lon - halfSizeDeg },
    { lat: lat - halfSizeDeg, lon: lon + halfSizeDeg },
    { lat: lat + halfSizeDeg, lon: lon + halfSizeDeg },
    { lat: lat + halfSizeDeg, lon: lon - halfSizeDeg },
  ];
}

const TYPES = new Set(['building', 'road', 'path', 'forest', 'water', 'grass']);

console.log('\n═══ determinism ═══');
check('same polygon -> byte-identical output', () => {
  const poly = square(48.2, 16.3, 0.00025); // ~55m across
  const a = generateComicMapFeatures(poly);
  const b = generateComicMapFeatures(poly.map(p => ({ ...p }))); // fresh array/objects, same values
  assert.deepEqual(a, b);
});
check('a nudged polygon produces different output (not a hardcoded/constant seed)', () => {
  const poly = square(48.2, 16.3, 0.00025);
  const nudged = poly.map(p => ({ ...p }));
  nudged[0] = { lat: nudged[0].lat + 0.00002, lon: nudged[0].lon };
  const a = generateComicMapFeatures(poly);
  const b = generateComicMapFeatures(nudged);
  assert.notDeepEqual(a, b);
});
check('opts.seed overrides the default and is itself deterministic', () => {
  const poly = square(48.2, 16.3, 0.00025);
  const a = generateComicMapFeatures(poly, { seed: 42 });
  const b = generateComicMapFeatures(poly, { seed: 42 });
  const c = generateComicMapFeatures(poly, { seed: 43 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});
check('polygonSeed is a stable finite non-negative integer', () => {
  const poly = square(48.2, 16.3, 0.00025);
  const s = polygonSeed(poly);
  assert.ok(Number.isInteger(s) && s >= 0);
  assert.equal(polygonSeed(poly.map(p => ({ ...p }))), s);
});

console.log('\n═══ purity / no network / no DB ═══');
check('returns a plain array synchronously (no Promise, no async work)', () => {
  const poly = square(48.2, 16.3, 0.00025);
  const result = generateComicMapFeatures(poly);
  assert.ok(Array.isArray(result));
  assert.equal(typeof result.then, 'undefined');
});
check('fewer than 3 points -> empty array, no throw', () => {
  assert.deepEqual(generateComicMapFeatures([]), []);
  assert.deepEqual(generateComicMapFeatures([{ lat: 1, lon: 1 }]), []);
});

console.log('\n═══ output shape / plausibility ═══');
check('every feature has a valid type, >=2 finite points, within a bounded distance of the field', () => {
  const poly = square(48.2, 16.3, 0.001); // ~220m across
  const features = generateComicMapFeatures(poly);
  assert.ok(features.length > 0);
  for (const f of features) {
    assert.ok(TYPES.has(f.type), `unexpected type ${f.type}`);
    assert.ok(Array.isArray(f.points) && f.points.length >= 2);
    for (const p of f.points) {
      assert.ok(Number.isFinite(p.lat) && Number.isFinite(p.lon));
      // bounded: no point should land wildly outside the field (a few field
      // diagonals is generous — catches gross projection bugs, not tuning).
      assert.ok(Math.abs(p.lat - 48.2) < 0.02 && Math.abs(p.lon - 16.3) < 0.02);
    }
  }
});

console.log('\n═══ feature count scales with area, without exploding ═══');
check('a small field yields few features, a large field yields many more, bounded', () => {
  const small = generateComicMapFeatures(square(48.2, 16.3, 0.00025)); // ~55m
  const large = generateComicMapFeatures(square(48.2, 16.3, 0.01));    // ~2.2km
  assert.ok(small.length > 0);
  assert.ok(large.length > small.length);
  assert.ok(large.length < 5000, `expected bounded feature count, got ${large.length}`);
});
check('an even larger field does not keep growing without bound (block count plateaus)', () => {
  const large = generateComicMapFeatures(square(48.2, 16.3, 0.01));   // ~2.2km
  const huge = generateComicMapFeatures(square(48.2, 16.3, 0.03));    // ~6.6km
  assert.ok(huge.length < large.length * 4, 'feature count should plateau, not scale linearly forever');
});

console.log('\n═══ small-field non-emptiness ═══');
check('a minimum-legal (~just over 400 m²) field still yields at least one building', () => {
  const tiny = generateComicMapFeatures(square(48.2, 16.3, 0.00009)); // ~20m across
  assert.ok(tiny.length >= 1);
  assert.ok(tiny.some(f => f.type === 'building'), 'expected the guaranteed-non-empty building fallback');
});
check('a pathological thin/elongated field is still non-empty', () => {
  const thin = [
    { lat: 48.2, lon: 16.3 },
    { lat: 48.2, lon: 16.3006 },
    { lat: 48.20005, lon: 16.3006 },
    { lat: 48.20005, lon: 16.3 },
  ];
  assert.ok(generateComicMapFeatures(thin).length >= 1);
});

console.log('\n═══ feature-type vocabulary for a normal field ═══');
check('a mid-sized field includes buildings, some vegetation/water, and roads/paths', () => {
  const features = generateComicMapFeatures(square(48.2, 16.3, 0.002)); // ~440m
  const types = new Set(features.map(f => f.type));
  assert.ok(types.has('building'));
  assert.ok(types.has('forest') || types.has('water') || types.has('grass'));
  assert.ok(types.has('road') || types.has('path'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
