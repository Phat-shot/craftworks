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
- `apps/arops-wear/` — natives Kotlin/Gradle Wear-OS-Companion (kein Expo/RN)
- `hardware/esp32-ir/` — IR-ID-Beacon (ESP32-S3, TSAL6100+AO3400A) für den "IR"-
  Trefferverfolgungsmodus: sendet autark (kein Handy-Tether nötig) dauerhaft die
  eigene 8-Bit-ID als Blinkmuster. Firmware, Pinbelegung, Flash-Anleitung (Android/
  iOS/Linux/Mac/Windows — iOS technisch nicht möglich, siehe `FLASHING.md`).
  Erkennung läuft über die Handy-KAMERA des Schützen (nicht USB!): natives
  VisionCamera-Frame-Processor-Plugin `apps/arops-mobile/modules/ir-scan-plugin`
  dekodiert das Blinkmuster live, `src/hooks/useIrScan.ts` liefert die erkannte ID
  ans GameScreen. Server validiert bei `hitTrackingMode='ir'` zusätzlich zur
  bestehenden Kompass/GPS-Kegel-Prüfung, dass die gescannte ID zur in der Lobby
  zugewiesenen ID (`ar_settings.irIds`) des Ziels passt und aktuell genug ist
  (`server/src/game/arops.js`, `IR_SCAN_MAX_AGE_MS`). `apps/arops-mobile/modules/
  esp-bridge` (natives Android-USB-Serial-Modul) + `useEspSync.ts` sind nur noch ein
  Werkbank-Testwerkzeug (PING-Kommando), kein Teil des Spielablaufs mehr
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
  "Wear OS APK Build" (`apps/arops-wear/`) unter `apk-wear-test`/`apk-wear-main`.
  **APK-Dateiname ist bewusst FEST, nicht versioniert**: `ar-ops-android.apk`/
  `ar-ops-android-beta.apk`, Wear-Pendant `ar-ops-wear.apk`/
  `ar-ops-wear-beta.apk` — ein Name im Dateinamen enthaltener Versions-Bump
  hätte `gh release upload --clobber` sonst nur exakt denselben alten
  Dateinamen ersetzen lassen, jeder neue Versionsstand wäre als
  zusätzliches Asset auf derselben Release liegengeblieben statt sie zu
  ersetzen — mit fixem Namen ersetzt jeder Build zuverlässig genau die eine
  Datei pro Branch, es gibt immer nur den neuesten Stand
- **Versionsschema**: kein von Hand gepflegter Versionsstring mehr (das
  alte Schema — `app.json` `"version"`/Wear-`versionName`, +1 pro
  main-Release, +0.1 pro test-Bugfix — driftete wiederholt aus dem Takt,
  weil das Hochzählen vor dem Push leicht vergessen wurde). Stattdessen
  treibt `BUILD_NUMBER` (`GITHUB_RUN_NUMBER`, von GitHub selbst garantiert
  monoton steigend, gesetzt in beiden APK-Workflows) sowohl
  `android.versionCode`/Wear-`versionCode` (macht Sideload-Updates über
  eine bestehende Installation hinweg erstmals korrekt möglich) als auch
  die In-App-Anzeige (Startmenü/Einstellungen bzw. Pairing-/Debug-Screen
  der Uhr, `apps/arops-mobile/src/config.ts`'s `BUILD_NUMBER` /
  Wear-`BuildConfig.VERSION_NAME`). Weiterhin zusätzlich die Kurz-Commit-SHA
  (`COMMIT_SHA` in beiden APK-Workflows, Plattform analog aus
  `server/src/VERSION`), da sie den exakten Quellstand eindeutig
  identifiziert. Beide Apps bekommen auf test zusätzlich App-Channel-
  Differenzierung (applicationId + Label mit "Beta"-Suffix, bei der
  Handy-App zusätzlich Icon-Badge), damit main- und test-Build gleichzeitig
  auf demselben Gerät installiert sein können

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
