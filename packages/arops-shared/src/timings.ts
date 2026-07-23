// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
//
//  Size categories: small = 20×20m (L=20, 400m², the platform minimum — see
//  DEFAULT_POLYGON_OPTIONS.minAreaM2 in types.ts), medium starts at 100×100m
//  (L=100), large starts at 1000×1000m (L=1000). Several values (see scale3()
//  below) are literally anchored to these 3 points: flat below 20m, linear
//  20→100m, linear 100→1000m, flat above 1000m. The rest remain smooth clamp()
//  functions of L tuned to land in a similar range at those same reference
//  points, without being formally anchored to them.
// ═══════════════════════════════════════════════════════════

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
  /** CTF: dwell time in enemy base / at dropped flag to pick it up. Always
   *  freezeMs/2. */
  flagPickupDwellMs: number;
  /** CTF: dropped flag auto-returns after this. */
  flagReturnMs: number;
  /** CTF: minimum distance between the two bases. */
  minBaseSeparationM: number;
  /** Domination: dwell to capture a zone. Always freezeMs/2. */
  captureDwellMs: number;
  /** S&D: dwell to plant. Always freezeMs/2. */
  plantDwellMs: number;
  /** S&D: dwell to defuse. Always freezeMs/2. */
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Piecewise-linear 3-anchor-point scale: flat floor below `sSmall`, linear
 * ramp small→medium, linear ramp medium→large, flat ceiling above `sLarge`.
 * Anchor field-length points are fixed platform-wide: 20m (small), 100m
 * (medium), 1000m (large) — see DEFAULT_POLYGON_OPTIONS.minAreaM2 (types.ts)
 * for the matching 20×20m minimum field size.
 */
const SMALL_L = 20, MEDIUM_L = 100, LARGE_L = 1000;
function scale3(L: number, atSmall: number, atMedium: number, atLarge: number): number {
  if (L <= SMALL_L) return atSmall;
  if (L <= MEDIUM_L) return atSmall + (atMedium - atSmall) * ((L - SMALL_L) / (MEDIUM_L - SMALL_L));
  if (L <= LARGE_L) return atMedium + (atLarge - atMedium) * ((L - MEDIUM_L) / (LARGE_L - MEDIUM_L));
  return atLarge;
}

/** Compute all mode timings from the playfield area. */
export function scaleTimings(areaM2: number): ModeTimings {
  const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
  // 3s @ 20m, 10s @ 100m, 30s @ 1000m+.
  const freezeMs = scale3(L, 3_000, 10_000, 30_000);
  // Every capture/plant/defuse/flag-pickup dwell is pinned to half the
  // freeze duration (host requirement) rather than its own independent
  // field-size formula — a target/flag should take exactly as long to
  // secure as half the punishment for getting caught doing it.
  const halfFreezeMs = freezeMs / 2;
  return {
    // ~L/8: small ≈10m (floor), medium ≈13m, large(L=200) ≈25m.
    zoneRadiusM:          clamp(L / 8, 10, 40),
    freezeMs,
    freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
    freezeExtensionMs:    clamp(L * 25, 1_000, 8_000),
    // Base-placement phase: 1min @ 20m, 2min @ 100m, 5min @ 1000m+.
    baseSettingMs:        scale3(L, 60_000, 120_000, 300_000),
    // Warmup phase: fixed 1 minute regardless of field size.
    warmupMs:             60_000,
    flagPickupDwellMs:    halfFreezeMs,
    // Small ≈15s, medium ≈30s, large(L=200) ≈60s.
    flagReturnMs:         clamp(L * 300, 10_000, 90_000),
    // Small ≈30m, medium ≈60m, large(L=200) ≈120m — the old 60m floor left
    // almost no room to place 2 bases at all on a small/medium field.
    minBaseSeparationM:   clamp(L * 0.6, 15, 500),
    captureDwellMs:       halfFreezeMs,
    plantDwellMs:         halfFreezeMs,
    defuseDwellMs:        halfFreezeMs,
    // Small ≈51s, medium ≈86s, large(L=200) ≈158s.
    bombTimerMs:          clamp(((L / 1.4) + 15) * 1000, 45_000, 240_000),
    // Small ≈10m, medium ≈20m, large(L=200) ≈40m.
    revealTrapRadiusM:    clamp(L * 0.2, 8, 60),
    spawnCheckDwellMs:    clamp((L / 20) * 1000, 3_000, 15_000),
  };
}

/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
export function scaleDroneRangeM(areaM2: number): number {
  const L = Math.sqrt(Math.max(1, areaM2));
  // Small ≈25m, medium ≈50m, large(L=200) ≈100m — the old L*0.4 floor of
  // 50m was already the WHOLE field on a small/medium field (near-useless
  // as a "nearby" signal, it'd fire almost constantly).
  return clamp(L * 0.5, 15, 200);
}

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
export function scaleCoreConfig(areaM2: number): CoreScaledConfig {
  const L = Math.sqrt(Math.max(1, areaM2));
  // Auto: 5min @ 20m, 15min @ 100m, 60min @ 1000m+. Manual override can go
  // up to 6h (see platform.js's ceiling on ar_settings.gameDurationMs) —
  // this auto-derived value is deliberately never that long.
  const gameDurationMs = scale3(L, 5 * 60_000, 15 * 60_000, 60 * 60_000);
  // Radar cooldown: 1min @ 20m, 5min @ 100m, 15min @ 1000m+ — every other
  // perk's cooldown is a fixed fraction of radar's (radar reveals positions
  // outright, so it's the rarest; every other perk is a cheaper signal).
  const radarCooldownMs = scale3(L, 60_000, 5 * 60_000, 15 * 60_000);
  const otherPerkCooldownMs = radarCooldownMs / 3;
  // One life per ~90s of match — bigger field naturally affords more lives
  // via its longer auto-derived match, not via its own separate area formula.
  const livesPerPlayer = clamp(Math.round(gameDurationMs / 90_000), 2, 6);
  return {
    // Hide & Seek's 'hiding' phase is structurally the same thing as
    // Domination/S&D/Deathmatch's base-less 'warmup' phase (see
    // ModeTimings.warmupMs in this same file) — a prep phase with nothing to
    // place, just a head start. Same rule applies: fixed 1 minute, never
    // field-size-scaled, not even in auto mode.
    hidingDurationMs: 60_000,
    gameDurationMs,
    // Scout's base range: 5m @ 20m, 20m @ 100m, 100m @ 1000m+ (other classes'
    // ranges derive from this via their own shotRangeMultiplier, see
    // profiles.ts's PLAYER_TYPE_PROFILES).
    hitRangeM:        scale3(L, 5, 20, 100),
    // Fixed, NOT field-size-scaled (unlike hitRangeM above) — matches the
    // Lobby's manual "Normal (2m)" preset (REF_DIST_M=10, halfWidthM=1)
    // regardless of field size.
    hitHalfWidthM:    1,
    radarCooldownMs,
    droneCooldownMs:        otherPerkCooldownMs,
    cloakCooldownMs:        otherPerkCooldownMs,
    fakeMarkerCooldownMs:   otherPerkCooldownMs,
    aufscheuchenCooldownMs: otherPerkCooldownMs,
    revealTrapCooldownMs:   otherPerkCooldownMs,
    // Perk effect duration (radar contacts visible, cloak active, etc.):
    // 5s @ 20m, 15s @ 100m, 30s @ 1000m+ — same anchor points as radar's
    // own cooldown above.
    perkDurationMs:   scale3(L, 5_000, 15_000, 30_000),
    livesPerPlayer,
  };
}

// ── Zones (bases, capture points, bomb sites) ───────────────
import { LatLon } from './types';
import { haversineMeters } from './geo';

export interface Zone {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export function isInZone(p: LatLon, z: Zone): boolean {
  return haversineMeters(p, { lat: z.lat, lon: z.lon }) <= z.radiusM;
}

/** Negative = inside (meters past the rim), positive = outside. */
export function distanceToZoneM(p: LatLon, z: Zone): number {
  return haversineMeters(p, { lat: z.lat, lon: z.lon }) - z.radiusM;
}

// ── Zone validation (host setup) ────────────────────────────
import { pointInPolygon } from './geo';

export type ZoneValidationError = 'outside_field' | 'zones_too_close' | 'too_many_zones';
export interface ZoneValidationResult { ok: boolean; errors: ZoneValidationError[]; }

/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * ≥ 1.5x combined radii (no overlapping trivial multi-caps).
 */
export function validateZones(
  zones: Zone[],
  polygon: LatLon[],
  maxZones = 8
): ZoneValidationResult {
  const errors: ZoneValidationError[] = [];
  if (zones.length > maxZones) errors.push('too_many_zones');
  for (const z of zones) {
    if (!pointInPolygon({ lat: z.lat, lon: z.lon }, polygon)) {
      errors.push('outside_field');
      break;
    }
  }
  outer:
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const minSep = (zones[i]!.radiusM + zones[j]!.radiusM) * 1.5;
      if (haversineMeters(zones[i]!, zones[j]!) < minSep) {
        errors.push('zones_too_close');
        break outer;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ── Random zone/target generation (host "random" toggle) ───────────────────
// A public, multi-point counterpart to server/src/game/arops.js's private,
// single-point `randomPointInPolygon` (used there only for fake-marker
// decoys and bot spawn — deliberately left untouched, its 2 call sites don't
// need pairwise separation). This one is for a different, new use case:
// hosts generating several well-separated random targets/zones at once
// (planned for the Zerstören mode rework and Domination's "random targets"
// toggle) — not wired into any mode yet, just the reusable primitive.
export function generateRandomZones(
  polygon: LatLon[],
  count: number,
  minSeparationM: number,
  radiusM: number,
  maxAttemptsPerZone = 30
): Zone[] {
  if (!polygon || polygon.length < 3 || count <= 0) return [];

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const v of polygon) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lon < minLon) minLon = v.lon;
    if (v.lon > maxLon) maxLon = v.lon;
  }

  const zones: Zone[] = [];
  for (let i = 0; i < count; i++) {
    let placed: LatLon | null = null;
    for (let attempt = 0; attempt < maxAttemptsPerZone; attempt++) {
      const cand: LatLon = {
        lat: minLat + Math.random() * (maxLat - minLat),
        lon: minLon + Math.random() * (maxLon - minLon),
      };
      if (!pointInPolygon(cand, polygon)) continue;
      if (zones.some(z => haversineMeters(cand, z) < minSeparationM)) continue;
      placed = cand;
      break;
    }
    // A field too small/crowded for the requested count+separation simply
    // yields fewer zones than asked — callers decide whether that's an
    // error (e.g. re-prompt the host) or an acceptable partial result.
    if (!placed) break;
    zones.push({ id: 'rz' + (i + 1), lat: placed.lat, lon: placed.lon, radiusM });
  }
  return zones;
}
