# @craftworks/arops-shared

Shared core for **AR Ops**: geo math, hit validation, geofence logic.
Pure TypeScript, **zero runtime dependencies** — runs identically in the
Node server and the React Native app. The hit verdict MUST be computed
with this package on both sides (app = instant feedback, server = authoritative).

## Build & Test

```bash
npm install
npm test        # tsc + node --test (47 tests)
```

## API Overview

### Hit validation (`hit.ts`)
```ts
validateHit(attempt: HitAttempt, cfg?: HitConfig): HitVerdict
hitToleranceDeg(distanceM, accuracySumM, cfg?): number
```
Checks, in order: compass present → time skew ≤ 3s → distance ≤ 75m →
target inside aiming cone → confidence ≥ 0.35. The cone widens with
combined GPS inaccuracy relative to distance (`base 10° + atan(accSum/dist)`,
capped at 40°). Verdict includes diagnostics (`distanceM`, `angleDeltaDeg`,
`toleranceDeg`, `confidence`) for UI and tuning.

**No image ever leaves the device** — hits are validated purely from telemetry.

### Geo primitives (`geo.ts`)
`haversineMeters`, `bearingDeg`, `angleDeltaDeg` (wraparound-aware),
`destinationPoint`, `pointInPolygon`, `polygonAreaM2`,
`distanceToPolygonEdgeM`, `isSelfIntersecting`.
Polygon math uses a local planar projection — accurate for playfields up to a few km.

### Geofence (`geofence.ts`)
```ts
validatePolygon(polygon, opts?)   // min points, area 2k–3M m², self-intersection
geofenceStatus(point, polygon, warnDistanceM?)  // inside | warning | outside + signed distance
isMovementPlausible(prev, next, cfg?)           // anti-spoof building block (≤12 m/s sustained)
```

### Types (`types.ts`)
`TelemetrySample` (the 1–4 Hz position packet), `HitAttempt`, `HitVerdict`,
`HitConfig` + defaults, geofence types.

## Design decisions

- **Timestamps are device-side capture times**, not receive times. The server
  matches the shooter's trigger snapshot against the nearest-in-time target sample.
- Angular comparisons always via `angleDeltaDeg` (359.9° ≡ −0.1°).
- Boundary of a polygon counts as *inside* (fair for players standing on the line).
- Confidence weights (0.6 angular / 0.25 freshness / 0.15 GPS quality) are a
  starting point — tune with field-test data.
