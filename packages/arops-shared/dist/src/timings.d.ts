export interface ModeTimings {
    /** Radius of bases / capture zones / bomb sites. */
    zoneRadiusM: number;
    /** Freeze after being hit (team modes). */
    freezeMs: number;
    /** Moving further than this from the freeze anchor extends the freeze. */
    freezeMoveToleranceM: number;
    /** Extension applied per movement violation. */
    freezeExtensionMs: number;
    /** Base-placement phase (CTF always; Domination/S&D/Deathmatch when
     *  cfg.onHit === 'respawn'): time to place the team base. Field-size-scaled. */
    baseSettingMs: number;
    /** Warmup phase (Domination/S&D/Deathmatch when cfg.onHit === 'freeze' —
     *  no base to place). Deliberately FIXED, never field-size-scaled, not even
     *  in auto mode — a plain "get ready" pause doesn't need more time just
     *  because the field is bigger. */
    warmupMs: number;
    /** CTF: dwell time in enemy base / at dropped flag to pick it up. */
    flagPickupDwellMs: number;
    /** CTF: dropped flag auto-returns after this. */
    flagReturnMs: number;
    /** CTF: minimum distance between the two bases. */
    minBaseSeparationM: number;
    /** Domination: dwell to capture a zone. */
    captureDwellMs: number;
    /** S&D: dwell to plant. */
    plantDwellMs: number;
    /** S&D: dwell to defuse. */
    defuseDwellMs: number;
    /** S&D: time from plant to detonation. */
    bombTimerMs: number;
    /** Scout's Reveal-Trap perk: radius within which an opponent triggers the
     *  trap and gets revealed to its owner. Field-size-scaled like every other
     *  spatial value here — a hardcoded constant would silently misbehave on
     *  field sizes other than whatever it was tuned against. */
    revealTrapRadiusM: number;
    /** Base/respawn checkpoint (any mode with team bases): continuous dwell
     *  time inside one's own base needed to spawn in — either catching up
     *  after missing the phase-1-end muster, or the phase-2-start revive
     *  window. Same field-size-scaling rationale as every other dwell here. */
    spawnCheckDwellMs: number;
}
/** Compute all mode timings from the playfield area. */
export declare function scaleTimings(areaM2: number): ModeTimings;
/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
export declare function scaleDroneRangeM(areaM2: number): number;
export interface CoreScaledConfig {
    hidingDurationMs: number;
    gameDurationMs: number;
    hitRangeM: number;
    /** Half-width in meters at a 10m reference distance — same convention the
     *  Lobby's manual "Breite" presets use (see LobbyScreen.tsx REF_DIST_M),
     *  so auto and manual modes speak the same units. */
    hitHalfWidthM: number;
    radarCooldownMs: number;
    droneCooldownMs: number;
    cloakCooldownMs: number;
    fakeMarkerCooldownMs: number;
    aufscheuchenCooldownMs: number;
    /** Scout class perk (any mode) — previously not auto-scaled at all (stuck
     *  at the fixed DEFAULTS value regardless of field/match size). */
    revealTrapCooldownMs: number;
    /** How long a perk's effect/reveal actually lasts once triggered (radar
     *  contacts staying visible, cloak active, fake marker shown, etc.) — same
     *  scale3 anchor points as radarCooldownMs, shared by every perk that has
     *  a duration. Previously fixed, non-field-scaled constants per perk. */
    perkDurationMs: number;
    /** Combat modes' respawn variant (cfg.onHit === 'respawn'): lives before
     *  elimination. Longer matches can afford more lives before someone's
     *  permanently out — previously not auto-scaled at all (stuck at the
     *  fixed DEFAULTS value of 3 regardless of match length). */
    livesPerPlayer: number;
}
/**
 * "Auto" mode: derive hiding/game duration, shot range, and perk cooldowns
 * straight from the playfield size — an alternative to the host manually
 * picking presets, useful now that field area has no upper limit (see
 * DEFAULT_POLYGON_OPTIONS.maxAreaM2). Same L = sqrt(areaM2), ~1.4 m/s
 * walking-speed philosophy as scaleTimings() above. First-pass numbers, not
 * tuned by real playtesting yet — expect to revisit the exact constants.
 */
export declare function scaleCoreConfig(areaM2: number): CoreScaledConfig;
import { LatLon } from './types';
export interface Zone {
    id: string;
    lat: number;
    lon: number;
    radiusM: number;
}
export declare function isInZone(p: LatLon, z: Zone): boolean;
/** Negative = inside (meters past the rim), positive = outside. */
export declare function distanceToZoneM(p: LatLon, z: Zone): number;
export type ZoneValidationError = 'outside_field' | 'zones_too_close' | 'too_many_zones';
export interface ZoneValidationResult {
    ok: boolean;
    errors: ZoneValidationError[];
}
/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * ≥ 1.5x combined radii (no overlapping trivial multi-caps).
 */
export declare function validateZones(zones: Zone[], polygon: LatLon[], maxZones?: number): ZoneValidationResult;
export declare function generateRandomZones(polygon: LatLon[], count: number, minSeparationM: number, radiusM: number, maxAttemptsPerZone?: number): Zone[];
