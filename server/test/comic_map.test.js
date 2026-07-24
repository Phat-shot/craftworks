'use strict';
// ═══════════════════════════════════════════════════════════
//  Comic-map generation — real-OSM-data-first with a pure/synchronous/
//  deterministic procedural fallback. See src/game/comic_map.js's header
//  for the design. No live network call in these tests — the Overpass-
//  path tests mock `fetch` (getComicMapFeatures's own fallback logic is
//  exactly what's under test there, not the real self-hosted instance).
//  Run: node server/test/comic_map.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const {
  generateComicMapFeatures, polygonSeed,
  comicFeatureType, reduceOverpassElements, polygonBbox, getComicMapFeatures,
} = require('../src/game/comic_map');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
/** Temporarily replaces global.fetch for the duration of `fn`, always
 *  restoring it afterward (even on failure) — no real network call ever
 *  happens in these tests. */
async function withMockedFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  try { await fn(); } finally { global.fetch = original; }
}
const fakeRes = (elements, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => ({ elements }),
});
const way = (tags, geometry) => ({ type: 'way', id: Math.random(), tags, geometry });

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

console.log('\n═══ comicFeatureType ═══');
check('building tag → building', () => {
  assert.equal(comicFeatureType({ building: 'yes' }), 'building');
});
check('highway=footway → path', () => {
  assert.equal(comicFeatureType({ highway: 'footway' }), 'path');
});
check('highway=primary → road', () => {
  assert.equal(comicFeatureType({ highway: 'primary' }), 'road');
});
check('natural=wood → forest', () => {
  assert.equal(comicFeatureType({ natural: 'wood' }), 'forest');
});
check('landuse=forest → forest', () => {
  assert.equal(comicFeatureType({ landuse: 'forest' }), 'forest');
});
check('natural=water → water', () => {
  assert.equal(comicFeatureType({ natural: 'water' }), 'water');
});
check('landuse=grass → grass', () => {
  assert.equal(comicFeatureType({ landuse: 'grass' }), 'grass');
});
check('leisure=park → grass', () => {
  assert.equal(comicFeatureType({ leisure: 'park' }), 'grass');
});
check('unrelated tags → null (excluded)', () => {
  assert.equal(comicFeatureType({ amenity: 'cafe' }), null);
});
check('no tags → null', () => {
  assert.equal(comicFeatureType(undefined), null);
});

console.log('\n═══ reduceOverpassElements ═══');
check('reduces a building way to {type, points}', () => {
  const els = [way({ building: 'yes' }, [{ lat: 48.1362395, lon: 11.5769961 }, { lat: 48.1363, lon: 11.5771 }])];
  const out = reduceOverpassElements(els);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'building');
  assert.equal(out[0].points.length, 2);
});
check('coordinates rounded to 6 decimals', () => {
  const els = [way({ building: 'yes' }, [{ lat: 48.123456789, lon: 11.987654321 }, { lat: 48.1, lon: 11.9 }])];
  const out = reduceOverpassElements(els);
  assert.equal(out[0].points[0].lat, 48.123457);
  assert.equal(out[0].points[0].lon, 11.987654);
});
check('elements without a recognized tag are excluded', () => {
  const els = [way({ amenity: 'cafe' }, [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])];
  assert.equal(reduceOverpassElements(els).length, 0);
});
check('elements with fewer than 2 valid points are excluded', () => {
  const els = [
    way({ building: 'yes' }, [{ lat: 1, lon: 1 }]),
    way({ building: 'yes' }, []),
    way({ building: 'yes' }, null),
  ];
  assert.equal(reduceOverpassElements(els).length, 0);
});
check('invalid lat/lon entries inside geometry are filtered out, not the whole way', () => {
  const els = [way({ building: 'yes' }, [{ lat: 1, lon: 1 }, { lat: NaN, lon: 2 }, { lat: 3, lon: 3 }])];
  const out = reduceOverpassElements(els);
  assert.equal(out.length, 1);
  assert.equal(out[0].points.length, 2);
});
check('caps output at COMIC_MAP_MAX_FEATURES', () => {
  const els = Array.from({ length: 1300 }, () => way({ building: 'yes' }, [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]));
  assert.equal(reduceOverpassElements(els).length, 1200);
});
check('empty/undefined elements → empty array, no throw', () => {
  assert.deepEqual(reduceOverpassElements([]), []);
  assert.deepEqual(reduceOverpassElements(undefined), []);
});

console.log('\n═══ polygonBbox ═══');
check('computes min/max with padding', () => {
  const poly = [{ lat: 48.10, lon: 11.50 }, { lat: 48.14, lon: 11.58 }, { lat: 48.12, lon: 11.55 }];
  const bbox = polygonBbox(poly, 0.001);
  assert.ok(Math.abs(bbox.south - (48.10 - 0.001)) < 1e-9);
  assert.ok(Math.abs(bbox.north - (48.14 + 0.001)) < 1e-9);
  assert.ok(Math.abs(bbox.west - (11.50 - 0.001)) < 1e-9);
  assert.ok(Math.abs(bbox.east - (11.58 + 0.001)) < 1e-9);
});

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

(async () => {
  console.log('\n═══ getComicMapFeatures (real-data-first, procedural fallback — mocked fetch) ═══');
  await checkAsync('real Overpass data is used as-is when the fetch succeeds', async () => {
    const poly = square(48.2, 16.3, 0.001);
    const realElements = [way({ building: 'yes' }, [{ lat: 48.2001, lon: 16.3001 }, { lat: 48.2002, lon: 16.3002 }])];
    await withMockedFetch(async () => fakeRes(realElements), async () => {
      const features = await getComicMapFeatures(poly);
      assert.equal(features.length, 1);
      assert.equal(features[0].type, 'building');
    });
  });
  await checkAsync('falls back to the procedural generator when fetch throws', async () => {
    const poly = square(48.2, 16.3, 0.001);
    await withMockedFetch(async () => { throw new Error('network_down'); }, async () => {
      const features = await getComicMapFeatures(poly);
      assert.deepEqual(features, generateComicMapFeatures(poly));
    });
  });
  await checkAsync('falls back to the procedural generator on a non-2xx response', async () => {
    const poly = square(48.2, 16.3, 0.001);
    await withMockedFetch(async () => fakeRes([], 503), async () => {
      const features = await getComicMapFeatures(poly);
      assert.deepEqual(features, generateComicMapFeatures(poly));
    });
  });
  await checkAsync('falls back to the procedural generator when Overpass returns no elements (unmapped area)', async () => {
    const poly = square(48.2, 16.3, 0.001);
    await withMockedFetch(async () => fakeRes([]), async () => {
      const features = await getComicMapFeatures(poly);
      assert.deepEqual(features, generateComicMapFeatures(poly));
    });
  });
  await checkAsync('never throws even if fetch is completely broken', async () => {
    const poly = square(48.2, 16.3, 0.001);
    await withMockedFetch(() => { throw new TypeError('fetch is not defined'); }, async () => {
      await getComicMapFeatures(poly); // must not reject
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
