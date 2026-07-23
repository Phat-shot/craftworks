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
    hitConfig?: {
        maxRangeM: number;
        baseConeHalfAngleDeg: number;
    };
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
    teamVariant?: 'team' | 'ffa';
    gameDurationMs?: number;
    hidingDurationMs?: number;
    targetScore?: number;
    targetCaptures?: number;
    livesPerPlayer?: number;
    destroyReactivate?: boolean;
    foundMode?: 'spectator' | 'seeker' | 'freeze';
    hsVariant?: 'classic' | 'ffa' | 'the_ship';
}
/** Square field corners (bearing+distance from the origin) for a given side length. */
export declare function squareFieldCorners(sideM: number): SimWaypoint[];
/** ~50 fixed, seeded-random short scenarios — see file header. Regenerating
 *  this (module load, once) is deliberately cheap and pure so both the
 *  server and the mobile client always agree on exactly the same list. */
export declare const SIM_SCENARIOS: SimScenario[];
