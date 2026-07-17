# AR Ops — Mobile App (Expo)

React-Native-Client für AR Ops. Spricht dasselbe Socket-Protokoll wie das Web
(`game:ar_tick`, `game:action`) und nutzt `@craftworks/arops-shared` für die
identische Hit-Geometrie.

## Setup

```bash
cd apps/arops-mobile
npm install
npx expo install --fix     # richtet alle Versionen exakt auf die Expo-SDK aus
npm run typecheck          # tsc --noEmit (muss grün sein)
npx expo start             # QR-Code mit Expo Go scannen
```

**Server-URL** in `src/config.ts` setzen — fürs lokale Testen die LAN-IP des
Servers (Handy und Server im selben WLAN), sonst `https://dev.srz.one`.

## Spielablauf (Feldtest)

1. **Host im Web**: AR-Ops-Lobby erstellen, Spielfeld auf der Karte zeichnen,
   Rollen zuweisen, Timer setzen.
2. **Spieler in der App**: Gast-Login (nur Name) → Lobby-Code eingeben → Bereit.
3. Host startet → App wechselt automatisch in den Game-Screen:
   Live-Karte, Phasen-Timer, Geofence-Warnungen, Proximity-Alert.
4. **Seeker**: 📸-Button → Kamera mit Fadenkreuz → Auslöser validiert rein
   geometrisch (GPS + Kompass). **Kein Foto wird gespeichert oder übertragen.**

## Eigene App bauen (Standalone)

**Karte:** MapLibre + OSM — kein Google-API-Key nötig (react-native-maps wurde ersetzt,
das hätte in Standalone-Builds auf Android einen Google-Cloud-Account gebraucht).

### Weg A: EAS Cloud-Build (empfohlen, kein Android SDK nötig)
```bash
npm install -g eas-cli
eas login                                  # kostenloser Expo-Account
cd apps/arops-mobile
eas build -p android --profile preview     # → installierbare APK, Link zum Download
```
Aufs Handy: Link öffnen, APK installieren, fertig — kein Metro, kein Expo Go.
**Monorepo-Hinweis:** Wegen `file:../../packages/arops-shared` muss der Build aus dem
Git-Repo heraus laufen (EAS lädt das Repo-Root hoch). Falls der Ordner kein Git-Repo
ist: einmal `git init && git add -A && git commit -m init` im `platform/`-Root.

iOS: `eas build -p ios --profile preview` — braucht einen Apple-Developer-Account (99 €/Jahr).

### Weg B: Lokaler Android-Build (Android Studio/SDK + JDK 17 nötig)
```bash
cd apps/arops-mobile
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

### Dev-Build (Entwicklung mit Live-Reload auf dem Gerät)
```bash
eas build -p android --profile development   # einmalig
npx expo start                               # dann wie gewohnt, App verbindet sich zu Metro
```

## Technische Hinweise

- **Expo Go funktioniert NICHT mehr** — MapLibre ist natives Modul, es braucht
  einen eigenen Build (siehe oben). Dafür: keine Google-Abhängigkeit, und
  Background-Location ist im Dev-Build später freischaltbar.
- **Kompass**: `trueHeading` mit Fallback auf `magHeading`. Vor dem Spiel das
  Handy in einer 8 kalibrieren, sonst zielt der Sichtkegel daneben.
- **Telemetrie**: 1 Hz an den Server; der Server ist autoritativ (Anti-Spoof,
  Cooldowns, Geofence-Strafen). Die App zeigt nur, was der Server pro Spieler
  freigibt — Gegnerpositionen erscheinen ausschließlich bei Exposure/Radar.
- Karte ist vollständig OSM (MapLibre) auf beiden Plattformen — identisches
  Verhalten iOS/Android, keine Vendor-Keys.

## Bekannte Grenzen (MVP)

- Kein Background-Tracking (Screen-Lock pausiert Telemetrie)
- Kein VPS/ARCore — Treffer-Toleranz hängt an GPS-Qualität (urban 5–15 m)
- Rollen/Areal nur im Web editierbar (App ist Join-only)
