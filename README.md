# ⚔ Craftworks

Multiplayer-Gaming-Plattform mit zwei eigenständigen Spielen obendrauf:
**AR Ops** (GPS+Kompass-Outdoor-Hide&Seek) und **RTS "Spirale"** (Maze-Building-
Wettrennen, 2D + echtes 3D via Three.js). Node.js · Express · Socket.io ·
PostgreSQL · React/Vite · React Native/Expo · Docker.

---

## Inhalt

- [Plattform](#-plattform) — Account, Chat, Freunde, Gruppen, Lobbys, Workshop, Brands
- [Gamemodi](#-gamemodi)
  - [AR Ops](#ar-ops)
  - [RTS „Spirale“](#rts-spirale)
- [App](#-app-arops-mobile) — die native AR-Ops-App
- [Schnellstart](#-schnellstart)
- [.env Konfiguration](#️-env-konfiguration)
- [Projektstruktur](#-projektstruktur)
- [Deployment](#-deployment)

---

## 🧱 Plattform

Der Server (`server/`) ist eine klassische Express-API + Socket.io-Schicht,
die beide Spiele trägt. Kein ORM — rohes SQL über `pg`, ein einziges
idempotentes Schema (`server/src/db/schema.sql`), das beim Boot automatisch
angewendet wird (Tabellen anlegen bzw. `ADD COLUMN IF NOT EXISTS` nachziehen).

| Bereich | Details |
|---------|---------|
| **Auth** | E-Mail+Passwort (bcrypt), Gast-Login, JWT Access (15 min) + Refresh (30 Tage, DB-gestützt), optionale E-Mail-Verifizierung |
| **Chat** | 1:1 DM + Gruppenchat, Tipp-Indikator, persistente History, Unread-Counts |
| **Freunde** | Folgen/Entfolgen (unidirektional), Fuzzy-Suche (`pg_trgm`), Online-Status |
| **Gruppen** | Erstellen, Code-/QR-Einladung, Gruppenchat |
| **Lobbys** | Öffentlich & privat, QR-Einladung, Ready-System — gemeinsame Lobby-Maschinerie für beide Spiele |
| **Workshop** | User-Generated-Content-Editor: eigene Maps, Towers/Buildings, Units, Races, Abilities, Wave-Sets — mit Galerie, Bewertung, Export |
| **Brands** | White-Label-Feature für Organisationen: eigene Logo-Assets, gebrandete Maps, „Challenges“ mit Leaderboard und Token-Einreichung |
| **DSGVO** | Impressum/Datenschutz-Seite (`client/src/pages/Legal.jsx`), Consent-Log in der DB |
| **Sprachen** | Deutsch + Englisch (i18next, inline Ressourcen) |
| **Echtzeit** | Ein Socket.io-Server, zwei Namespaces an Verantwortung: `socket/index.js` (Plattform: Chat/Lobby/Gruppen) und `socket.js` (Spiel-Sessions, pro Session ein Worker-Thread via `game_manager.js`) |

**Bekannte offene Punkte auf Plattform-Ebene** (siehe [Offene Ideen](#offene-ideen--ausblick)
weiter unten für den vollständigen Review):
`/api/legal`-Endpunkte sind Stubs ohne echten Inhalt, die `Legal.jsx`-Platzhalter
(`[DEIN NAME]` etc.) müssen vor Produktivbetrieb ausgefüllt werden, ein
Password-Reset-Flow ist in der DB vorbereitet (`password_resets`-Tabelle) aber
nirgends verdrahtet, und CI baut nur das Docker-Image — es laufen keine Tests
oder Linting automatisiert.

---

## 🎮 Gamemodi

### AR Ops

GPS+Kompass-basiertes Outdoor-Spiel mit vier Modi: **Hide & Seek, Domination,
CTF, Seek & Destroy**. Läuft als eigene Engine (`server/src/game/arops.js`,
im Haupt-Thread statt Worker-Thread) mit einer separaten, geteilten
Geometrie-Bibliothek (`packages/arops-shared`) — Server und die native App
rechnen mit exakt demselben Code (Hit-Validierung, Geofence, Zonen-Timing).

- **Server-autoritativ**: Hits, Zonen, Freeze, Timings — Clients zeigen nur an
- **Privacy-by-design**: Snapshots sind pro Spieler; Gegner-Positionen werden nie
  ausgeliefert außer bei Exposed (Geofence-Verstoß), Radar-Perk, Flag-Carrier
  oder Teammates — Near-Miss-Feedback nie mit Richtungsangabe (Anti-Triangulation)
- **Kein Foto verlässt je das Gerät** — der Kamera-Trigger sendet nur Telemetrie
- **Perks**: Drohne (Gegner-Nähe für Hider), Cloak, Fake-Marker, Aufscheuchen,
  einstellbares Found-Fate (Zuschauer oder Weiterspielen als Seeker)
- **Debug-Modus**: Bots (spielen exakt denselben Telemetrie-Pfad wie echte
  Spieler), Solo-Testing ohne zweiten Spieler, Live-Overlay mit Distanz/
  Schusskegel pro Gegner — host-only, nie Default, hebt die Privacy-Regel
  ausschließlich für diese Sessions auf
- **Comic-Karte**: aus echten OpenStreetMap-Daten (Overpass API) generierte,
  comicartige Kartendarstellung des realen Spielfelds — kein Foto, keine
  Satellitendaten, aber ein greifbares Abbild der echten Umgebung
- Testabdeckung: 92 Tests (29 Lifecycle + 45 Modi + 18 Comic-Map), laufen bei
  jedem relevanten Umbau als Regressionsanker (`server/test/arops_*.test.js`)

### RTS „Spirale“

Kein klassisches Tower Defense — ein **Maze-Building-Wettrennen**: Jeder
Spieler bekommt sein eigenes privates Grid (35×50 bzw. 64×36 bei „Spirale 3D“).
In der Platzierungsphase setzen Spieler pro Runde einfache 2×2-Blöcke (Wand,
Verlangsamung, Stacheln, Mine, Frost, Wurzeln — je nach Rasse), die einen per
Dijkstra berechneten Pfad verformen. Sobald alle bereit sind (oder ein Timer
abläuft), läuft ein einzelnes „Minion“ pro Spieler den Pfad ab — Zeit zählt,
Punkte nach Platzierung (10/3/1 für 1./2./3.). 10 Runden pro Match.

- **„3D“ ist echtes 3D**: `client/public/ta-game-3d.html` ist eine eigenständige
  Seite außerhalb der React-App, rendert mit Three.js r128 (CDN, kein
  React-Three-Fiber) über WebGL. Die 2D-Variante läuft auf Canvas
  (`ta-game.html`)
- **Rassen** (`data/races.js`): standard/orcs/techies/elemente/urwald — jede
  mappt auf eine der sechs Blocktypen
- Architektur: alle Modi (`td` klassisch, `vs` Generals-artiges Basisbauen,
  `ta` = Spirale, `pve`) laufen über dieselbe `game_manager.js`/Worker-Thread-
  Maschinerie und dieselbe 1723-Zeilen-`engine.js` — `ta.js`/`td.js`/`vs.js`
  sind nur dünne Re-Export-Shims um die eine Engine-Datei
- Es gibt zusätzlich einen vollwertigen **Generals-Fraktions-Modus** (`vs`,
  `data/factions.js`): USA/China/GLA mit Gebäuden, Einheiten, Builder-Units —
  strukturell unabhängig von Spirale, aber Teil derselben Engine
- **Reifegrad**: 0 automatisierte Tests, Git-Historie zeigt einen einzelnen
  gesquashten Commit für Engine/Towers/Factions/Maps (statt iterativer
  Einzel-Commits wie bei AR Ops) — dieser Modus wird aktuell nicht aktiv
  weiterentwickelt

---

## 📱 App (`arops-mobile`)

Native React-Native/Expo-App (SDK 52, MapLibre) — **nur für AR Ops**, das
RTS-Spiel bleibt Web-only (`ta-game.html`/`ta-game-3d.html` im Browser).

- Nutzt `packages/arops-shared` als **vendored Tarball**
  (`vendor/arops-shared.tgz`), nie als `file:`-Link, damit die App unabhängig
  vom Server-Repo gebaut werden kann
- 4 View-Modi im laufenden Match: Comic-Karte (kompassorientiert), Kamera,
  Split, Overlay (Kamera+Comic)
- Icon-Fonts (`@expo/vector-icons`) werden über das `expo-font`-Config-Plugin
  **nativ vorgelinkt** statt zur Laufzeit nachgeladen — vermeidet einen
  bekannten Hänger von `expo-font` unter React Natives New Architecture
- Build: `npx eas-cli@latest build -p android --profile preview`, oder
  GitHub-Workflow „APK Build“ manuell triggern (Secret `EXPO_TOKEN`)

---

## 🚀 Schnellstart

```bash
git clone https://github.com/Phat-shot/craftworks.git
cd craftworks

# Lokal/LAN — baut das Image selbst, kein .env nötig
docker compose -f docker-compose.local.yml up --build

# Öffnen
# Lokal:  http://localhost:4000
# LAN:    http://$(hostname -I | awk '{print $1}'):4000
```

Production nutzt das per CI gebaute Image (`ghcr.io/phat-shot/craftworks`):

```bash
mkdir craftworks-deploy && cd craftworks-deploy
curl -O https://raw.githubusercontent.com/Phat-shot/craftworks/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/Phat-shot/craftworks/main/.env.example
mv .env.example .env
nano .env   # siehe unten

docker compose pull
docker compose up -d
```

**Updates einspielen**: `docker compose pull && docker compose up -d --force-recreate`
(`pull` allein aktualisiert nur den lokalen Image-Cache, der laufende
Container wird nicht automatisch neu erstellt).

---

## ⚙️ .env Konfiguration

```env
# Pflicht für Production
GITHUB_REPO=phat-shot/craftworks
POSTGRES_PASSWORD=sicheres_passwort
JWT_SECRET=                          # openssl rand -hex 64
JWT_REFRESH_SECRET=                  # openssl rand -hex 64  (anderer Wert!)
HASH_SALT=                           # openssl rand -hex 32
APP_URL=https://deine-domain.de
ALLOWED_ORIGINS=https://deine-domain.de

# Mail (optional — ohne SMTP wird E-Mail-Verifizierung automatisch übersprungen)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mail@example.com
SMTP_PASS=dein_smtp_passwort
SMTP_FROM=Craftworks <noreply@deine-domain.de>

# Optional
PORT=4000
IMAGE_TAG=latest   # oder "test" für den Test-Server
```

Secrets generieren:
```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 64   # JWT_REFRESH_SECRET
openssl rand -hex 32   # HASH_SALT
```

---

## 🔒 HTTPS / Reverse Proxy *(kein nginx in Docker)*

Empfehlung: Caddy auf dem Host (übernimmt SSL automatisch):

```bash
sudo apt install caddy
# /etc/caddy/Caddyfile
deine-domain.de {
    reverse_proxy localhost:4000
}
sudo systemctl reload caddy
```

Oder nginx auf dem Host:
```nginx
server {
    listen 443 ssl;
    server_name deine-domain.de;
    location / {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
    }
}
```

---

## 📂 Projektstruktur

```
.
├── .github/workflows/
│   ├── docker.yml               Docker-Image pro Branch (test/main) → ghcr.io
│   └── apk.yml                  Manueller EAS-APK-Build (arops-mobile)
├── server/src/
│   ├── index.js                 Express-Bootstrap + Auto-Migration
│   ├── socket.js                Spiel-Sessions (RTS-Modi + Comic-Map-Bridge)
│   ├── socket/index.js           Plattform-Socket (Chat/Lobby/Gruppen)
│   ├── middleware/auth.js        JWT
│   ├── routes/                  REST API (auth, users, chat, groups, lobbies,
│   │                             games, legal, brands, workshop*)
│   ├── game/
│   │   ├── arops.js             AR-Ops-Engine (Haupt-Thread)
│   │   ├── comic_map.js         Overpass-API-Anbindung für die Comic-Karte
│   │   ├── engine.js            RTS-Engine (td/vs/ta/pve, ein File)
│   │   ├── towers.js            Tower-/Block-Definitionen
│   │   ├── data/factions.js     Generals-Fraktionen (USA/China/GLA)
│   │   ├── data/races.js        Spirale-Rassen
│   │   ├── data/maps.js         Built-in-Maps (u.a. Spirale, Spirale 3D)
│   │   ├── game_manager.js      Worker-Thread pro Session (RTS-Modi)
│   │   └── worker.js
│   └── db/schema.sql            PostgreSQL-Schema (auto-init)
├── server/test/
│   ├── arops_lifecycle.test.js  29 Tests
│   ├── arops_modes.test.js      45 Tests
│   └── comic_map.test.js        18 Tests
├── client/src/
│   ├── pages/                   Login, Home, Chat, Friends, Lobby, Workshop,
│   │                             Brands, MapSelect, Legal, …
│   └── i18n/                    DE + EN
├── client/public/
│   ├── ta-game.html             RTS „Spirale“, Canvas 2D
│   ├── ta-game-3d.html          RTS „Spirale 3D“, Three.js/WebGL
│   └── ar-game.html             AR-Ops-Debug-Harness
├── packages/arops-shared/       Geteilte Geometrie (Server + App), dist/ committed
├── apps/arops-mobile/           Expo-App für AR Ops (SDK 52, MapLibre)
├── Dockerfile.server            Multi-Stage: Vite-Client-Build → Node 20-Alpine
├── docker-compose.yml           Production (ghcr.io-Image)
└── docker-compose.local.yml     Lokal/LAN (baut selbst)
```

---

## 🛠 Deployment

- **Test-Server**: `docker pull ghcr.io/phat-shot/craftworks:test`, eigener
  Container auf eigenem Port, eigene `DATABASE_URL` (nie die Prod-DB!)
- **Prod** (dev.srz.one): `:latest`-Image nach Merge `test` → `main`
- **APK**: `cd apps/arops-mobile && npx eas-cli@latest build -p android --profile preview`
- Push auf `test`/`main` baut nur das Image — Deploy (Container neu ziehen,
  APK bauen) sind jeweils separate, manuelle Schritte

---

## Lizenz

MIT
