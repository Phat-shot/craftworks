// ═══════════════════════════════════════════════════════════
//  AR OPS — Steckbriefe (Spielmodi + Spielertypen) + Glossar
//
//  Rein deklarative Beschreibung dessen, was server/src/game/arops.js's
//  MODES-Plugin-Tabelle und actionArUsePerk HEUTE tatsächlich tun — noch
//  KEINE Verhaltens-Quelle. Die eigentlichen Modi/Perks bleiben vorerst in
//  arops.js implementiert; dieses Modul ist das Fundament, aus dem sie
//  später abgeleitet werden sollen (siehe AR-Ops-Modi-Ausbau-Plan, Phase 1).
//
//  Umfang: alle sechs implementierten Modi (hide_and_seek/domination/ctf/
//  seek_destroy alias "Zerstören"/deathmatch/battle_royale), die drei
//  bestehenden Rollen (hider/seeker/team_member) und die drei Spielerklassen
//  (scout/sniper/bomber, additiv zu Rolle/Team — kein Ersatz). "The Ship"
//  ist KEIN eigener Modus, sondern eine Variante von hide_and_seek
//  (ar_settings.hsVariant='the_ship', siehe dessen submodes-Eintrag unten
//  und der zugehörige Kommentar in arops.js's MODES.hide_and_seek) — Battle
//  Royale dagegen bleibt ein eigener Modus (kein hide_and_seek-Submode),
//  siehe dessen eigener Kommentar in arops.js.
// ═══════════════════════════════════════════════════════════

/** Team-basiert (zwei Seiten gegeneinander) oder individuelle Rollen ohne
 *  Team-Zugehörigkeit. AR Ops hat aktuell keinen echten Solo-/PvE-Modus
 *  (GPS-Multiplayer-Spiel) — 'individual' deckt Hide & Seek ab, wo jeder
 *  Spieler eine eigene Rolle (Hider/Seeker) hat, aber kein Team. */
export type PartyMode = 'team' | 'individual';

/** Ein einzelner, host-konfigurierbarer Zahlenwert (oder Enum) eines Modus —
 *  spiegelt die tatsächlichen ar_settings-Felder aus createAropsGame
 *  (server/src/game/arops.js) wider, nicht mehr und nicht weniger. */
export interface GameModeParameter {
  /** ar_settings-Feldname (flach) bzw. ar_settings.timings-Feldname (verschachtelt). */
  key: string;
  name: string;
  description: string;
  /** Freitext-Einheit fürs UI, z.B. 'ms', 'm', 'Punkte', 'Treffer'. */
  unit: string;
}

/** Ein Sub-Modus/Variante innerhalb eines Spielmodus — heute für alle vier
 *  bestehenden Modi noch leer (siehe Datei-Kopfkommentar). */
export interface GameModeSubmode {
  id: string;
  name: string;
  shortDescription: string;
}

export interface GameModeProfile {
  /** Muss mit dem Key in server/src/game/arops.js's MODES-Tabelle übereinstimmen. */
  id: string;
  name: string;
  shortDescription: string;
  /** Längerer Fließtext für ein Detail-/Info-Screen — shortDescription bleibt
   *  die Kurzfassung für Tooltips/Karten. */
  longDescription: string;
  hasBases: boolean;
  hasTargets: boolean;
  partyMode: PartyMode;
  submodes: GameModeSubmode[];
  parameters: GameModeParameter[];
}

export const GAME_MODE_PROFILES: Record<string, GameModeProfile> = {
  hide_and_seek: {
    id: 'hide_and_seek',
    name: 'Hide & Seek',
    shortDescription:
      'Seeker fotografieren Hider im Aim-Kegel; gefundene Hider scheiden aus ' +
      '(oder wechseln die Seite, je nach Host-Einstellung "foundMode").',
    longDescription:
      'Ein Seeker jagt eine oder mehrere Hider innerhalb des Spielfelds. ' +
      'Zu Beginn läuft eine Versteckphase (hidingDurationMs), in der die ' +
      'Hider sich verteilen können, bevor die Suchphase startet und der ' +
      'Seeker aktiv schießen darf. Wird ein Hider getroffen, entscheidet ' +
      'die Host-Einstellung "foundMode" über sein Schicksal: standardmäßig ' +
      'scheidet er aus (spectator), alternativ wechselt er selbst zur ' +
      'Seeker-Seite. Überlebt mindestens ein Hider bis zum Zeitlimit, ' +
      'gewinnen die Hider mit einem Punktebonus. Perks sind rollengebunden: ' +
      'nur Hider haben Zugriff auf Drohne/Tarnung/Fake-Marker, nur der ' +
      'Seeker auf "Aufscheuchen" — der gemeinsame Radar-Perk steht beiden ' +
      'Seiten offen.',
    hasBases: false,
    hasTargets: true, // die Hider selbst sind die Ziele
    partyMode: 'individual',
    submodes: [
      { id: 'the_ship', name: 'The Ship',
        shortDescription:
          'Geheime Attentats-Kette statt Seeker/Hider-Rollen: jeder hat genau ein Ziel, ' +
          'niemand kennt seinen eigenen Jäger. Aktiviert über die Host-Einstellung "hsVariant".' },
    ],
    parameters: [
      { key: 'hidingDurationMs', name: 'Versteckzeit', unit: 'ms',
        description: 'Dauer der Versteckphase, bevor der Seeker aktiv suchen/schießen darf. Ohne Wirkung bei hsVariant "the_ship" (keine Versteckphase).' },
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
        description: 'Zeitlimit der Suchphase — läuft es ab, gewinnen die überlebenden Hider (bzw. bei "The Ship" der höhere Punktestand).' },
      { key: 'hitCooldownMs', name: 'Schuss-Cooldown', unit: 'ms',
        description: 'Mindestabstand zwischen zwei Schussversuchen desselben Spielers.' },
      { key: 'radarCooldownMs', name: 'Radar-Cooldown', unit: 'ms',
        description: 'Abklingzeit des gemeinsamen Radar-Perks (beide Rollen, nur klassische Variante).' },
      { key: 'droneCooldownMs', name: 'Drohnen-Cooldown', unit: 'ms',
        description: 'Abklingzeit von Hiders Drohnen-Perk (nur klassische Variante).' },
      { key: 'cloakCooldownMs', name: 'Tarnung-Cooldown', unit: 'ms', description: 'Abklingzeit von Hiders Tarnung (nur klassische Variante).' },
      { key: 'cloakDurationMs', name: 'Tarnung-Dauer', unit: 'ms', description: 'Wie lange die Tarnung aktiv bleibt (nur klassische Variante).' },
      { key: 'fakeMarkerCooldownMs', name: 'Fake-Marker-Cooldown', unit: 'ms',
        description: 'Abklingzeit von Hiders Fake-Marker-Perk (nur klassische Variante).' },
      { key: 'fakeMarkerDurationMs', name: 'Fake-Marker-Dauer', unit: 'ms',
        description: 'Wie lange die Fake-Marker auf dem Radar des Seekers erscheinen (nur klassische Variante).' },
      { key: 'aufscheuchenCooldownMs', name: 'Aufscheuchen-Cooldown', unit: 'ms',
        description: 'Abklingzeit von Seekers Aufscheuchen-Perk (nur klassische Variante).' },
      { key: 'aufscheuchenDurationMs', name: 'Aufscheuchen-Dauer', unit: 'ms',
        description: 'Wie lange alle Hider danach einen Näherungs-Alarm erhalten (nur klassische Variante).' },
      { key: 'foundMode', name: 'Schicksal bei Fund', unit: 'enum (spectator/seeker/freeze)',
        description: 'Was mit einem gefundenen Hider passiert (nur klassische Variante): ausscheiden, zur Seeker-Seite wechseln, oder einfrieren.' },
      { key: 'hsVariant', name: 'Variante', unit: 'enum (classic/the_ship)',
        description: 'Klassisches Seeker/Hider-Gameplay oder "The Ship" (geheime Attentats-Kette, siehe submodes).' },
    ],
  },
  domination: {
    id: 'domination',
    name: 'Domination',
    shortDescription:
      'Zwei Teams halten host-platzierte Zonen; Punkte pro Sekunde im Besitz, ' +
      'erstes Team zur Zielpunktzahl gewinnt.',
    longDescription:
      'Zwei Teams kämpfen um host-platzierte Zonen auf dem Spielfeld. Eine ' +
      'Zone ist neutral, bis ein Team sie eine gewisse Zeit lang ohne ' +
      'gegnerische Präsenz hält (captureDwellMs) — danach zählt sie für das ' +
      'haltende Team, das dafür laufend Punkte erhält. Zonen können vom ' +
      'Gegnerteam jederzeit zurückerobert werden, indem es dieselbe ' +
      'Einnahmezeit dort verbringt. Wer zuerst die Zielpunktzahl erreicht ' +
      'oder beim Zeitlimit vorne liegt, gewinnt. Treffer frieren Gegner ein ' +
      '(kein Ausscheiden) — eingefrorene Spieler zählen nicht für die ' +
      'Zonen-Präsenz.',
    hasBases: false,
    hasTargets: false, // Zonen/Territorium, kein Ziel im Schützen-Sinn
    partyMode: 'team',
    submodes: [],
    parameters: [
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms', description: 'Zeitlimit; danach gewinnt das führende Team.' },
      { key: 'targetScore', name: 'Zielpunktzahl', unit: 'Punkte', description: 'Punktestand, bei dem ein Team sofort gewinnt.' },
      { key: 'captureDwellMs', name: 'Einnahmezeit', unit: 'ms',
        description: 'Wie lange ein Team ungestört in einer Zone stehen muss, um sie einzunehmen (in ar_settings.timings).' },
      { key: 'zoneRadiusM', name: 'Zonenradius', unit: 'm', description: 'Radius jeder Zone, feldgrößen-skaliert (in ar_settings.timings).' },
      { key: 'freezeMs', name: 'Freeze-Dauer', unit: 'ms', description: 'Wie lange ein getroffener Spieler eingefroren bleibt (in ar_settings.timings).' },
    ],
  },
  ctf: {
    id: 'ctf',
    name: 'Capture the Flag',
    shortDescription:
      'Kapitäne platzieren zu Rundenbeginn eine Basis; Flagge aus der ' +
      'gegnerischen Basis stehlen und zur eigenen zurückbringen.',
    longDescription:
      'Zu Rundenbeginn platziert jeder Team-Kapitän die eigene Basis ' +
      '(baseSettingMs Zeitfenster — verstreicht es, fällt die Basis auf die ' +
      'aktuelle Kapitänsposition zurück). Danach spawnt in jeder Basis eine ' +
      'Flagge. Gegner müssen sich eine Weile in der fremden Basis aufhalten ' +
      '(flagPickupDwellMs), um die dortige Flagge zu stehlen, und sie dann ' +
      'unentdeckt in die eigene Basis zurücktragen, während die eigene ' +
      'Flagge dort verbleibt. Wird der Träger getroffen, fällt die Flagge an ' +
      'Ort und Stelle — das eigene Team bringt sie sofort zurück, das gegnerische ' +
      'Team kann sie sofort aufnehmen und weitertragen; bleibt sie zu lange ' +
      'liegen (flagReturnMs), kehrt sie automatisch zur Heimatbasis zurück. ' +
      'Erstes Team zur Ziel-Anzahl an Captures gewinnt.',
    hasBases: true,
    hasTargets: false,
    partyMode: 'team',
    submodes: [],
    parameters: [
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms', description: 'Zeitlimit; danach gewinnt das Team mit mehr Captures.' },
      { key: 'targetCaptures', name: 'Ziel-Captures', unit: 'Captures', description: 'Anzahl an Flaggen-Captures für den Sofortsieg.' },
      { key: 'baseSettingMs', name: 'Basis-Setup-Zeit', unit: 'ms',
        description: 'Zeitfenster für die Kapitäne, ihre Basis zu platzieren (in ar_settings.timings).' },
      { key: 'flagPickupDwellMs', name: 'Flaggen-Diebstahlzeit', unit: 'ms',
        description: 'Wie lange ein Gegner ungestört in der fremden Basis stehen muss, um die Flagge zu stehlen (in ar_settings.timings).' },
      { key: 'flagReturnMs', name: 'Auto-Rückkehrzeit', unit: 'ms',
        description: 'Nach dieser Zeit kehrt eine liegengelassene Flagge von selbst zur Basis zurück (in ar_settings.timings).' },
      { key: 'minBaseSeparationM', name: 'Mindestabstand der Basen', unit: 'm',
        description: 'Mindestabstand zwischen den beiden Team-Basen (in ar_settings.timings).' },
    ],
  },
  // Code-Id bewusst 'seek_destroy' geblieben (ersetzt den alten Einzel-
  // Bombenplatz-Modus an derselben Stelle, siehe AR-Ops-Modi-Ausbau-Plan) —
  // Name/Beschreibung/Parameter spiegeln jetzt "Zerstören", nicht mehr das
  // alte Seek-&-Destroy.
  seek_destroy: {
    id: 'seek_destroy',
    name: 'Zerstören',
    shortDescription:
      'Ein rotierendes Ziel ist aktiv; wird es eingenommen, ist es zerstört und ' +
      'das nächste aktiviert. Symmetrisch (beide Teams) oder mit Entschärfen (asymmetrisch).',
    longDescription:
      'Von den host-platzierten oder zufällig generierten Zielen ist immer genau ' +
      'eines aktiv. Je nach Host-Einstellung "destroyVariant": "instant" (Standard) ' +
      '— beide Teams können das aktive Ziel durch ungestörtes Verweilen einnehmen ' +
      '(captureDwellMs), wer zuerst fertig ist, zerstört es und punktet; oder ' +
      '"defuse" — nur Team a kann das Ziel scharf machen (plantDwellMs), danach ' +
      'läuft ein Timer (doppelte Pflanzzeit) bis zur Zerstörung, Team b kann in ' +
      'dieser Zeit entschärfen (defuseDwellMs) — das rettet das Ziel, es bleibt ' +
      'aktiv und kann erneut scharf gemacht werden, statt zerstört zu sein. Sobald ' +
      'ein Ziel zerstört ist, aktiviert sich automatisch das nächste. Sind alle ' +
      'zerstört, endet das Match sofort (Sieg fürs zuletzt zerstörende Team) — es ' +
      'sei denn, "destroyReactivate" ist an: dann setzen sich alle Ziele zurück und ' +
      'der Zyklus läuft bis zum Zeitlimit weiter (dort entscheidet der Punktestand).',
    hasBases: false,
    hasTargets: true,
    partyMode: 'team',
    submodes: [],
    parameters: [
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
        description: 'Zeitlimit; danach gewinnt der höhere Punktestand (Gleichstand = Unentschieden).' },
      { key: 'destroyVariant', name: 'Zerstören-Variante', unit: 'enum (instant/defuse)',
        description: 'Ob beide Teams symmetrisch einnehmen können, oder nur Team a scharf macht und Team b entschärfen kann.' },
      { key: 'destroyReactivate', name: 'Ziele reaktivieren', unit: 'boolean',
        description: 'Ob zerstörte Ziele nach einer vollen Runde zurückgesetzt werden, statt das Match sofort zu beenden.' },
      { key: 'captureDwellMs', name: 'Einnahmezeit (instant)', unit: 'ms',
        description: 'Wie lange ein Team ungestört am Ziel stehen muss, um es einzunehmen (in ar_settings.timings).' },
      { key: 'plantDwellMs', name: 'Scharfmachzeit (defuse)', unit: 'ms',
        description: 'Wie lange Team a ungestört am Ziel stehen muss, um es scharf zu machen (in ar_settings.timings).' },
      { key: 'defuseDwellMs', name: 'Entschärfzeit (defuse)', unit: 'ms',
        description: 'Wie lange Team b ungestört am Ziel stehen muss, um es zu entschärfen (in ar_settings.timings).' },
    ],
  },
  deathmatch: {
    id: 'deathmatch',
    name: 'Deathmatch',
    shortDescription:
      'Zwei Teams kämpfen ohne weiteres Ziel gegeneinander. Treffer frieren ein oder ' +
      'kosten ein Leben (host-konfigurierbar) — bei 0 Leben scheidet man aus.',
    longDescription:
      'Wie Domination/CTF beginnt Deathmatch mit einer Basis-Setup-Phase (Kapitän ' +
      'platziert die Team-Basis). Danach entscheidet die Host-Einstellung ' +
      '"deathmatchOnHit" über die Treffer-Konsequenz: "freeze" (Standard-Team-Freeze, ' +
      'keine Leben verloren, Sieg nach Zeitlimit über den Punktestand) oder "respawn" ' +
      '(Getroffene verlieren ein Leben und werden "downed" — sie können erst wieder ' +
      'mitspielen, nachdem sie eine Weile ununterbrochen in der eigenen Basis gestanden ' +
      'haben, siehe das Base/Respawn-Checkpoint-System. Bei 0 Leben scheidet man endgültig ' +
      'aus; verliert ein Team alle Spieler, gewinnt das andere sofort, sonst entscheidet ' +
      'bei Zeitlimit die Summe der verbleibenden Leben).',
    hasBases: true,
    hasTargets: false,
    partyMode: 'team',
    submodes: [],
    parameters: [
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
        description: 'Zeitlimit; danach gewinnt je nach Modus-Variante das Team mit mehr Punkten oder mehr verbleibenden Leben.' },
      { key: 'deathmatchOnHit', name: 'Treffer-Konsequenz', unit: 'enum (freeze/respawn)',
        description: 'Ob ein Treffer nur einfriert (kein Leben verloren) oder ein Leben kostet und "downed" macht.' },
      { key: 'livesPerPlayer', name: 'Leben pro Spieler', unit: 'Leben',
        description: 'Nur bei Treffer-Konsequenz "respawn": Anzahl Leben, bevor ein Spieler endgültig ausscheidet.' },
      { key: 'baseSettingMs', name: 'Basis-Setup-Zeit', unit: 'ms',
        description: 'Zeitfenster für die Kapitäne, ihre Basis zu platzieren (in ar_settings.timings).' },
      { key: 'spawnCheckDwellMs', name: 'Spawn-Verweildauer', unit: 'ms',
        description: 'Wie lange ein "downed" Spieler ununterbrochen in der eigenen Basis stehen muss, um wieder mitzuspielen (in ar_settings.timings).' },
    ],
  },
  battle_royale: {
    id: 'battle_royale',
    name: 'Battle Royale',
    shortDescription:
      'Jeder gegen jeden, keine Teams. Ein Treffer scheidet endgültig aus — letzter ' +
      'Überlebender gewinnt.',
    longDescription:
      'Kein Team, keine Rolle, keine Basis: jeder Spieler ist Gegner jedes anderen. ' +
      'Ein Treffer scheidet den Getroffenen sofort und endgültig aus dem Match aus ' +
      '(anders als Deathmatch — kein Einfrieren, kein Wiederbeleben). Sobald nur noch ' +
      'ein Spieler übrig ist, gewinnt dieser sofort. Läuft die Zeit ab, gewinnt der ' +
      'Spieler mit dem höchsten Punktestand (Gleichstand = Unentschieden). Dasselbe ' +
      'Konzept wie Hide & Seeks "Jeder gegen jeden"-Variante — beide nutzen denselben ' +
      'Modus.',
    hasBases: false,
    hasTargets: false,
    partyMode: 'individual',
    submodes: [],
    parameters: [
      { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
        description: 'Zeitlimit; danach gewinnt der Spieler mit dem höchsten Punktestand.' },
      { key: 'hitCooldownMs', name: 'Schuss-Cooldown', unit: 'ms',
        description: 'Mindestabstand zwischen zwei Schussversuchen desselben Spielers.' },
    ],
  },
};

/**
 * Schusskegel-Kategorie eines Spielertyps — bewusst symbolische Label, keine
 * exakten Grad-/Meterwerte (die stehen weiterhin numerisch in HitConfig,
 * siehe types.ts). Beispielwerte laut Anfrage: enge Reichweite (~2m),
 * Schrotkegel (~45°), Rundum (360°), durch Gebäude (ignoriert Deckung).
 *
 * 'melee_2m' wird von Sniper wiederverwendet, um eine enge LATERALE
 * Toleranz (distanzunabhängig, siehe validateHitLateral in hit.ts) zu
 * beschreiben, nicht Nahkampf — der Name bleibt aus der ursprünglichen
 * Spec, die Bedeutung ist klassenabhängig.
 */
export type ShotWidth = 'melee_2m' | 'shotgun_45deg' | 'omni_360deg' | 'through_walls';

export interface PlayerTypeProfile {
  /** Für hider/seeker/team_member: der `role`-Wert in arops.js. Für
   *  scout/sniper/bomber: der `class`-Wert in ar_settings.classes — gilt
   *  ZUSÄTZLICH zu Rolle/Team, nicht anstelle (ein Hider kann z.B.
   *  gleichzeitig Sniper sein). */
  id: string;
  name: string;
  shortDescription: string;
  /** Relativ zu HitConfig.maxRangeM, 1.0 = Basiswert. 0 = kann nicht
   *  schießen (z.B. Hider — canShoot() in arops.js lehnt role !== 'seeker' ab). */
  shotRangeMultiplier: number;
  shotWidth: ShotWidth;
  /** Perk-IDs aus actionArUsePerk (arops.js) — leer = kein exklusiver Perk. */
  uniquePerks: string[];
}

export const PLAYER_TYPE_PROFILES: Record<string, PlayerTypeProfile> = {
  hider: {
    id: 'hider',
    name: 'Hider',
    shortDescription:
      'Versteckt sich vor den Seekern, kann selbst nicht schießen. ' +
      'Exklusiver Zugriff auf Drohne, Tarnung und Fake-Marker (nur Hide & Seek).',
    shotRangeMultiplier: 0,
    shotWidth: 'melee_2m', // Platzhalter, nicht relevant solange rangeMultiplier 0 ist
    uniquePerks: ['drone', 'cloak', 'fake_marker'],
  },
  seeker: {
    id: 'seeker',
    name: 'Seeker',
    shortDescription:
      'Einzige Rolle, die in Hide & Seek schießen darf. ' +
      'Exklusiver Zugriff auf "Aufscheuchen" (nur Hide & Seek).',
    shotRangeMultiplier: 1.0,
    shotWidth: 'shotgun_45deg',
    uniquePerks: ['aufscheuchen'],
  },
  team_member: {
    id: 'team_member',
    name: 'Team-Spieler (Domination / CTF / Seek & Destroy)',
    shortDescription:
      'Symmetrische Rolle in allen Team-Modi — beide Teams nutzen dieselben ' +
      'Schusswerte, keine rollenspezifischen Perks (nur der gemeinsame Radar-Perk).',
    shotRangeMultiplier: 1.0,
    shotWidth: 'shotgun_45deg',
    uniquePerks: [],
  },
  // ── Spielerklassen — zusätzlich zu Rolle/Team, in jedem Modus wählbar ──
  scout: {
    id: 'scout',
    name: 'Scout',
    shortDescription:
      'Normale Schussreichweite, breiter Schusskegel. Exklusiver Perk: ' +
      'Reveal-Trap (platzierbare Falle, deckt nahende Gegner auf).',
    shotRangeMultiplier: 1.0,
    shotWidth: 'shotgun_45deg', // ~4x Sniper's Kegelbreite, siehe hit.ts-Kommentar
    uniquePerks: ['reveal_trap'],
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper',
    shortDescription:
      'Doppelte Schussreichweite, aber enge laterale Toleranz (~2m, ' +
      'distanzunabhängig statt Kegel). Exklusiver Perk: Fake Decoy ' +
      '(wiederverwendet Hiders Fake-Marker-Mechanik, hier klassengebunden ' +
      'statt rollengebunden, in jedem Modus nutzbar).',
    shotRangeMultiplier: 2.0,
    shotWidth: 'melee_2m', // siehe Typ-Kommentar oben: hier = laterale Toleranz, nicht Nahkampf
    uniquePerks: ['fake_marker'],
  },
  bomber: {
    id: 'bomber',
    name: 'Bomber',
    shortDescription:
      'Nur ein Viertel Schussreichweite, dafür 360° rundum statt Zielkegel ' +
      '— keine Zielrichtung nötig. Exklusiver Perk: Stealth (wiederverwendet ' +
      'Hiders Tarnung-Mechanik, hier klassengebunden statt rollengebunden, ' +
      'in jedem Modus nutzbar).',
    shotRangeMultiplier: 0.25,
    shotWidth: 'omni_360deg',
    uniquePerks: ['cloak'],
  },
};

/** Ein einzelner Glossar-Eintrag: Fachbegriff + einfache Erklärung, für ein
 *  künftiges In-App-Glossar (Web-Lobby + Mobile App). Reine Daten, keine
 *  Logik. */
export interface GlossaryEntry {
  term: string;
  definition: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: 'Freeze', definition:
    'Ein getroffener Spieler kann sich für eine gewisse Zeit nicht bewegen, schießen, capturen, tragen oder pflanzen. ' +
    'Wer sich trotzdem zu weit bewegt (über die Toleranz hinaus), verlängert seinen eigenen Freeze.' },
  { term: 'Exposed', definition:
    'Ein Spieler, der die Kulisse (Geofence) zu lange verlassen hat, wird für Gegner auf der Karte sichtbar — ' +
    'so lange, bis er wieder ins Feld zurückkehrt.' },
  { term: 'Geofence', definition:
    'Die unsichtbare Grenze des Spielfelds (das vom Host gezeichnete Polygon). Wer sie verlässt, bekommt zunächst eine ' +
    'Vorwarnung, danach zählt die Zeit außerhalb bis zur Exposed-Sichtbarkeit bzw. automatischem Ausscheiden.' },
  { term: 'Zone', definition:
    'Ein host-platzierter Bereich auf der Karte (z.B. Domination-Kontrollpunkt oder Seek&Destroy-Zielort), den Spieler ' +
    'durch Verweilen einnehmen/nutzen können.' },
  { term: 'Base', definition:
    'Der Heimatbereich eines Teams (z.B. in Capture the Flag) — Ausgangspunkt für die eigene Flagge/Basis-Mechaniken.' },
  { term: 'Target', definition:
    'Das jeweilige Ziel eines Modus — in Hide & Seek die Hider selbst, in Zerstören der aktive Zielort, ' +
    'in The Ship die geheim zugewiesene Person, die man jagen muss.' },
  { term: 'Captain', definition:
    'Der erste einem Team zugeloste Spieler — in Capture the Flag verantwortlich für die Basis-Platzierung zu Rundenbeginn.' },
  { term: 'Cloak (Tarnung)', definition:
    'Perk, der einen Spieler für eine begrenzte Zeit unsichtbar für gegnerisches Radar macht.' },
  { term: 'Drohne', definition:
    'Perk (nur Hider in Hide & Seek): meldet, ob ein Seeker innerhalb eines bestimmten Radius ist — ohne dessen genaue Position zu verraten.' },
  { term: 'Fake-Marker', definition:
    'Perk (nur Hider in Hide & Seek): erzeugt Lockvogel-Positionen, die für eine Weile ununterscheidbar von echten Radar-Kontakten erscheinen.' },
  { term: 'Aufscheuchen', definition:
    'Perk (nur Seeker in Hide & Seek): löst bei allen Hidern einen Näherungs-Alarm aus, unabhängig von der tatsächlichen Entfernung zum Seeker.' },
  { term: 'Radar', definition:
    'Gemeinsamer Perk (alle Rollen/Modi): zeigt kurzzeitig die Positionen aktiver Gegner an, mit eigenem Cooldown.' },
  { term: 'Auto-Skalierung', definition:
    'Alle Zeiten/Reichweiten passen sich automatisch an die Größe des gezeichneten Spielfelds an, statt feste Werte zu nutzen — ' +
    'per Host-Einstellung abschaltbar zugunsten manueller Werte.' },
  { term: 'Aim-Kegel / Hitbox', definition:
    'Der Bereich, in dem ein Ziel als getroffen gilt: normalerweise ein Kegel um die Blickrichtung, bei manchen Spielerklassen ' +
    'stattdessen eine feste seitliche Toleranz oder 360° rundum.' },
  { term: 'Spawn / Respawn', definition:
    'Der Ort, an dem ein Spieler ins Spiel einsteigt bzw. nach einem Ausscheiden zurückkehrt — Teil einer künftigen ' +
    'Erweiterung für Modi mit eigener Basis, noch nicht in jedem Modus verfügbar.' },
];
