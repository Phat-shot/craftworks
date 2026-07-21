'use strict';
// ═══════════════════════════════════════════════════════════
//  Comic-map feature reduction — pure functions only, no live
//  network call (Overpass itself is a shared public API and
//  must not be hit in an automated test loop).
//  Run: node server/test/comic_map.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const {
  reduceOverpassElements, polygonBbox, comicFeatureType,
  bboxContains, filterFeaturesToBbox, expandedCacheBbox, getCachedOrFetchComicMapFeatures,
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

const way = (tags, geometry) => ({ type: 'way', id: Math.random(), tags, geometry });

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
check('caps output at 500 features', () => {
  const els = Array.from({ length: 600 }, () => way({ building: 'yes' }, [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }]));
  assert.equal(reduceOverpassElements(els).length, 500);
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

console.log('\n═══ bboxContains ═══');
check('a fully covers a smaller b', () => {
  const a = { south: 0, west: 0, north: 10, east: 10 };
  const b = { south: 2, west: 2, north: 8, east: 8 };
  assert.equal(bboxContains(a, b), true);
});
check('b sticks out past a on one side → false', () => {
  const a = { south: 0, west: 0, north: 10, east: 10 };
  const b = { south: -1, west: 2, north: 8, east: 8 };
  assert.equal(bboxContains(a, b), false);
});
check('identical bboxes → true (inclusive bounds)', () => {
  const a = { south: 0, west: 0, north: 10, east: 10 };
  assert.equal(bboxContains(a, a), true);
});

console.log('\n═══ filterFeaturesToBbox ═══');
check('keeps a feature with at least one point inside the bbox', () => {
  const bbox = { south: 0, west: 0, north: 10, east: 10 };
  const features = [
    { type: 'building', points: [{ lat: 5, lon: 5 }] },     // inside
    { type: 'building', points: [{ lat: 50, lon: 50 }] },   // outside
    { type: 'road', points: [{ lat: 50, lon: 50 }, { lat: 5, lon: 5 }] }, // one point inside
  ];
  const out = filterFeaturesToBbox(features, bbox);
  assert.equal(out.length, 2);
});
check('empty input → empty output', () => {
  assert.deepEqual(filterFeaturesToBbox([], { south: 0, west: 0, north: 1, east: 1 }), []);
});

console.log('\n═══ expandedCacheBbox ═══');
check('expanded bbox fully contains the tight polygon bbox', () => {
  const poly = [{ lat: 48.10, lon: 11.50 }, { lat: 48.11, lon: 11.51 }, { lat: 48.105, lon: 11.505 }];
  const tight = polygonBbox(poly);
  const expanded = expandedCacheBbox(poly);
  assert.ok(bboxContains(expanded, tight), 'expanded must fully cover the tight bbox');
  assert.ok(expanded.south < tight.south && expanded.north > tight.north, 'expanded must be strictly larger');
});
check('expansion is capped regardless of how large the field is', () => {
  // A field spanning ~0.05° (~5.5km) — expansion (2x) would be ~0.1° without
  // the cap; the hard cap (0.01°) must win instead.
  const poly = [{ lat: 48.00, lon: 11.00 }, { lat: 48.05, lon: 11.05 }, { lat: 48.00, lon: 11.05 }];
  const tight = polygonBbox(poly);
  const expanded = expandedCacheBbox(poly);
  const pad = expanded.north - tight.north;
  assert.ok(pad <= 0.01 + 1e-9, `expected padding capped at ~0.01°, got ${pad}`);
});

(async () => {
  console.log('\n═══ getCachedOrFetchComicMapFeatures (cache-hit path only — no live network in tests) ═══');
  await checkAsync('a covering cached region is used, filtered down to the requested bbox, no insert', async () => {
    const poly = [{ lat: 48.10, lon: 11.50 }, { lat: 48.11, lon: 11.51 }, { lat: 48.105, lon: 11.505 }];
    let inserted = false;
    const fakeDb = {
      query: async (sql) => {
        if (sql.startsWith('SELECT')) {
          return { rows: [{ features: [
            { type: 'building', points: [{ lat: 48.105, lon: 11.505 }] }, // inside the field
            { type: 'building', points: [{ lat: 49.0, lon: 12.0 }] },    // far outside — must be filtered out
          ] }] };
        }
        inserted = true;
        return { rows: [] };
      },
    };
    const features = await getCachedOrFetchComicMapFeatures(fakeDb, poly);
    assert.equal(features.length, 1);
    assert.equal(inserted, false, 'a cache hit must not write a new cache row');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
