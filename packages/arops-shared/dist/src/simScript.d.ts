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
    check: 'zoneOwner';
    /** Zone index (0-based) within the scenario's own zones array. */
    targetIndex: number;
    /** Expected owning team ('a'|'b'). */
    expected: string;
}
export interface SimScenario {
    key: string;
    label: string;
    subMode: 'deathmatch' | 'domination';
    testerClass: SimClass;
    /** Only set where it matters (domination — a bot needs the tester on a
     *  different team, or default alternation could put them on the SAME
     *  team, since the tester is always the first non-bot player). Omitted
     *  for deathmatch scenarios, where team assignment never affects the
     *  outcome (only opponent-vs-opponent, and there's exactly one bot). */
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
    /** Zone center offsets from the origin (domination only). Domination
     *  needs at least 2 — the 2nd is a far-away, uninteracted-with filler to
     *  satisfy that minimum, same convention the original hand-written
     *  domination snippet used. */
    zones?: SimWaypoint[];
    bots: SimBotScript[];
    testerHeadingDeg: number;
    shoots: SimShootBeat[];
    checkpoints: SimCheckpoint[];
}
/** Square field corners (bearing+distance from the origin) for a given side length. */
export declare function squareFieldCorners(sideM: number): SimWaypoint[];
/** ~50 fixed, seeded-random short scenarios — see file header. Regenerating
 *  this (module load, once) is deliberately cheap and pure so both the
 *  server and the mobile client always agree on exactly the same list. */
export declare const SIM_SCENARIOS: SimScenario[];
