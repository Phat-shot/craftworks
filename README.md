# ⚔ GamePlatform

Multiplayer-Gaming-Plattform mit Chat, Freundesliste, Lobbys und Tower Defense.  
Node.js · React · PostgreSQL · Socket.io · Docker.

[![Build & Push](https://github.com/YOURNAME/YOURREPO/actions/workflows/build.yml/badge.svg)](https://github.com/YOURNAME/YOURREPO/actions)

---

## ✨ Features

| Feature | Details |
|---------|---------|
| **Auth** | Mail + Passwort, Gast-Login, E-Mail-Verifizierung, JWT Refresh |
| **Chat** | 1:1 DM, Gruppenchat, Tipp-Indikator, persistente History |
| **Freunde** | Folgen/Entfolgen (unidirektional), Online-Status |
| **Gruppen** | Erstellen, Code- oder QR-Einladung, Gruppenchat |
| **Lobbys** | Öffentlich & privat, QR-Einladung, Ready-System |
| **Spielmodi** | Klassisch · Turnier · Chaos |
| **Tower Defense** | 5 Towers, 3-Pfad-Upgrades, Luft-Waves, Boss-Waves, 5 Schwierigkeiten |
| **Multiplayer** | Parallele Instanzen + Echtzeit-Overlay |
| **Rangliste** | Pro Schwierigkeit, Best-Score pro Spieler |
| **DSGVO** | Impressum, Datenschutzerklärung, Consent-Log |
| **Sprachen** | Deutsch + Englisch |
| **APK** | Android via Capacitor WebView |

---

## 🚀 Schnellstart

### Lokal / LAN  *(baut das Image selbst)*

```bash
git clone https://github.com/YOURNAME/YOURREPO.git
cd YOURREPO

# Starten – kein .env nötig
docker compose -f docker-compose.local.yml up --build

# Öffnen
# Lokal:  http://localhost:4000
# LAN:    http://$(hostname -I | awk '{print $1}'):4000
```

---

### VPS / Cloud  *(nutzt das fertige Image von GitHub)*

Nach jedem Push auf `main` baut GitHub Actions automatisch ein Image und  
pushed es nach `ghcr.io/YOURNAME/YOURREPO:latest`.  
**Auf dem Server reicht es, nur `docker-compose.yml` + `.env` herunterzuladen:**

```bash
mkdir gameplatform && cd gameplatform

# Nur die zwei nötigen Dateien laden
curl -O https://raw.githubusercontent.com/YOURNAME/YOURREPO/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/YOURNAME/YOURREPO/main/.env.example
mv .env.example .env

# .env befüllen (siehe Abschnitt unten)
nano .env

# Starten
docker compose pull
docker compose up -d
```

**Updates einspielen** (nach Push auf `main`):
```bash
docker compose pull && docker compose up -d
```

---

## ⚙️ .env Konfiguration

```env
# Pflicht für Production
GITHUB_REPO=yourname/yourrepo        # GitHub-User/Repo-Name (für Image-URL)
POSTGRES_PASSWORD=sicheres_passwort
JWT_SECRET=                          # openssl rand -hex 64
JWT_REFRESH_SECRET=                  # openssl rand -hex 64  (anderer Wert!)
HASH_SALT=                           # openssl rand -hex 32
APP_URL=https://deine-domain.de
ALLOWED_ORIGINS=https://deine-domain.de

# Mail (Mailgun, Brevo, Gmail SMTP o.ä.)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mail@example.com
SMTP_PASS=dein_smtp_passwort
SMTP_FROM=GamePlatform <noreply@deine-domain.de>

# Optional
PORT=4000
IMAGE_TAG=latest
```

Secrets generieren:
```bash
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 64   # JWT_REFRESH_SECRET
openssl rand -hex 32   # HASH_SALT
```

---

## 🔒 HTTPS / Reverse Proxy  *(kein nginx in Docker)*

**Empfehlung: Caddy auf dem Host** (übernimmt SSL automatisch):
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

## 📱 Android APK

```bash
cd client
REACT_APP_API_URL=https://deine-domain.de npm run build

npm install @capacitor/cli @capacitor/core @capacitor/android
cp ../android/capacitor.config.json ./capacitor.config.json
# capacitor.config.json → server.url auf deine Domain setzen

npx cap add android
npx cap sync android

# Debug-APK
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

---

## 🏗 Architektur

```
┌──────────────────────────────────────┐
│           Docker Compose             │
│                                      │
│  ┌───────────┐   ┌────────────────┐  │
│  │ PostgreSQL│←──│  Node.js       │  │
│  │  :5432    │   │  Express       │  │
│  └───────────┘   │  Socket.io     │──┼──► :4000
│                  │                │  │
│                  │  React Build   │  │  (statisch ausgeliefert)
│                  │  td-game.html  │  │  (im Image enthalten)
│                  └────────────────┘  │
└──────────────────────────────────────┘
```

---

## 🎮 Spielmodi

| Modus | Verhalten |
|-------|-----------|
| **Klassisch** | Alle starten die nächste Wave, wenn alle die aktuelle abgeschlossen haben |
| **Turnier** | Jeder Spieler hat 15s nach seinem Wave-Ende, bevor die nächste Wave automatisch startet |
| **Chaos** | Waves starten automatisch — egal ob die vorherige noch läuft |

---

## 🔌 Wichtige WebSocket-Events

| Client → Server | Bedeutung |
|----------------|-----------|
| `chat:dm` | Direktnachricht |
| `lobby:ready` | Bereit-Toggle |
| `lobby:start` | Spiel starten (Host) |
| `game:state_update` | Wave/Lives/Score |
| `game:wave_finished` | Wave fertig |
| `game:died` | Spieler gestorben (Lives = 0) |
| `game:finished` | Alle Waves geschafft |

| Server → Client | Bedeutung |
|----------------|-----------|
| `game:wave_start` | Nächste Wave (Klassisch-Modus) |
| `game:player_update` | Mitspieler-Status |
| `game:over` | Spiel beendet + Ergebnis |

---

## 📂 Projektstruktur

```
.
├── .github/workflows/build.yml  GitHub Actions → ghcr.io
├── server/src/
│   ├── index.js                 Express + Socket.io
│   ├── socket.js                WebSocket-Handler
│   ├── middleware/auth.js        JWT
│   ├── routes/                  REST API
│   └── db/schema.sql            PostgreSQL Schema (auto-init)
├── client/src/
│   ├── App.jsx / App.css        React App + Dark Theme
│   ├── api.js                   Axios + Socket.io Client
│   ├── i18n/                    DE + EN
│   └── pages/                   Alle Seiten
├── android/capacitor.config.json
├── Dockerfile.server            Multi-Stage: React + Node
├── docker-compose.yml           Production (ghcr.io Image)
├── docker-compose.local.yml     Lokal/LAN (baut selbst)
├── .env.example
└── client/public/td-game.html   ← Spiel-Datei (im Repo, wird ins Image gebaut)
```

---

## 🛠 Repository erstmalig einrichten

```bash
cd platform
git init
git add .
git commit -m "feat: initial platform"

# GitHub → New repository anlegen
git remote add origin https://github.com/YOURNAME/YOURREPO.git
git push -u origin main

# → GitHub Actions startet den Build (~3 Min)
# → Image: ghcr.io/YOURNAME/YOURREPO:latest

# Image öffentlich machen (einmalig):
# github.com → YOURREPO → Packages → platform → Package settings → Make public
```

---

## 📋 DSGVO

`client/src/pages/Legal.jsx` — Platzhalter `[DEIN NAME]`, `[ADRESSE]`, `[E-MAIL]` vor dem Produktivbetrieb ersetzen.

---

## Lizenz

MIT
