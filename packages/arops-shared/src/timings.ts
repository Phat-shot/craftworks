// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
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
  /** CTF phase 1: time to place the team base. */
  baseSettingMs: number;
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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Compute all mode timings from the playfield area. */
export function scaleTimings(areaM2: number): ModeTimings {
  const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
  return {
    zoneRadiusM:          clamp(L / 25, 12, 45),
    freezeMs:             clamp(((L / 2) / 1.4) * 1000, 30_000, 120_000),
    freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
    freezeExtensionMs:    clamp((((L / 2) / 1.4) * 1000) * 0.25, 10_000, 30_000),
    baseSettingMs:        clamp((L / 1.4) * 1000, 90_000, 300_000),
    flagPickupDwellMs:    clamp((L / 50) * 1000, 4_000, 15_000),
    flagReturnMs:         clamp(L * 200, 30_000, 90_000),
    minBaseSeparationM:   clamp(L * 0.5, 60, 600),
    captureDwellMs:       clamp((L / 40) * 1000, 5_000, 20_000),
    plantDwellMs:         clamp((L / 30) * 1000, 8_000, 20_000),
    defuseDwellMs:        clamp((L / 40) * 1000, 6_000, 15_000),
    bombTimerMs:          clamp(((L / 1.4) + 30) * 1200, 90_000, 300_000),
    revealTrapRadiusM:    clamp(L * 0.15, 15, 60),
    spawnCheckDwellMs:    clamp((L / 40) * 1000, 5_000, 15_000),
  };
}

/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
export function scaleDroneRangeM(areaM2: number): number {
  const L = Math.sqrt(Math.max(1, areaM2));
  return clamp(L * 0.4, 50, 200);
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
}

// A "medium" reference field (~50,000 m², L≈224m) roughly matching the
// fixed defaults these values replace (server/src/game/arops.js DEFAULTS) —
// cooldowns scale down from their reference value as the field grows past
// this, never up past it for a smaller field.
const REF_L_M = 224;

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
  const cooldown = (referenceMs: number) => clamp(referenceMs * (REF_L_M / L), 15_000, referenceMs);
  return {
    hidingDurationMs: clamp(((L / 2) / 1.4) * 1000, 45_000, 600_000),
    gameDurationMs:   clamp((L / 1.4) * 1000 * 2.5, 300_000, 3_600_000),
    hitRangeM:        clamp(L * 0.5, 20, 500),
    hitHalfWidthM:    clamp((L / REF_L_M) * 1, 0.5, 5),
    radarCooldownMs:        cooldown(15 * 60_000),
    droneCooldownMs:        cooldown(60_000),
    cloakCooldownMs:        cooldown(90_000),
    fakeMarkerCooldownMs:   cooldown(90_000),
    aufscheuchenCooldownMs: cooldown(45_000),
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
