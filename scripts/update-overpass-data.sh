#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
#  Refreshes the self-hosted Overpass API instance's DACH (Germany+
#  Austria+Switzerland) OpenStreetMap data — the comic map's real-data
#  source (see server/src/game/comic_map.js, CLAUDE.md's deployment
#  section). Deliberately a periodic FULL reimport, not a live diff feed
#  (no OVERPASS_DIFF_URL anywhere in this setup) — decorative map data
#  doesn't need to be fresher than this script's own run cadence.
#
#  Recommended cadence: monthly, via cron/systemd timer, e.g.:
#    0 3 1 * *  cd /path/to/craftworks && ./scripts/update-overpass-data.sh
#
#  Usage: ./scripts/update-overpass-data.sh [compose-file]
#    compose-file defaults to docker-compose.yml (prod). Pass
#    docker-compose.local.yml for the local/LAN stack instead.
#
#  Downloads a fresh extract, verifies its checksum, then only touches
#  the running overpass container/volume once the new file is confirmed
#  good — a failed/corrupt download never tears down the currently
#  working instance.
# ═══════════════════════════════════════════════════════════
set -euo pipefail

COMPOSE_FILE="${1:-docker-compose.yml}"
EXTRACT_DIR="./data/osm-extract"
EXTRACT_NAME="dach-latest.osm.pbf"
BASE_URL="https://download.geofabrik.de/europe"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "error: $COMPOSE_FILE not found — run this from the repo root" >&2
  exit 1
fi

mkdir -p "$EXTRACT_DIR"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> Downloading $EXTRACT_NAME + checksum from Geofabrik..."
curl -fL --progress-bar -o "$TMP_DIR/$EXTRACT_NAME" "$BASE_URL/$EXTRACT_NAME"
curl -fL -o "$TMP_DIR/$EXTRACT_NAME.md5" "$BASE_URL/$EXTRACT_NAME.md5"

echo "==> Verifying checksum..."
( cd "$TMP_DIR" && md5sum -c "$EXTRACT_NAME.md5" )

echo "==> Checksum OK. Replacing extract and reimporting..."
mv "$TMP_DIR/$EXTRACT_NAME" "$EXTRACT_DIR/$EXTRACT_NAME"

# Stop the container before touching its DB volume — Overpass rebuilds its
# whole database from OVERPASS_PLANET_URL on every fresh start once /db is
# empty (same first-start behavior as the very first import).
docker compose -f "$COMPOSE_FILE" stop overpass
docker compose -f "$COMPOSE_FILE" run --rm --no-deps --entrypoint sh overpass \
  -c 'rm -rf /db/* /db/.* 2>/dev/null || true'
docker compose -f "$COMPOSE_FILE" up -d overpass

echo "==> Done. overpass is reimporting from the fresh extract in the background —"
echo "    comic-map generation falls back to the procedural generator until it's ready."
