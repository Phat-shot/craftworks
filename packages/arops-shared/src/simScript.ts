// ═══════════════════════════════════════════════════════════
//  AR OPS — on-device match-simulation script (debug-only)
//
//  A FIXED, non-configurable sequence of short scripted matches ("snippets")
//  used to smoke-test the real client↔server pipeline (telemetry, hit
//  attempts, snapshots) end-to-end, automatically. Bots (and, for the
//  bot-fires-back snippet, the tester too) move on a scripted timeline
//  instead of real GPS/compass — this deliberately does NOT test real-world
//  sensor noise, only that the client/server CODE PATH produces the outcome
//  the script expects.
//
//  Single source of truth for both sides: the server's simulation engine
//  drives bots through exactly this data (what actually happens), and the
//  mobile client's Match-Simulation screen predicts outcomes from the same
//  data (what SHOULD happen) — importing one copy of this file everywhere
//  is what keeps the two from silently drifting apart.
//
//  All positions are relative offsets (bearing + distance) from a single
//  runtime-supplied origin (the device's position when a run starts) via
//  `destinationPoint()`, so every snippet is anchored fresh and works
//  anywhere, not just at one fixed real-world location.
// ═══════════════════════════════════════════════════════════

export type SimClass = 'scout' | 'sniper' | 'bomber';

/** A point the bot should be walking toward from time `tMs` onward (server
 *  interpolates gradually, same brisk-walk pace tickBots already uses — not
 *  a teleport, so plausibility/anti-spoof checks are naturally satisfied). */
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
  /** First entry's position is where the bot starts (t=0). */
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

export type SimCheckKind = 'zoneOwner' | 'flagCaptured' | 'bombArmed' | 'bombDefused';

export interface SimCheckpoint {
  tMs: number;
  check: SimCheckKind;
  /** zoneOwner: zone index (0-based). flagCaptured/bombArmed/bombDefused: unused, always 0. */
  targetIndex: number;
  /** zoneOwner: expected team ('a'|'b'). flagCaptured: expected capturing team. bombArmed/bombDefused: expected boolean as string 'true'. */
  expected: string;
}

export interface SimSnippet {
  key: string;
  label: string;
  subMode: 'deathmatch' | 'domination' | 'ctf' | 'seek_destroy';
  testerClass: SimClass;
  testerTeam: 'a' | 'b' | null;
  /** Square field side length in meters — corners computed from this. */
  fieldSideM: number;
  durationMs: number;
  onHit?: 'freeze' | 'respawn';
  destroyVariant?: 'instant' | 'defuse';
  /** ar_settings.hitConfig override — shooting snippets fix this so the
   *  expected in/out-of-range and cone/lateral math doesn't depend on
   *  field-size auto-scaling at all. Omitted for objective snippets, which
   *  don't involve shooting. */
  hitConfig?: { maxRangeM: number; baseConeHalfAngleDeg: number };
  /** Zone center offsets from the origin (domination/seek_destroy only). */
  zones?: SimWaypoint[];
  bots: SimBotScript[];
  /** Tester's own scripted position/heading over time — omitted (stays put
   *  at the origin, heading 0°) for snippets where only bots move. */
  testerRoute?: SimWaypoint[];
  testerHeadingDeg: number;
  shoots: SimShootBeat[];
  checkpoints: SimCheckpoint[];
}

/** Square field corners (bearing+distance from the origin) for a given side length. */
export function squareFieldCorners(sideM: number): SimWaypoint[] {
  const half = (sideM * Math.SQRT2) / 2;
  return [45, 135, 225, 315].map(bearingDeg => ({ tMs: 0, bearingDeg, distanceM: half }));
}

// Fixed, generous shot-range config for the 3 class snippets + bot-returns-
// fire — decoupled from field-size auto-scaling so the expected in/out
// margins below are exact, not dependent on scaleCoreConfig's clamps.
const SHOOT_HIT_CONFIG = { maxRangeM: 40, baseConeHalfAngleDeg: 15 };
// Effective ranges derived from SHOOT_HIT_CONFIG the same way
// effectiveHitInfo() computes them server-side (see arops.js):
//   scout:  range 40m, cone half-angle min(45, 15*3)=45°
//   sniper: range 80m, lateral tolerance tan(15°)*10 ≈ 2.68m
//   bomber: range 10m, omni

// Every combat mode (Domination/CTF/Seek&Destroy/Deathmatch) needs a real
// prep phase (base_setup or warmup — same gs.timings.baseSettingMs
// duration either way, see arops.js's MODES) before its shootable/objective
// 'live' phase starts — there is no way to skip this from the client, so
// every snippet below budgets for it honestly instead of assuming it's
// instant. Field sizes are chosen so that wait stays short:
//  - 80m side (6,400m²) for the 4 shooting snippets → baseSettingMs≈57.1s,
//    large enough that the up-to-50m test shots still fit comfortably
//    inside the field (half-diagonal≈56.6m).
//  - 50m side (2,500m² — just above the 2,000m² minimum playfield size)
//    for the 3 objective snippets → baseSettingMs≈35.7s, kept small since
//    those snippets don't need range beyond ~25m.
export const SIM_FIELD_SIDE_SHOOT_M = 80;
export const SIM_FIELD_SIDE_OBJECTIVE_M = 50;
// Safely past the 80m field's ~57.1s warmup, so every shoot beat below is
// scheduled relative to this instead of a hand-guessed constant.
const SHOOT_LIVE_AT_MS = 59_000;

export const SIM_SNIPPETS: SimSnippet[] = [
  {
    key: 'scout_cone_boundary',
    label: 'Scout: Kegel & Reichweite',
    subMode: 'deathmatch',
    testerClass: 'scout',
    testerTeam: null,
    fieldSideM: SIM_FIELD_SIDE_SHOOT_M,
    durationMs: SHOOT_LIVE_AT_MS + 46_000,
    onHit: 'freeze',
    hitConfig: SHOOT_HIT_CONFIG,
    testerHeadingDeg: 0,
    bots: [{
      id: 'bot_sim1', username: 'SimTarget', class: 'scout', team: null,
      // A hit freezes the target for freezeMs (8s on this 80m field) —
      // shots that expect a hit must stay >8s apart, or the NEXT shot would
      // find the bot frozen (excluded from candidates: 'no_candidates')
      // regardless of the cone/range condition actually being tested. The
      // repositioning move right after a hit must also stay under the
      // fixed 15m freeze-move tolerance (bearing 55°, not e.g. 80°, keeps
      // the chord from the 20°/15m start comfortably under that). Bots
      // walk at a real ~1.3 m/s, so a longer repositioning hop (like the
      // 30m one below) needs a generous head start, not just a couple of
      // seconds, or the shot fires while it's still mid-transit.
      route: [
        { tMs: 0, bearingDeg: 20, distanceM: 15 },                             // inside 45° cone, inside 40m range
        { tMs: SHOOT_LIVE_AT_MS + 4_000, bearingDeg: 55, distanceM: 15 },      // outside the 45° cone (9m hop)
        { tMs: SHOOT_LIVE_AT_MS + 15_000, bearingDeg: 55, distanceM: 45 },     // beyond 40m range (30m hop — needs ~23s)
      ],
    }],
    shoots: [
      { tMs: SHOOT_LIVE_AT_MS + 3_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: true },
      { tMs: SHOOT_LIVE_AT_MS + 14_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: false, expectedReason: 'outside_cone' },
      { tMs: SHOOT_LIVE_AT_MS + 42_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: false, expectedReason: 'out_of_range' },
    ],
    checkpoints: [],
  },
  {
    key: 'sniper_lateral_boundary',
    label: 'Sniper: Laterale Toleranz',
    subMode: 'deathmatch',
    testerClass: 'sniper',
    testerTeam: null,
    fieldSideM: SIM_FIELD_SIDE_SHOOT_M,
    durationMs: SHOOT_LIVE_AT_MS + 26_000,
    onHit: 'freeze',
    hitConfig: SHOOT_HIT_CONFIG,
    testerHeadingDeg: 0,
    bots: [{
      id: 'bot_sim1', username: 'SimTarget', class: 'scout', team: null,
      // Same >8s spacing rule as scout above — this one has TWO
      // consecutive expected hits, so both gaps need it.
      route: [
        { tMs: 0, bearingDeg: 0, distanceM: 30 },                                   // lateral 0m — dead ahead
        { tMs: SHOOT_LIVE_AT_MS + 8_000, bearingDeg: 2.87, distanceM: 30 },  // lateral ≈1.5m, within ≈2.68m tolerance
        { tMs: SHOOT_LIVE_AT_MS + 18_000, bearingDeg: 11.54, distanceM: 30 }, // lateral ≈6m, beyond tolerance
      ],
    }],
    shoots: [
      { tMs: SHOOT_LIVE_AT_MS + 3_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: true },
      { tMs: SHOOT_LIVE_AT_MS + 13_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: true },
      { tMs: SHOOT_LIVE_AT_MS + 23_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: false, expectedReason: 'outside_lateral' },
    ],
    checkpoints: [],
  },
  {
    key: 'bomber_omni_range',
    label: 'Bomber: Rundum-Reichweite',
    subMode: 'deathmatch',
    testerClass: 'bomber',
    testerTeam: null,
    fieldSideM: SIM_FIELD_SIDE_SHOOT_M,
    durationMs: SHOOT_LIVE_AT_MS + 16_000,
    onHit: 'freeze',
    hitConfig: SHOOT_HIT_CONFIG,
    testerHeadingDeg: 0,
    bots: [{
      id: 'bot_sim1', username: 'SimTarget', class: 'scout', team: null,
      route: [
        { tMs: 0, bearingDeg: 0, distanceM: 5 },                              // well within 10m omni range
        { tMs: SHOOT_LIVE_AT_MS + 8_000, bearingDeg: 0, distanceM: 15 },  // beyond 10m range
      ],
    }],
    shoots: [
      { tMs: SHOOT_LIVE_AT_MS + 3_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: true },
      { tMs: SHOOT_LIVE_AT_MS + 13_000, shooterId: 'tester', targetId: 'bot_sim1', expectedHit: false, expectedReason: 'out_of_range' },
    ],
    checkpoints: [],
  },
  {
    key: 'bot_returns_fire',
    label: 'Bot schießt zurück',
    subMode: 'deathmatch',
    testerClass: 'scout',
    testerTeam: null,
    fieldSideM: SIM_FIELD_SIDE_SHOOT_M,
    durationMs: SHOOT_LIVE_AT_MS + 9_000,
    onHit: 'freeze',
    hitConfig: SHOOT_HIT_CONFIG,
    testerHeadingDeg: 0,
    bots: [{
      id: 'bot_sim1', username: 'SimShooter', class: 'scout', team: null,
      // Stays put 15m from the tester, well inside its own 40m/45° cone
      // aimed back at the tester — the sim engine points a bot's shot
      // heading at its declared target automatically (see tickSimBots).
      route: [{ tMs: 0, bearingDeg: 0, distanceM: 15 }],
    }],
    shoots: [
      { tMs: SHOOT_LIVE_AT_MS + 3_000, shooterId: 'bot_sim1', targetId: 'tester', expectedHit: true },
    ],
    checkpoints: [],
  },
  {
    key: 'domination_capture',
    label: 'Domination: Zone erobern',
    subMode: 'domination',
    testerClass: 'scout',
    testerTeam: 'b',
    fieldSideM: SIM_FIELD_SIDE_OBJECTIVE_M,
    durationMs: 46_000, // ~35.7s warmup + ~3.3s captureDwellMs + margin
    onHit: 'freeze', // skips base_setup — domination has no base concept
    testerHeadingDeg: 0,
    zones: [
      { tMs: 0, bearingDeg: 90, distanceM: 12 },
      // 2nd zone is domination's minimum-zones requirement — nobody
      // interacts with it, only zone 0 is scripted. Opposite bearing and
      // far enough out to clear validateZones' minimum separation
      // ((r1+r2)*1.5 — comfortably >30m apart for two 10m-radius zones).
      { tMs: 0, bearingDeg: 270, distanceM: 25 },
    ],
    bots: [{
      id: 'bot_sim1', username: 'SimCapturer', class: 'scout', team: 'a',
      // Arrives well before 'live' starts (warmup ~35.7s) and sits in the
      // zone so the capture dwell begins the instant the phase goes live —
      // capture ticks don't run at all before 'live' (see MODES.domination).
      route: [
        { tMs: 0, bearingDeg: 90, distanceM: 25 },      // outside zone 0 (radius 10m, center 12m out)
        { tMs: 1_000, bearingDeg: 90, distanceM: 12 },  // walks into zone 0, then dwells
      ],
    }],
    shoots: [],
    checkpoints: [
      { tMs: 43_000, check: 'zoneOwner', targetIndex: 0, expected: 'a' },
    ],
  },
  {
    key: 'ctf_flag_run',
    label: 'CTF: Flagge holen & capturen',
    subMode: 'ctf',
    testerClass: 'scout',
    testerTeam: 'a',
    fieldSideM: SIM_FIELD_SIDE_OBJECTIVE_M,
    durationMs: 68_000,
    testerHeadingDeg: 0,
    bots: [{
      id: 'bot_sim1', username: 'SimRunner', class: 'scout', team: 'b',
      route: [
        // Sits at its intended "home" spot through all of base_setup (base
        // auto-places at the captain's position the instant base_setup
        // ends — see transitionFromBaseSetup) — the tester never moves
        // either, so team A's base auto-places at the origin.
        { tMs: 0, bearingDeg: 180, distanceM: 12 },
        // base_setup ~35.7s for this field size — margin, then walk to
        // steal team A's flag at the origin (flagPickupDwellMs ~2.5s once
        // there).
        { tMs: 38_000, bearingDeg: 0, distanceM: 0 },
        // Carries the flag home to capture (instant on arrival while
        // carrying, no extra dwell).
        { tMs: 51_000, bearingDeg: 180, distanceM: 12 },
      ],
    }],
    shoots: [],
    checkpoints: [
      { tMs: 64_000, check: 'flagCaptured', targetIndex: 0, expected: 'b' },
    ],
  },
  {
    key: 'bomb_plant_defuse',
    label: 'Bombe legen & entschärfen',
    subMode: 'seek_destroy',
    testerClass: 'scout',
    testerTeam: 'a',
    fieldSideM: SIM_FIELD_SIDE_OBJECTIVE_M,
    durationMs: 58_000,
    onHit: 'freeze', // skips base_setup — no base needed for the defuse variant
    destroyVariant: 'defuse',
    testerHeadingDeg: 0,
    zones: [{ tMs: 0, bearingDeg: 90, distanceM: 10 }],
    bots: [
      {
        id: 'bot_sim_atk', username: 'SimAttacker', class: 'scout', team: 'a',
        // Arrives well before 'live' starts (warmup ~35.7s) and sits in the
        // zone so arming (plantDwellMs ~4s) begins the instant 'live' does.
        route: [
          { tMs: 0, bearingDeg: 90, distanceM: 25 },
          { tMs: 1_000, bearingDeg: 90, distanceM: 10 },
        ],
      },
      {
        id: 'bot_sim_def', username: 'SimDefender', class: 'scout', team: 'b',
        // Only needs to reach the zone once the bomb is armed
        // (~35.7s warmup + ~4s plant ≈ 40s) — starts moving well after
        // that with margin. Same bearing/start as the attacker (harmless —
        // presence is tracked per-team, not exclusive) so the walk
        // distance is a simple straight 15m, same pace as everywhere else.
        route: [
          { tMs: 0, bearingDeg: 90, distanceM: 25 },
          { tMs: 41_000, bearingDeg: 90, distanceM: 10 },
        ],
      },
    ],
    shoots: [],
    checkpoints: [
      { tMs: 55_000, check: 'bombDefused', targetIndex: 0, expected: 'true' },
    ],
  },
];
