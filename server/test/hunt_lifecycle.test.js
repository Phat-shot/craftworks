'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD lifecycle test — the minimal hunt.js state machine
//  (arrival, puzzle/target task completion, task/leg timeouts, strict-
//  route deviation, all 3 late-join modes).
//  Run: node server/test/hunt_lifecycle.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const hunt = require('../src/game/hunt');
const shared = require('@craftworks/arops-shared');

const MUC = { lat: 48.13743, lon: 11.57549 };
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
function sleepMs(ms) { // real (not faked) short wait — hunt.js uses Date.now() directly, same as arops.js
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait */ }
}

// 3 POIs in a row, ~50m apart — puzzle, target, base.
const P0 = { ...MUC };
const P1 = shared.destinationPoint(MUC, 90, 50);
const P2 = shared.destinationPoint(MUC, 90, 100);
function makePois(over = []) {
  const base = [
    { id: 'poi_0', order_index: 0, lat: P0.lat, lon: P0.lon, radius_m: 15, poi_type: 'puzzle',
      puzzle_config: { answer: 'Turm' }, task_time_limit_ms: null, timeout_action: {} },
    { id: 'poi_1', order_index: 1, lat: P1.lat, lon: P1.lon, radius_m: 15, poi_type: 'target',
      puzzle_config: {}, task_time_limit_ms: null, timeout_action: {} },
    { id: 'poi_2', order_index: 2, lat: P2.lat, lon: P2.lon, radius_m: 15, poi_type: 'base',
      puzzle_config: {}, task_time_limit_ms: null, timeout_action: {} },
  ];
  over.forEach((o, i) => Object.assign(base[i], o));
  return base;
}
function makeRun(routesOver = [], poisOver = [], progressMode = 'individual', players = [{ userId: 'A1' }]) {
  const pois = makePois(poisOver);
  const routes = [
    { from_poi_id: 'poi_0', to_poi_id: 'poi_1', route_type: 'freeform', enforcement: 'guidance',
      travel_time_limit_ms: null, timeout_action: {}, path_geojson: null },
    { from_poi_id: 'poi_1', to_poi_id: 'poi_2', route_type: 'freeform', enforcement: 'guidance',
      travel_time_limit_ms: null, timeout_action: {}, path_geojson: null },
  ];
  routesOver.forEach((o, i) => Object.assign(routes[i], o));
  return hunt.createHuntRun({
    runId: 'run_1', scenario: { id: 'scn_1', config: {} }, pois, routes, players, progressMode,
  });
}

console.log('\n═══ ARRIVAL + TASK COMPLETION ═══');
{
  check('a "base" POI completes on arrival alone', () => {
    const run = makeRun();
    hunt.checkArrival(run, 'A1', P0);
    // still on the puzzle POI — arrival alone doesn't complete a puzzle
    assert.equal(run.progress.A1.currentPoiIndex, 0);
    hunt.submitPuzzleAnswer(run, 'A1', 'turm'); // case-insensitive match
    assert.equal(run.progress.A1.currentPoiIndex, 1, 'advanced past the puzzle');
    hunt.checkArrival(run, 'A1', P1);
    assert.equal(run.progress.A1.currentPoiIndex, 1, 'target needs an explicit confirm, not just arrival');
    hunt.confirmTargetDestroyed(run, 'A1');
    assert.equal(run.progress.A1.currentPoiIndex, 2, 'advanced past the target');
    hunt.checkArrival(run, 'A1', P2); // base — completes immediately
    assert.ok(run.progress.A1.completedAt, 'base POI completed on arrival alone');
  });

  check('wrong puzzle answer does not advance', () => {
    const run = makeRun();
    hunt.checkArrival(run, 'A1', P0);
    const r = hunt.submitPuzzleAnswer(run, 'A1', 'falsch');
    assert.equal(r.correct, false);
    assert.equal(run.progress.A1.currentPoiIndex, 0);
  });

  check('finishing the last POI ends the whole run once every track is done', () => {
    const run = makeRun();
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm');
    hunt.checkArrival(run, 'A1', P1);
    hunt.confirmTargetDestroyed(run, 'A1');
    hunt.checkArrival(run, 'A1', P2);
    assert.ok(run.endedAt, 'sole track finished -> run ends');
    assert.ok(run.events.some(e => e.type === 'run_ended'));
  });
}

console.log('\n═══ TIMEOUTS ═══');
{
  check('task timeout with action "skip" advances past the POI automatically', () => {
    const run = makeRun([], [{ task_time_limit_ms: 30, timeout_action: { type: 'skip' } }]);
    hunt.checkArrival(run, 'A1', P0);
    sleepMs(60);
    hunt.tickHunt(run);
    assert.equal(run.progress.A1.currentPoiIndex, 1, 'skipped past the unsolved puzzle');
    assert.ok(run.events.some(e => e.type === 'timeout' && e.kind === 'task'));
  });

  check('task timeout with action "fail" ends that track without completing the POI', () => {
    const run = makeRun([], [{ task_time_limit_ms: 30, timeout_action: { type: 'fail' } }]);
    hunt.checkArrival(run, 'A1', P0);
    sleepMs(60);
    hunt.tickHunt(run);
    assert.ok(run.progress.A1.completedAt, 'track ends (failed), not just skipped');
    assert.ok(run.events.some(e => e.type === 'progress_failed'));
  });

  check('leg timeout ("skip") advances to the next POI without ever arriving', () => {
    const run = makeRun([{ travel_time_limit_ms: 30, timeout_action: { type: 'skip' } }]);
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm'); // now mid-leg toward poi_1
    assert.equal(run.progress.A1.currentPoiIndex, 1);
    sleepMs(60);
    hunt.tickHunt(run);
    assert.equal(run.progress.A1.currentPoiIndex, 2, 'leg timeout skipped straight to poi_2');
  });
}

console.log('\n═══ STRICT ROUTE ENFORCEMENT ═══');
{
  check('a defined+strict route flags deviation once the sample strays far from the path', () => {
    const path = [P0, P1];
    const run = makeRun([{ route_type: 'defined', enforcement: 'strict', path_geojson: path }]);
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm'); // mid-leg toward poi_1, route now armed
    const farOff = shared.destinationPoint(P0, 0, 200); // 200m perpendicular-ish, well past tolerance
    hunt.tickHunt(run, { A1: farOff });
    assert.equal(run.progress.A1.routeDeviation, true);
    assert.ok(run.events.some(e => e.type === 'route_deviation'));
  });

  check('a guidance route never flags deviation regardless of position', () => {
    const path = [P0, P1];
    const run = makeRun([{ route_type: 'defined', enforcement: 'guidance', path_geojson: path }]);
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm');
    const farOff = shared.destinationPoint(P0, 0, 200);
    hunt.tickHunt(run, { A1: farOff });
    assert.equal(run.progress.A1.routeDeviation, false);
  });

  check('distanceToPolylineM: on the segment is ~0, off to the side matches the perpendicular offset', () => {
    const mid = shared.destinationPoint(P0, 90, 25); // halfway along P0->P1
    assert.ok(hunt.distanceToPolylineM(mid, [P0, P1]) < 1);
    const off = shared.destinationPoint(mid, 0, 30); // 30m off to the side
    const d = hunt.distanceToPolylineM(off, [P0, P1]);
    assert.ok(d > 25 && d < 35, `expected ~30m, got ${d}`);
  });
}

console.log('\n═══ LATE-JOIN MODES ═══');
{
  check('"shared" join hangs directly off the existing group track', () => {
    const run = makeRun([], [], 'shared', [{ userId: 'A1' }]);
    const r = hunt.joinHuntRun(run, 'B1', 'shared', {});
    assert.equal(r.ok, true);
    assert.equal(r.key, 'shared');
    assert.equal(Object.keys(run.progress).length, 1, 'no new track created — same shared row');
  });

  check('"shared" join for teams requires an existing team track', () => {
    const run = makeRun([], [], 'teams', [{ userId: 'A1', team: 'a' }]);
    const ok = hunt.joinHuntRun(run, 'B1', 'shared', { team: 'a' });
    assert.equal(ok.ok, true);
    assert.equal(ok.key, 'a');
    const bad = hunt.joinHuntRun(run, 'C1', 'shared', { team: 'b' });
    assert.equal(bad.ok, false, 'team b never started — nothing to join');
  });

  check('"clone" copies another player\'s current progress into a new independent track', () => {
    const run = makeRun([], [], 'individual', [{ userId: 'A1' }]);
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm'); // A1 now at poi_1
    const r = hunt.joinHuntRun(run, 'B1', 'clone', { cloneFromKey: 'A1' });
    assert.equal(r.ok, true);
    assert.equal(run.progress.B1.currentPoiIndex, 1, 'cloned A1\'s current position in the hunt');
    // Independent from here on — B1 finishing its task doesn't affect A1.
    hunt.checkArrival(run, 'B1', P1);
    hunt.confirmTargetDestroyed(run, 'B1');
    assert.equal(run.progress.B1.currentPoiIndex, 2);
    assert.equal(run.progress.A1.currentPoiIndex, 1, 'A1 untouched by B1\'s own progress');
  });

  check('"fresh" join always starts at the first POI', () => {
    const run = makeRun([], [], 'individual', [{ userId: 'A1' }]);
    hunt.checkArrival(run, 'A1', P0);
    hunt.submitPuzzleAnswer(run, 'A1', 'Turm');
    const r = hunt.joinHuntRun(run, 'B1', 'fresh', {});
    assert.equal(r.ok, true);
    assert.equal(run.progress.B1.currentPoiIndex, 0);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
