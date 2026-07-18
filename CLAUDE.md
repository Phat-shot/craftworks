# Craftworks Platform + AR Ops

Full-Stack-Gaming-Plattform (Node/Express/Socket.io/PostgreSQL/React/Docker) mit
AR Ops: einem GPS+Kompass-basierten Outdoor-Spiel (Hide&Seek, Domination, CTF,
Seek&Destroy) mit Web-Lobby und React-Native-App (Expo).

## Verzeichnisse

- `server/` — Express + Socket.io + Game-Worker (Threads). AR-Engine: `server/src/game/arops.js`
- `client/` — React/Vite Web-Client. AR-Lobby: `src/components/AropsLobbyPanel.jsx`,
  Debug-Harness: `public/ar-game.html`
- `packages/arops-shared/` — Pure-TS-Geometrie (Hit-Validierung, Geofence, Zonen,
  Timing-Skalierung). **Single Source of Truth für Spielgeometrie** — Server und App
  rechnen mit identischem Code. `dist/` ist committet (Server/Docker braucht es)
- `apps/arops-mobile/` — Expo-App (SDK 52, MapLibre). Nutzt das Shared Package als
  **vendored Tarball** (`vendor/arops-shared.tgz`) — NICHT als file:-Link
- `.github/workflows/` — CI: Docker-Image pro Branch + APK-Build

## Branch-Regeln (WICHTIG)

- **Alle Arbeit auf `test`.** Nach jeder abgeschlossenen Aufgabe: Tests grün → commit → push
- **Nie direkt auf `main` pushen.** Merge `test` → `main` nur auf explizite Anweisung
  ("deploy prod" o. ä.): `git checkout main && git merge test && git push && git checkout test`
- Push auf `test` baut `ghcr.io/phat-shot/craftworks:test`, Push auf `main` baut `:latest`

## Pflicht-Checks vor jedem Commit

```bash
# Shared-Package-Tests (61+)
cd packages/arops-shared && npm test

# Server: H&S-Lifecycle (29) + Modi Dom/CTF/S&D/Freeze (26)
node server/test/arops_lifecycle.test.js
node server/test/arops_modes.test.js

# Syntax aller Server-Kernfiles
node --check server/src/socket.js && node --check server/src/game/arops.js && node --check server/src/game/worker.js

# App: Typecheck + Bundle-Probe (fängt Metro-Auflösungsfehler vor dem CI-APK-Build)
cd apps/arops-mobile && npx tsc --noEmit
CI=1 npx expo export:embed --eager --platform android --dev false
```

## Wenn `packages/arops-shared` geändert wurde

Der App-Tarball muss neu gepackt werden, sonst baut die App mit altem Stand:
```bash
cd apps/arops-mobile && npm run sync-shared
```
(kompiliert TS, packt `vendor/arops-shared.tgz` neu, installiert)

## Deployment

- **Test-Server**: `docker pull ghcr.io/phat-shot/craftworks:test` und als eigener
  Container auf eigenem Port laufen lassen (eigene DATABASE_URL verwenden, nie die Prod-DB!),
  Endpoint `https://dev.srz.one`
- **Prod**: `:latest` nach Merge auf main, Endpoint `https://arops.srz.one`
- **App-Backend-Endpoint ist ein Build-Time-Env-Var** (`SERVER_URL`, ausgewertet in
  `apps/arops-mobile/app.config.js` → `expo-constants`, siehe `src/config.ts`) —
  gesetzt vom Branch im GitHub-Workflow "APK Build" (test → dev.srz.one,
  main → arops.srz.one). Nie hart im Code für einen Channel überschreiben
- **APK**: baut automatisch bei Push auf `main` (immer) bzw. `test` (nur bei
  Änderungen an der jeweiligen App) — Workflow "APK Build", analog zu
  "Build & Push Docker Image" — kein EAS, kein Kontingent, kein
  `EXPO_TOKEN`-Secret nötig. **Download als GitHub-Release-Asset** (nicht
  Actions-Artifact — das ist immer gezippt und läuft ohne CDN, spürbar
  langsamer): fester Tag pro Branch, `apk-android-test`/`apk-android-main`
  unter github.com/phat-shot/craftworks/releases, wird bei jedem Build
  überschrieben statt neue Releases anzuhäufen. Wear-OS-Companion analog über
  "Wear OS APK Build" (`apps/arops-wear/`) unter `apk-wear-test`/`apk-wear-main`
- **Versionsschema**: `apps/arops-mobile/app.json` `"version"` ist die Quelle für den
  APK-Dateinamen (`ar-ops-android-beta-v<Version>.apk`, Wear-Pendant
  `ar-ops-wear-beta-v<Version>.apk` aus `apps/arops-wear/app/build.gradle.kts`
  `versionName`). Jedes Release (Merge auf main) **+1**, jeder Bugfix auf test
  **+0.1** — von Hand vor dem Build hochzählen, beide Apps zusammen

## Architektur-Invarianten (nicht brechen)

1. **Privacy**: AR-Snapshots sind pro Spieler (`getAropsSnapshot(gs, userId)`).
   Gegner-Positionen NIE ausliefern außer: exposed (Geofence), Radar, Flag-Carrier,
   Teammates. Near-Miss-Feedback nie mit Richtung (Anti-Triangulation)
2. **Server ist autoritativ**: Hits, Zonen, Freeze, Timings — Clients zeigen nur an.
   Rollen/Team-Defaults kommen als `effective` vom Server (Clients raten nicht)
3. **Kein Foto verlässt je das Gerät** — der Kamera-Trigger sendet nur Telemetrie
4. **H&S-Tests müssen nach jedem Engine-Umbau unverändert grün bleiben** (Regression-Anker)
5. Alle Gameplay-Timings skalieren mit der Feldgröße (`scaleTimings`), Overrides via
   `ar_settings.timings` (so testen die Testdateien mit Millisekunden-Timings)
6. Kein `node_modules`, kein `apps/*/android|ios` in Git. `packages/arops-shared/dist`
   und `apps/arops-mobile/vendor/*.tgz` MÜSSEN committet sein

## Bekannte Stolperfallen

- Lobby-Codes: `nanoid(8).toUpperCase()` — enthalten auch `-` und `_`
- Access-Tokens: 15 min TTL; App refresht via `tryRefresh()` in `src/api.ts`
- MapLibre-`MapView` niemals in ein ScrollView packen (Android frisst Taps)
- `expo export:embed` lokal ausführen = exakte Simulation des Bundle-Schritts,
  den `expo prebuild` + `gradlew assembleRelease` im CI-Workflow durchlaufen
- Fish-Shell beim User: keine Heredocs in Anleitungen
