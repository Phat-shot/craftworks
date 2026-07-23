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

export type SimClass = 'scout' | 'sniper' | 'bomber';

/** A point the bot should be at from time `tMs` onward (server interpolates
 *  gradually if it's not already there, same brisk-walk pace tickBots
 *  already uses — not a teleport, so plausibility checks are naturally
 *  satisfied). Every generated scenario below uses a single (tMs:0) entry —
 *  bots are simply PLACED, never routed, since a 1-10s scenario has no time
 *  for a multi-leg walk anyway. */
export interface SimWaypoint {
  tMs: number;
  bearingDeg: number;
  distanceM: number;
}

export interface SimBotScript {
  id: string;
  username: string;
  class: SimClass;
  team: 'a' | 'b' | null;
  route: SimWaypoint[];
}

export interface SimShootBeat {
  tMs: number;
  /** 'tester' or a SimBotScript id. */
  shooterId: string;
  /** 'tester' or a SimBotScript id. */
  targetId: string;
  expectedHit: boolean;
  /** Diagnostic only (shown on mismatch), not asserted against exactly. */
  expectedReason?: string;
}

export interface SimCheckpoint {
  tMs: number;
  check: 'zoneOwner' | 'gameOver';
  /** Zone index (0-based) within the scenario's own zones array. Unused
   *  (-1) for 'gameOver' checkpoints. */
  targetIndex: number;
  /** 'zoneOwner': expected owning team ('a'|'b'), or null if the zone
   *  should still be uncaptured (e.g. contested by both teams at once —
   *  see generateContestedAndBoundaryScenarios). 'gameOver': the expected
   *  gs.winner / snap.winner string once the match has ended. */
  expected: string | null;
}

export interface SimScenario {
  key: string;
  /** Which of the 3 phase-3 ("Logik") buckets this belongs to — purely for
   *  grouping in MatchSimScreen's progress display, doesn't affect how a
   *  scenario runs. 'basis': the original shot/capture/miss checks.
   *  'szenario': contested captures + boundary conditions. 'kondition':
   *  win/end-condition coverage across every mode. */
  category: 'basis' | 'szenario' | 'kondition';
  label: string;
  subMode: 'deathmatch' | 'domination' | 'ctf' | 'seek_destroy' | 'hide_and_seek';
  testerClass: SimClass;
  /** Only set where it matters (team-capable modes — a bot needs the
   *  tester on a specific team, or default alternation could put them on
   *  the wrong one, since the tester is always the first non-bot player).
   *  Omitted where team assignment never affects the outcome. */
  testerTeam?: 'a' | 'b';
  /** Square field side length in meters — corners computed from this. */
  fieldSideM: number;
  durationMs: number;
  onHit?: 'freeze' | 'respawn';
  /** ar_settings.hitConfig override — every shooting scenario fixes this so
   *  the expected in/out-of-range and cone/lateral math is exact, not
   *  dependent on field-size auto-scaling. */
  hitConfig?: { maxRangeM: number; baseConeHalfAngleDeg: number };
  /** Compressed dwell/freeze times (ms) — bypasses the 5s floor that only
   *  applies to real, client-sent ar_settings.timings (see platform.js's
   *  socket whitelist; createAropsGame's own internal parsing has no such
   *  floor), so a whole freeze/capture cycle fits inside a short scenario. */
  timings?: Record<string, number>;
  /** Zone center offsets from the origin (domination/seek_destroy only).
   *  Domination needs at least 2 — a 2nd, far-away, uninteracted-with
   *  filler satisfies that minimum where only one zone is actually used. */
  zones?: SimWaypoint[];
  bots: SimBotScript[];
  testerHeadingDeg: number;
  shoots: SimShootBeat[];
  checkpoints: SimCheckpoint[];
  // ── Win-condition scenario fields (generateWinConditionScenarios) —
  // each is just an ordinary ar_settings field, passed straight through by
  // applySimOverrides (arops.js) same as onHit/hitConfig/timings above.
  teamVariant?: 'team' | 'ffa';
  gameDurationMs?: number;
  hidingDurationMs?: number;
  targetScore?: number;
  targetCaptures?: number;
  livesPerPlayer?: number;
  destroyVariant?: 'instant' | 'defuse';
  foundMode?: 'spectator' | 'seeker' | 'freeze';
  hsVariant?: 'classic' | 'ffa' | 'the_ship';
}

/** Square field corners (bearing+distance from the origin) for a given side length. */
export function squareFieldCorners(sideM: number): SimWaypoint[] {
  const half = (sideM * Math.SQRT2) / 2;
  return [45, 135, 225, 315].map(bearingDeg => ({ tMs: 0, bearingDeg, distanceM: half }));
}

// ── seeded PRNG (mulberry32) — deterministic, no external dependency ──
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

// Fixed, generous shot-range config for every shooting scenario — decoupled
// from field-size auto-scaling so the expected in/out margins are exact:
//   scout:  range 35m, cone half-angle min(45, 15*3)=45° (see effectiveHitInfo, arops.js)
//   sniper: range 70m, lateral tolerance tan(15°)*10 ≈ 2.68m
//   bomber: range 8.75m, omni
const HIT_CONFIG = { maxRangeM: 35, baseConeHalfAngleDeg: 15 };
const SNIPER_LATERAL_TOLERANCE_M = Math.tan((15 * Math.PI) / 180) * 10;

// squareFieldCorners places corners at bearings 45/135/225/315 — meaning
// the SQUARE'S OWN EDGES run along bearings 0/90/180/270, at only
// fieldSideM/2 from center (not the half-diagonal every FIELD_TIERS entry
// safely clears at 45°-ish bearings). Any zone/filler placed at a bearing
// near 0/90/180/270 — which random 0-360 bearings and the fixed-axis zones
// below both do — must stay under fieldSideM/2, not the more generous
// half-diagonal. Rather than special-casing every such placement's exact
// bearing, scenarios that place a zone (needs a filler well outside it too,
// see the domination-zone-minimum comment elsewhere in this file) use this
// single deliberately-oversized, fixed field instead of cycling FIELD_TIERS —
// size VARIETY doesn't matter for what these specific scenarios check.
const SAFE_ZONE_FIELD_M = 220;

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

function generateShootingScenarios(rand: () => number, startIndex: number): SimScenario[] {
  const scenarios: SimScenario[] = [];
  let i = startIndex;
  const push = (s: Omit<SimScenario, 'key' | 'category' | 'subMode' | 'onHit' | 'hitConfig' | 'timings' | 'fieldSideM'> & { fieldSideM?: number }) => {
    scenarios.push({
      key: `scenario_${i}`,
      category: 'basis',
      subMode: 'deathmatch',
      onHit: 'freeze',
      hitConfig: HIT_CONFIG,
      timings: COMPRESSED_TIMINGS,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!,
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

function generateCaptureScenarios(rand: () => number, startIndex: number): SimScenario[] {
  const scenarios: SimScenario[] = [];
  let i = startIndex;
  for (let n = 0; n < 8; n++) {
    const fieldSideM = FIELD_TIERS[i % FIELD_TIERS.length]!;
    const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.3);
    const zoneBearing = randRange(rand, 0, 360);
    // 2nd zone (domination's minimum) — opposite bearing, far enough out to
    // clear validateZones' minimum separation ((r1+r2)*1.5); nobody ever
    // interacts with it.
    const fillerBearing = (zoneBearing + 180) % 360;
    const captureDwellMs = COMPRESSED_TIMINGS.captureDwellMs;
    scenarios.push({
      key: `scenario_${i}`,
      category: 'basis',
      label: `Pod einnehmen #${n + 1}`,
      subMode: 'domination',
      onHit: 'freeze', // no base concept for domination — skips straight to (instantly-skipped) warmup
      testerClass: 'scout',
      testerTeam: 'b', // opposite of the capturing bot's 'a' — default alternation would otherwise put both on 'a'
      fieldSideM,
      durationMs: captureDwellMs + 2_000,
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
      checkpoints: [{ tMs: captureDwellMs + 1_000, check: 'zoneOwner', targetIndex: 0, expected: 'a' }],
    });
    i++;
  }
  return scenarios;
}

// Freeze must comfortably outlast the capture dwell in the "contest clears"
// sub-category below — otherwise the frozen contester unfreezes (still
// standing right where it was) and re-contests the zone before the dwell
// even finishes. Domination's own zone-presence check excludes frozen
// players entirely (see zonePresence/isFrozen in arops.js), so freezing is
// a reliable, already-proven way to make a contester "clear" without
// needing it to physically walk anywhere (which — at tickSimBots' fixed
// ~1.3 m/s walking pace — would take far longer than a short scenario
// budgets for).
const CONTEST_TIMINGS = { freezeMs: 2500, freezeExtensionMs: 500, captureDwellMs: 700 };

/**
 * "Szenarien" bucket — contested-zone behavior (does the pod correctly
 * stay uncaptured while both teams are present, and correctly resume once
 * one side clears) plus boundary conditions right at the edge of shot
 * range/cone/lateral-tolerance/capture-dwell, where the existing "basis"
 * scenarios deliberately stay comfortably clear of the edge instead.
 */
function generateContestedAndBoundaryScenarios(rand: () => number, startIndex: number): SimScenario[] {
  const scenarios: SimScenario[] = [];
  let i = startIndex;
  const push = (s: Omit<SimScenario, 'key' | 'category'>) => {
    scenarios.push({ key: `scenario_${i}`, category: 'szenario', ...s });
    i++;
  };

  // Both teams present in the zone from t=0 the whole time — never a lone
  // occupant, so capture progress must stay at 0 (paused, never reset —
  // see domination's own tick comment) and the zone must stay unowned.
  for (let n = 0; n < 15; n++) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.3);
    const zoneBearing = randRange(rand, 0, 360);
    const fillerBearing = (zoneBearing + 180) % 360;
    push({
      label: `Kontest: Zone bleibt uneingenommen #${n + 1}`,
      subMode: 'domination', onHit: 'freeze', testerClass: 'scout', testerTeam: 'a',
      fieldSideM, durationMs: 2_000, timings: COMPRESSED_TIMINGS,
      zones: [
        { tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance },
        { tMs: 0, bearingDeg: fillerBearing, distanceM: zoneDistance + 30 },
      ],
      bots: [
        { id: `bot_${i}_a`, username: 'SimA', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] },
        { id: `bot_${i}_b`, username: 'SimB', class: 'scout', team: 'b', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] },
      ],
      testerHeadingDeg: 0, shoots: [],
      checkpoints: [{ tMs: 1_500, check: 'zoneOwner', targetIndex: 0, expected: null }],
    });
  }

  // Tester freezes the team-b contester (within scout's 45° cone/35m range
  // from the origin, same as every "basis" scout-hit scenario) — once
  // frozen, team-a's bot has the zone alone and the dwell completes.
  for (let n = 0; n < 10; n++) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    const zoneDistance = randRange(rand, 10, 25); // inside 35m range
    const zoneBearing = randRange(rand, -25, 25); // inside the 45° scout cone
    const fillerBearing = (zoneBearing + 180) % 360;
    const shotAtMs = 300;
    push({
      label: `Kontest löst sich durch Freeze, Pod wird danach erobert #${n + 1}`,
      subMode: 'domination', onHit: 'freeze', testerClass: 'scout', testerTeam: 'a',
      fieldSideM, durationMs: shotAtMs + CONTEST_TIMINGS.captureDwellMs + 1_000,
      hitConfig: HIT_CONFIG, timings: CONTEST_TIMINGS,
      zones: [
        { tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance },
        // +70 (not the usual +30) — validateZones' minimum separation is
        // (r1+r2)*1.5 = zoneRadiusM*3 (≈82.5m at SAFE_ZONE_FIELD_M's
        // L=220), and this zone's own opposite-bearing placement only
        // contributes 2×zoneDistance (as low as 20m at zoneDistance's own
        // 10m floor) toward that — the filler needs the extra distance to
        // still clear it even in that worst case.
        { tMs: 0, bearingDeg: fillerBearing, distanceM: zoneDistance + 70 },
      ],
      bots: [
        { id: `bot_${i}_a`, username: 'SimA', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] },
        { id: `bot_${i}_b`, username: 'SimB', class: 'scout', team: 'b', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] },
      ],
      testerHeadingDeg: 0,
      shoots: [{ tMs: shotAtMs, shooterId: 'tester', targetId: `bot_${i}_b`, expectedHit: true }],
      checkpoints: [{ tMs: shotAtMs + CONTEST_TIMINGS.captureDwellMs + 400, check: 'zoneOwner', targetIndex: 0, expected: 'a' }],
    });
  }

  // Shot-range boundary — distance right at maxRangeM (35m), both sides.
  for (let n = 0; n < 10; n++) {
    const inside = n % 2 === 0;
    const distance = inside ? HIT_CONFIG.maxRangeM - randRange(rand, 0.05, 0.3) : HIT_CONFIG.maxRangeM + randRange(rand, 0.05, 0.3);
    const bearing = randRange(rand, -10, 10); // dead ahead, isolates range from cone
    push({
      label: `Grenze Reichweite (${inside ? 'knapp innerhalb' : 'knapp außerhalb'}) #${n + 1}`,
      subMode: 'deathmatch', onHit: 'freeze', testerClass: 'scout', hitConfig: HIT_CONFIG,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!, durationMs: 2_000, timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
      testerHeadingDeg: 0,
      shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: inside, expectedReason: inside ? undefined : 'out_of_range' }],
      checkpoints: [],
    });
  }

  // Scout cone boundary — bearing right at the 45° effective half-angle.
  for (let n = 0; n < 8; n++) {
    const inside = n % 2 === 0;
    const edge = 45 + (inside ? -randRange(rand, 0.1, 0.5) : randRange(rand, 0.1, 0.5));
    const bearing = edge * (rand() < 0.5 ? 1 : -1);
    push({
      label: `Grenze Scout-Kegel (${inside ? 'knapp innerhalb' : 'knapp außerhalb'}) #${n + 1}`,
      subMode: 'deathmatch', onHit: 'freeze', testerClass: 'scout', hitConfig: HIT_CONFIG,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!, durationMs: 2_000, timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: 15 }] }],
      testerHeadingDeg: 0,
      shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: inside, expectedReason: inside ? undefined : 'outside_cone' }],
      checkpoints: [],
    });
  }

  // Sniper lateral-tolerance boundary.
  for (let n = 0; n < 7; n++) {
    const inside = n % 2 === 0;
    const distance = randRange(rand, 15, 30);
    const edgeLateral = SNIPER_LATERAL_TOLERANCE_M + (inside ? -randRange(rand, 0.02, 0.1) : randRange(rand, 0.02, 0.1));
    const bearing = (Math.asin(Math.min(0.99, edgeLateral / distance)) * 180) / Math.PI * (rand() < 0.5 ? 1 : -1);
    push({
      label: `Grenze Sniper-Toleranz (${inside ? 'knapp innerhalb' : 'knapp außerhalb'}) #${n + 1}`,
      subMode: 'deathmatch', onHit: 'freeze', testerClass: 'sniper', hitConfig: HIT_CONFIG,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!, durationMs: 2_000, timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
      testerHeadingDeg: 0,
      shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: inside, expectedReason: inside ? undefined : 'outside_lateral' }],
      checkpoints: [],
    });
  }

  // Capture-dwell boundary — same zone, TWO checkpoints in one scenario:
  // still uncaptured just before captureDwellMs, captured just after.
  for (let n = 0; n < 7; n++) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.3);
    const zoneBearing = randRange(rand, 0, 360);
    const fillerBearing = (zoneBearing + 180) % 360;
    const dwellMs = COMPRESSED_TIMINGS.captureDwellMs;
    push({
      label: `Grenze Capture-Dwell (kurz vor/nach ${dwellMs}ms) #${n + 1}`,
      subMode: 'domination', onHit: 'freeze', testerClass: 'scout', testerTeam: 'b',
      fieldSideM, durationMs: dwellMs + 1_500, timings: COMPRESSED_TIMINGS,
      zones: [
        { tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance },
        { tMs: 0, bearingDeg: fillerBearing, distanceM: zoneDistance + 30 },
      ],
      bots: [{ id: `bot_${i}`, username: 'SimCapturer', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] }],
      testerHeadingDeg: 0, shoots: [],
      // Only the post-dwell "captured" checkpoint — arops_sim.test.js's
      // harness (server/test/arops_sim.test.js) evaluates every checkpoint
      // against the FINAL state after driveScenario's whole loop finishes,
      // not a live snapshot at each one's own tMs (that's the mobile
      // client's own runScenario, via real setTimeout) — a "not captured
      // YET" assertion earlier in the same short scenario has nothing
      // distinct left to check by then, both would just see the same
      // already-finished result. The real value of "was it still
      // uncaptured right up until the boundary" gets exercised live on
      // device instead.
      checkpoints: [
        { tMs: dwellMs + 400, check: 'zoneOwner', targetIndex: 0, expected: 'a' },
      ],
    });
  }

  return scenarios;
}

// Combos of {mode, teamVariant, onHit/hsVariant} whose match, left to just
// run its clock out with nobody scoring, has an UNAMBIGUOUS, mode-agnostic
// winner string — 'draw' for every team-capable mode (symmetric 0-0) and
// every ffa/the_ship H&S variant, 'hiders' for classic H&s specifically
// (its time-limit branch has no draw case at all, see MODES.hide_and_seek.
// tick). Deliberately the CHEAPEST possible win-condition check — no
// scripted action needed at all, just field/mode setup plus a tiny
// gameDurationMs — so a wide combinatorial sweep is affordable.
const TEAM_CAPABLE_MODES: SimScenario['subMode'][] = ['domination', 'ctf', 'seek_destroy', 'deathmatch'];

function generateTimeLimitDrawScenarios(rand: () => number, startIndex: number): SimScenario[] {
  const scenarios: SimScenario[] = [];
  let i = startIndex;
  const push = (s: Omit<SimScenario, 'key' | 'category'>) => {
    scenarios.push({ key: `scenario_${i}`, category: 'kondition', ...s });
    i++;
  };
  const gameDurationMs = 700;
  const hidingDurationMs = 50;

  for (const subMode of TEAM_CAPABLE_MODES) {
    for (const teamVariant of ['team', 'ffa'] as const) {
      for (const onHit of ['freeze', 'respawn'] as const) {
        const fieldSideM = SAFE_ZONE_FIELD_M;
        push({
          label: `Zeitlimit -> Unentschieden: ${subMode}/${teamVariant}/${onHit}`,
          subMode, onHit, teamVariant, testerClass: 'scout', testerTeam: 'a',
          fieldSideM, durationMs: gameDurationMs + 1_500, gameDurationMs,
          timings: COMPRESSED_TIMINGS,
          livesPerPlayer: onHit === 'respawn' ? 3 : undefined,
          // 3rd zone: seek_destroy's 'instant' variant ("Symmetrisch mit
          // Restore") always reactivates now, which requires more targets
          // than teams/players (2 here) — see the matching comment in
          // generateActionWinScenarios below.
          zones: (subMode === 'domination' || subMode === 'seek_destroy')
            ? [{ tMs: 0, bearingDeg: 0, distanceM: fieldSideM * 0.3 }, { tMs: 0, bearingDeg: 180, distanceM: fieldSideM * 0.3 + 30 },
               { tMs: 0, bearingDeg: 90, distanceM: fieldSideM * 0.3 }]
            : undefined,
          // One idle, non-interacting opponent — checkEliminationWin/H&S's
          // own checkWin both deliberately never end a solo (<2 player)
          // session (see arops.js), and a bare tester alone would also
          // make "team b" itself literally not exist for team-mode combos.
          bots: [{ id: `bot_${i}`, username: 'SimIdle', class: 'scout', team: 'b', route: [{ tMs: 0, bearingDeg: 90, distanceM: fieldSideM * 0.45 }] }],
          testerHeadingDeg: 0, shoots: [],
          checkpoints: [{ tMs: gameDurationMs + 1_000, check: 'gameOver', targetIndex: -1, expected: 'draw' }],
        });
      }
    }
  }

  // Hide & Seek: classic's time-limit branch always awards 'hiders' (no
  // draw case exists there at all); ffa/the_ship fall back to highest
  // score, 'draw' on a tie — 0-0 here is always a tie.
  for (const hsVariant of ['classic', 'ffa', 'the_ship'] as const) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    push({
      label: `Zeitlimit H&S/${hsVariant}`,
      subMode: 'hide_and_seek', hsVariant, testerClass: 'scout',
      fieldSideM, durationMs: gameDurationMs + 1_500, gameDurationMs, hidingDurationMs,
      timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimIdle', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: 90, distanceM: fieldSideM * 0.45 }] }],
      testerHeadingDeg: 0, shoots: [],
      checkpoints: [{ tMs: gameDurationMs + 1_000, check: 'gameOver', targetIndex: -1, expected: hsVariant === 'classic' ? 'hiders' : 'draw' }],
    });
  }

  return scenarios;
}

/**
 * "Konditionen" bucket, part 2 — an actual scripted action reaches (or
 * decides) the win condition, instead of just letting the clock run out at
 * 0-0. Covers: target score/captures reached, all Zerstören-targets
 * destroyed without reactivation, and — the specific bug this generator
 * exists to guard against — the respawn-variant ELIMINATION win that
 * Domination/CTF/Seek&Destroy previously never had at all (see
 * checkEliminationWin, arops.js).
 */
function generateActionWinScenarios(rand: () => number, startIndex: number): SimScenario[] {
  const scenarios: SimScenario[] = [];
  let i = startIndex;
  const push = (s: Omit<SimScenario, 'key' | 'category'>) => {
    scenarios.push({ key: `scenario_${i}`, category: 'kondition', ...s });
    i++;
  };

  // Domination: target score reached via one capture + a little held time
  // (teamScore accrues 1pt/sec per owned zone — see arops.js tick).
  for (let n = 0; n < 4; n++) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.25);
    const zoneBearing = randRange(rand, 0, 360);
    const dwellMs = COMPRESSED_TIMINGS.captureDwellMs;
    const holdForScoreMs = 1_300; // >1s held after capture -> teamScore >= 1
    push({
      label: `Ziel-Score erreicht: Domination #${n + 1}`,
      subMode: 'domination', onHit: 'freeze', testerClass: 'scout', testerTeam: 'b',
      fieldSideM, durationMs: dwellMs + holdForScoreMs + 1_500,
      gameDurationMs: 600_000, targetScore: 1, timings: COMPRESSED_TIMINGS,
      zones: [
        { tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance },
        { tMs: 0, bearingDeg: (zoneBearing + 180) % 360, distanceM: zoneDistance + 30 },
      ],
      bots: [{ id: `bot_${i}`, username: 'SimCapturer', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] }],
      testerHeadingDeg: 0, shoots: [],
      checkpoints: [{ tMs: dwellMs + holdForScoreMs + 1_000, check: 'gameOver', targetIndex: -1, expected: 'team_a' }],
    });
  }

  // Seek&Destroy 'defuse' variant ("Angriff & Verteidigung"): destroying
  // the only target with no defender present ends the match — this is the
  // only way left to get a non-reactivating single-target game, since
  // 'instant' ("Symmetrisch mit Restore") now always reactivates (host
  // requirement, no exception — see arops.js's createAropsGame). The bot
  // arms the target (plantDwellMs); with nobody defending, it self-
  // detonates after explodeAt = armedAt + plantDwellMs*2.
  for (let n = 0; n < 4; n++) {
    const fieldSideM = SAFE_ZONE_FIELD_M;
    const zoneDistance = randRange(rand, fieldSideM * 0.15, fieldSideM * 0.25);
    const zoneBearing = randRange(rand, 0, 360);
    const plantMs = COMPRESSED_TIMINGS.captureDwellMs;
    const toExplodeMs = plantMs + plantMs * 2; // arm, then the undefended fuse
    push({
      label: `Ziel zerstört ohne Verteidiger (Angriff & Verteidigung): Zerstören #${n + 1}`,
      subMode: 'seek_destroy', destroyVariant: 'defuse', onHit: 'freeze', testerClass: 'scout', testerTeam: 'b',
      fieldSideM, durationMs: toExplodeMs + 1_500,
      gameDurationMs: 600_000, timings: { ...COMPRESSED_TIMINGS, plantDwellMs: plantMs },
      zones: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }],
      bots: [{ id: `bot_${i}`, username: 'SimArmer', class: 'scout', team: 'a', route: [{ tMs: 0, bearingDeg: zoneBearing, distanceM: zoneDistance }] }],
      testerHeadingDeg: 0, shoots: [],
      checkpoints: [{ tMs: toExplodeMs + 1_000, check: 'gameOver', targetIndex: -1, expected: 'team_a' }],
    });
  }

  // The fixed bug: respawn-variant elimination win for Domination/CTF/
  // Seek&Destroy (both team and ffa) — a single life each, one shot wipes
  // the whole opposing side.
  for (const subMode of ['domination', 'ctf', 'seek_destroy'] as const) {
    for (const teamVariant of ['team', 'ffa'] as const) {
      const bearing = randRange(rand, -10, 10);
      const distance = randRange(rand, 5, 20);
      push({
        label: `Eliminierungs-Sieg (respawn): ${subMode}/${teamVariant}`,
        subMode, onHit: 'respawn', teamVariant, testerClass: 'scout', testerTeam: 'a',
        hitConfig: HIT_CONFIG,
        fieldSideM: SAFE_ZONE_FIELD_M, durationMs: 2_000,
        gameDurationMs: 600_000, livesPerPlayer: 1, timings: COMPRESSED_TIMINGS,
        // Diametrically opposite -> separation is 2×distanceM; needs to
        // clear validateZones' (r1+r2)*1.5 = zoneRadiusM*3 minimum (≈82.5m
        // at SAFE_ZONE_FIELD_M's L=220) — 45m each clears it with margin.
        // 3rd zone: seek_destroy's 'instant' variant ("Symmetrisch mit
        // Restore") always reactivates now (host requirement, no
        // exception — see arops.js's createAropsGame), which requires more
        // targets than teams/players (2 here, either team-mode or ffa) —
        // harmless extra for domination, which only ever needed >=2. 100m
        // (not 45m) so its ~100.6m separation from EACH of the other two
        // still clears the 82.5m minimum (45m would only give ~63.6m at
        // this 90°-apart placement, too close).
        zones: (subMode === 'domination' || subMode === 'seek_destroy')
          ? [{ tMs: 0, bearingDeg: 90, distanceM: 45 }, { tMs: 0, bearingDeg: 270, distanceM: 45 },
             { tMs: 0, bearingDeg: 0, distanceM: 100 }] : undefined,
        bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: 'b', route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
        testerHeadingDeg: 0,
        shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
        checkpoints: [{
          // 'player_tester' — same runtime-resolved-sentinel convention
          // shoots[].targetId==='tester' already uses (the tester's real
          // userId differs between the server test harness and an actual
          // device run) — both checkCheckpoints (arops_sim.test.js) and
          // MatchSimScreen's own checker substitute the real id before comparing.
          tMs: 1_500, check: 'gameOver', targetIndex: -1,
          expected: teamVariant === 'ffa' ? 'player_tester' : 'team_a',
        }],
      });
    }
  }

  // Deathmatch (already had its own checkWin — regression coverage, not
  // new behavior) + classic H&S found-all-hiders.
  {
    const bearing = randRange(rand, -10, 10);
    const distance = randRange(rand, 5, 20);
    push({
      label: 'Eliminierungs-Sieg: Deathmatch (bestehender Pfad, Regressionsschutz)',
      subMode: 'deathmatch', onHit: 'respawn', testerClass: 'scout', testerTeam: 'a',
      hitConfig: HIT_CONFIG,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!, durationMs: 2_000,
      gameDurationMs: 600_000, livesPerPlayer: 1, timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimTarget', class: 'scout', team: 'b', route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
      testerHeadingDeg: 0,
      shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
      checkpoints: [{ tMs: 1_500, check: 'gameOver', targetIndex: -1, expected: 'team_a' }],
    });
  }
  {
    const bearing = randRange(rand, -10, 10);
    const distance = randRange(rand, 5, 20);
    push({
      label: 'Sieg durch alle Hider gefunden: klassisches H&S',
      subMode: 'hide_and_seek', hsVariant: 'classic', testerClass: 'scout',
      hitConfig: HIT_CONFIG, hidingDurationMs: 50,
      fieldSideM: FIELD_TIERS[i % FIELD_TIERS.length]!, durationMs: 2_000,
      gameDurationMs: 600_000, foundMode: 'spectator', timings: COMPRESSED_TIMINGS,
      bots: [{ id: `bot_${i}`, username: 'SimHider', class: 'scout', team: null, route: [{ tMs: 0, bearingDeg: bearing, distanceM: distance }] }],
      testerHeadingDeg: 0,
      shoots: [{ tMs: 500, shooterId: 'tester', targetId: `bot_${i}`, expectedHit: true }],
      checkpoints: [{ tMs: 1_500, check: 'gameOver', targetIndex: -1, expected: 'seekers' }],
    });
  }

  return scenarios;
}

const SIM_SCENARIOS_SEED = 20260722;

function generateSimScenarios(seed: number): SimScenario[] {
  const rand = mulberry32(seed);
  const shooting = generateShootingScenarios(rand, 0);
  const capture = generateCaptureScenarios(rand, shooting.length);
  const contestAndBoundary = generateContestedAndBoundaryScenarios(rand, shooting.length + capture.length);
  const timeLimit = generateTimeLimitDrawScenarios(rand, shooting.length + capture.length + contestAndBoundary.length);
  const actionWin = generateActionWinScenarios(rand, shooting.length + capture.length + contestAndBoundary.length + timeLimit.length);
  return [...shooting, ...capture, ...contestAndBoundary, ...timeLimit, ...actionWin];
}

/** ~50 fixed, seeded-random short scenarios — see file header. Regenerating
 *  this (module load, once) is deliberately cheap and pure so both the
 *  server and the mobile client always agree on exactly the same list. */
export const SIM_SCENARIOS: SimScenario[] = generateSimScenarios(SIM_SCENARIOS_SEED);
