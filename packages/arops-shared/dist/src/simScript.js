"use strict";
// ═══════════════════════════════════════════════════════════
//  AR OPS — on-device match-simulation scenarios (debug-only)
//
//  ~50 FIXED, non-configurable, SHORT (1-10s) scripted conditions used to
//  smoke-test the real client↔server pipeline (telemetry, hit attempts,
//  snapshots, zone capture) end-to-end, automatically. Deliberately short
//  and single-purpose (one shot or one capture check each) rather than a
//  handful of full matches — a full match needs a real warmup/base-setup
//  prep phase before anything is even testable (tens of seconds each, see
//  arops.js's MODES), which made the earlier "few long matches" design far
//  too slow for what this is actually for. Simulation sessions skip that
//  phase entirely (see arops.js's createAropsGame, right after
//  mode.initState), so a scenario's own durationMs only ever has to cover
//  the actual check, not any prep time.
//
//  Bots (and, for the bot-fires-back scenarios, the tester too) use
//  scripted positions instead of real GPS/compass — this deliberately does
//  NOT test real-world sensor noise, only that the client/server CODE PATH
//  produces the outcome the script expects.
//
//  Single source of truth for both sides: the server's simulation engine
//  (tickSimBots, arops.js) drives bots through exactly this data (what
//  actually happens), and the mobile Match-Simulation screen predicts
//  outcomes from the same data (what SHOULD happen) — importing one copy
//  of this file everywhere is what keeps the two from silently drifting
//  apart.
//
//  All positions are relative offsets (bearing + distance) from a single
//  runtime-supplied origin (the device's position when a run starts) via
//  `destinationPoint()`, so every scenario is anchored fresh and works
//  anywhere, not just at one fixed real-world location.
//
//  Randomized but reproducible: every value below comes from a seeded PRNG
//  (mulberry32), not Math.random() — the numbers vary across scenarios
//  (per the "teils randomisiert" request) but are IDENTICAL on every run,
//  so server/test/arops_sim.test.js stays a stable regression anchor
//  instead of a flaky one.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIM_SCENARIOS = void 0;
exports.squareFieldCorners = squareFieldCorners;
/** Square field corners (bearing+distance from the origin) for a given side length. */
function squareFieldCorners(sideM) {
    const half = (sideM * Math.SQRT2) / 2;
    return [45, 135, 225, 315].map(bearingDeg => ({ tMs: 0, bearingDeg, distanceM: half }));
}
// ── seeded PRNG (mulberry32) — deterministic, no external dependency ──
function mulberry32(seed) {
    let s = seed | 0;
    return function next() {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function randRange(rand, min, max) {
    return min + rand() * (max - min);
}
// Fixed, generous shot-range config for every shooting scenario — decoupled
// from field-size auto-scaling so the expected in/out margins are exact:
//   scout:  range 35m, cone half-angle min(45, 15*3)=45° (see effectiveHitInfo, arops.js)
//   sniper: range 70m, lateral tolerance tan(15°)*10 ≈ 2.68m
//   bomber: range 8.75m, omni
const HIT_CONFIG = { maxRangeM: 35, baseConeHalfAngleDeg: 15 };
const SNIPER_LATERAL_TOLERANCE_M = Math.tan((15 * Math.PI) / 180) * 10;
// Every hit compresses a freeze onto the target — kept short so it can
// never bleed into the NEXT scenario's own (separate, freshly-created)
// session, but still long enough to be a meaningful check on its own.
const COMPRESSED_TIMINGS = { freezeMs: 600, freezeExtensionMs: 300, captureDwellMs: 800 };
// Three field-size tiers, cycled across scenarios for geometric variety
// ("mit Map-Größen") — sized to comfortably contain every shot distance
// used below (half-diagonal well past HIT_CONFIG.maxRangeM) regardless of
// tier, so field size never becomes an accidental confound in a shooting
// scenario's pass/fail.
const FIELD_TIERS = [90, 130, 180];
function generateShootingScenarios(rand, startIndex) {
    const scenarios = [];
    let i = startIndex;
    const push = (s) => {
        scenarios.push({
            key: `scenario_${i}`,
            subMode: 'deathmatch',
            onHit: 'freeze',
            hitConfig: HIT_CONFIG,
            timings: COMPRESSED_TIMINGS,
            fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length],
            ...s,
        });
        i++;
    };
    // Scout: wide cone (45°), 35m range.
    for (let n = 0; n < 6; n++) {
        const bearing = randRange(rand, -30, 30); // clearly inside the 45° cone
        const distance = randRange(rand, 5, 25); // clearly inside 35m range
        push({
            label: `Scout Treffer #${n + 1}`, testerClass: 'scout', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
            checkpoints: [],
        });
    }
    for (let n = 0; n < 5; n++) {
        const bearing = randRange(rand, 55, 90) * (rand() < 0.5 ? 1 : -1); // clearly outside the 45° cone
        const distance = randRange(rand, 5, 25);
        push({
            label: `Scout außerhalb Kegel #${n + 1}`, testerClass: 'scout', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: false, expectedReason: 'outside_cone' }],
            checkpoints: [],
        });
    }
    for (let n = 0; n < 4; n++) {
        const bearing = randRange(rand, -15, 15); // dead ahead — isolates the range check from the cone check
        const distance = randRange(rand, 45, 60); // clearly beyond 35m
        push({
            label: `Scout außer Reichweite #${n + 1}`, testerClass: 'scout', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: false, expectedReason: 'out_of_range' }],
            checkpoints: [],
        });
    }
    // Sniper: fixed ~2.68m lateral tolerance regardless of distance, 70m range.
    for (let n = 0; n < 6; n++) {
        const distance = randRange(rand, 15, 40);
        const lateralM = randRange(rand, 0, SNIPER_LATERAL_TOLERANCE_M * 0.6); // comfortably inside tolerance
        const bearing = (Math.asin(lateralM / distance) * 180) / Math.PI * (rand() < 0.5 ? 1 : -1);
        push({
            label: `Sniper Treffer #${n + 1}`, testerClass: 'sniper', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
            checkpoints: [],
        });
    }
    for (let n = 0; n < 5; n++) {
        const distance = randRange(rand, 15, 40);
        const lateralM = randRange(rand, SNIPER_LATERAL_TOLERANCE_M * 1.5, SNIPER_LATERAL_TOLERANCE_M * 2.5); // comfortably beyond tolerance
        const bearing = (Math.asin(Math.min(0.99, lateralM / distance)) * 180) / Math.PI * (rand() < 0.5 ? 1 : -1);
        push({
            label: `Sniper außerhalb Toleranz #${n + 1}`, testerClass: 'sniper', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: false, expectedReason: 'outside_lateral' }],
            checkpoints: [],
        });
    }
    // Bomber: omni, 8.75m range, no aiming needed.
    for (let n = 0; n < 6; n++) {
        const bearing = randRange(rand, 0, 360);
        const distance = randRange(rand, 1, 6); // clearly inside 8.75m
        push({
            label: `Bomber Treffer #${n + 1}`, testerClass: 'bomber', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
            checkpoints: [],
        });
    }
    for (let n = 0; n < 5; n++) {
        const bearing = randRange(rand, 0, 360);
        const distance = randRange(rand, 12, 25); // clearly beyond 8.75m
        push({
            label: `Bomber außer Reichweite #${n + 1}`, testerClass: 'bomber', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: false, expectedReason: 'out_of_range' }],
            checkpoints: [],
        });
    }
    // Bot shoots back at the tester (scout shooter class — wide, reliable cone).
    for (let n = 0; n < 5; n++) {
        const distance = randRange(rand, 5, 20);
        const bearing = randRange(rand, 0, 360);
        push({
            label: `Bot schießt zurück #${n + 1}`, testerClass: 'scout', testerHeadingDeg: 0, durationMs: 2500,
            bots: [{ id: `bot_${i}`, username: 'SimShooter', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
            // tickSimBots aims a bot's shot heading at its declared target automatically.
            shoots: [{ tMs: 500, shooterId: `bot_${i}`, targetId: 'tester', expectedHit: true }],
            checkpoints: [],
        });
    }
    return scenarios;
}
function generateCaptureScenarios(rand, startIndex) {
    const scenarios = [];
    let i = startIndex;
    for (let n = 0; n < 8; n++) {
        const fieldSideM = FIELD_TIERS[i % FIELD_TIERS.length];
        const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.3);
        const zoneBearing = randRange(rand, 0, 360);
        // 2nd zone (domination's minimum) — opposite bearing, far enough out to
        // clear validateZones' minimum separation ((r1+r2)*1.5); nobody ever
        // interacts with it.
        const fillerBearing = (zoneBearing + 180) % 360;
        const captureDwellMs = COMPRESSED_TIMINGS.captureDwellMs;
        scenarios.push({
            key: `scenario_${i}`,
            label: `Pod einnehmen #${n + 1}`,
            subMode: 'domination',
            onHit: 'freeze', // no base concept for domination — skips straight to (instantly-skipped) warmup
            testerClass: 'scout',
            testerTeam: 'b', // opposite of the capturing bot's 'a' — default alternation would otherwise put both on 'a'
            fieldSideM,
            durationMs: captureDwellMs + 2000,
            timings: COMPRESSED_TIMINGS,
            zones: [
                { tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance },
                { tMs: 0, bearingDeg: fillerBearing, distanceM: zoneDistance + 30 },
            ],
            // Placed directly inside the zone from t=0 — dwell begins the instant
            // 'live' starts (instant for simulation sessions, see arops.js), no
            // walk-in needed for a scenario this short.
            bots: [{ id: `bot_${i}`, username: 'SimCapturer', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] }],
            testerHeadingDeg: 0,
            shoots: [],
            checkpoints: [{ tMs: captureDwellMs + 1000, check: 'zoneOwner', targetIndex: 0, expected: 'a' }],
        });
        i++;
    }
    return scenarios;
}
const SIM_SCENARIOS_SEED = 20260722;
function generateSimScenarios(seed) {
    const rand = mulberry32(seed);
    const shooting = generateShootingScenarios(rand, 0);
    const capture = generateCaptureScenarios(rand, shooting.length);
    return [...shooting, ...capture];
}
/** ~50 fixed, seeded-random short scenarios — see file header. Regenerating
 *  this (module load, once) is deliberately cheap and pure so both the
 *  server and the mobile client always agree on exactly the same list. */
exports.SIM_SCENARIOS = generateSimScenarios(SIM_SCENARIOS_SEED);
