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
    hitConfig?: {
        maxRangeM: number;
        baseConeHalfAngleDeg: number;
    };
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
export declare function squareFieldCorners(sideM: number): SimWaypoint[];
export declare const SIM_FIELD_SIDE_SHOOT_M = 80;
export declare const SIM_FIELD_SIDE_OBJECTIVE_M = 50;
export declare const SIM_SNIPPETS: SimSnippet[];
