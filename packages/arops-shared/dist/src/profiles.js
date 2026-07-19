"use strict";
// ═══════════════════════════════════════════════════════════
//  AR OPS — Steckbriefe (Spielmodi + Spielertypen) + Glossar
//
//  Rein deklarative Beschreibung dessen, was server/src/game/arops.js's
//  MODES-Plugin-Tabelle und actionArUsePerk HEUTE tatsächlich tun — noch
//  KEINE Verhaltens-Quelle. Die eigentlichen Modi/Perks bleiben vorerst in
//  arops.js implementiert; dieses Modul ist das Fundament, aus dem sie
//  später abgeleitet werden sollen (siehe AR-Ops-Modi-Ausbau-Plan, Phase 1).
//
//  Umfang bewusst auf den HEUTIGEN Implementierungsstand begrenzt: die vier
//  bestehenden Modi (hide_and_seek/domination/ctf/seek_destroy) und die drei
//  bestehenden Rollen (hider/seeker/team_member) plus die drei neuen
//  Spielerklassen (scout/sniper/bomber, additiv zu Rolle/Team — kein Ersatz).
//  Deathmatch, "The Ship" und Zerstören (die geplante seek_destroy-Ablösung
//  mit rotierenden Zielen) kommen erst mit ihrer jeweiligen Umsetzungsphase
//  dazu — `submodes` ist deshalb für alle vier bestehenden Modi noch leer,
//  keiner von ihnen hat heute echte Varianten.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.GLOSSARY = exports.PLAYER_TYPE_PROFILES = exports.GAME_MODE_PROFILES = void 0;
exports.GAME_MODE_PROFILES = {
    hide_and_seek: {
        id: 'hide_and_seek',
        name: 'Hide & Seek',
        shortDescription: 'Seeker fotografieren Hider im Aim-Kegel; gefundene Hider scheiden aus ' +
            '(oder wechseln die Seite, je nach Host-Einstellung "foundMode").',
        longDescription: 'Ein Seeker jagt eine oder mehrere Hider innerhalb des Spielfelds. ' +
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
        submodes: [],
        parameters: [
            { key: 'hidingDurationMs', name: 'Versteckzeit', unit: 'ms',
                description: 'Dauer der Versteckphase, bevor der Seeker aktiv suchen/schießen darf.' },
            { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
                description: 'Zeitlimit der Suchphase — läuft es ab, gewinnen die überlebenden Hider.' },
            { key: 'hitCooldownMs', name: 'Schuss-Cooldown', unit: 'ms',
                description: 'Mindestabstand zwischen zwei Schussversuchen desselben Spielers.' },
            { key: 'radarCooldownMs', name: 'Radar-Cooldown', unit: 'ms',
                description: 'Abklingzeit des gemeinsamen Radar-Perks (beide Rollen).' },
            { key: 'droneCooldownMs', name: 'Drohnen-Cooldown', unit: 'ms',
                description: 'Abklingzeit von Hiders Drohnen-Perk.' },
            { key: 'cloakCooldownMs', name: 'Tarnung-Cooldown', unit: 'ms', description: 'Abklingzeit von Hiders Tarnung.' },
            { key: 'cloakDurationMs', name: 'Tarnung-Dauer', unit: 'ms', description: 'Wie lange die Tarnung aktiv bleibt.' },
            { key: 'fakeMarkerCooldownMs', name: 'Fake-Marker-Cooldown', unit: 'ms',
                description: 'Abklingzeit von Hiders Fake-Marker-Perk.' },
            { key: 'fakeMarkerDurationMs', name: 'Fake-Marker-Dauer', unit: 'ms',
                description: 'Wie lange die Fake-Marker auf dem Radar des Seekers erscheinen.' },
            { key: 'aufscheuchenCooldownMs', name: 'Aufscheuchen-Cooldown', unit: 'ms',
                description: 'Abklingzeit von Seekers Aufscheuchen-Perk.' },
            { key: 'aufscheuchenDurationMs', name: 'Aufscheuchen-Dauer', unit: 'ms',
                description: 'Wie lange alle Hider danach einen Näherungs-Alarm erhalten.' },
            { key: 'foundMode', name: 'Schicksal bei Fund', unit: 'enum (spectator/seeker)',
                description: 'Was mit einem gefundenen Hider passiert: ausscheiden oder zur Seeker-Seite wechseln.' },
        ],
    },
    domination: {
        id: 'domination',
        name: 'Domination',
        shortDescription: 'Zwei Teams halten host-platzierte Zonen; Punkte pro Sekunde im Besitz, ' +
            'erstes Team zur Zielpunktzahl gewinnt.',
        longDescription: 'Zwei Teams kämpfen um host-platzierte Zonen auf dem Spielfeld. Eine ' +
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
        shortDescription: 'Kapitäne platzieren zu Rundenbeginn eine Basis; Flagge aus der ' +
            'gegnerischen Basis stehlen und zur eigenen zurückbringen.',
        longDescription: 'Zu Rundenbeginn platziert jeder Team-Kapitän die eigene Basis ' +
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
    seek_destroy: {
        id: 'seek_destroy',
        name: 'Seek & Destroy',
        shortDescription: 'Angreifer (Team a) platzieren an einem Zielort eine Bombe, ' +
            'Verteidiger (Team b) müssen sie vor der Explosion entschärfen.',
        longDescription: 'Angreifer (Team a) müssen an einem der host-platzierten Zielorte eine ' +
            'Zeit lang ungestört verweilen, um dort eine Bombe zu platzieren ' +
            '(plantDwellMs). Danach läuft ein Timer bis zur Explosion ' +
            '(bombTimerMs) — Verteidiger (Team b) müssen in dieser Zeit ebenso ' +
            'lange ungestört am Bombenort verweilen, um sie zu entschärfen ' +
            '(defuseDwellMs). Gelingt die Entschärfung oder läuft die Zeit ab, ' +
            'ohne dass eine Bombe gepflanzt wurde, gewinnen die Verteidiger; ' +
            'explodiert die Bombe, gewinnen die Angreifer. Eine feste ' +
            'Angreifer/Verteidiger-Zuteilung pro Runde, kein Seitenwechsel.',
        hasBases: false,
        hasTargets: true, // der Plant-Site ist das Ziel der Angreifer
        partyMode: 'team',
        submodes: [],
        parameters: [
            { key: 'gameDurationMs', name: 'Spieldauer', unit: 'ms',
                description: 'Zeitlimit ohne Bombenpflanzung; danach gewinnen automatisch die Verteidiger.' },
            { key: 'plantDwellMs', name: 'Pflanzzeit', unit: 'ms',
                description: 'Wie lange Angreifer ungestört am Zielort stehen müssen, um die Bombe zu pflanzen (in ar_settings.timings).' },
            { key: 'defuseDwellMs', name: 'Entschärfzeit', unit: 'ms',
                description: 'Wie lange Verteidiger ungestört an der Bombe stehen müssen, um sie zu entschärfen (in ar_settings.timings).' },
            { key: 'bombTimerMs', name: 'Bomben-Timer', unit: 'ms',
                description: 'Zeit von der Pflanzung bis zur Explosion (in ar_settings.timings).' },
        ],
    },
};
exports.PLAYER_TYPE_PROFILES = {
    hider: {
        id: 'hider',
        name: 'Hider',
        shortDescription: 'Versteckt sich vor den Seekern, kann selbst nicht schießen. ' +
            'Exklusiver Zugriff auf Drohne, Tarnung und Fake-Marker (nur Hide & Seek).',
        shotRangeMultiplier: 0,
        shotWidth: 'melee_2m', // Platzhalter, nicht relevant solange rangeMultiplier 0 ist
        uniquePerks: ['drone', 'cloak', 'fake_marker'],
    },
    seeker: {
        id: 'seeker',
        name: 'Seeker',
        shortDescription: 'Einzige Rolle, die in Hide & Seek schießen darf. ' +
            'Exklusiver Zugriff auf "Aufscheuchen" (nur Hide & Seek).',
        shotRangeMultiplier: 1.0,
        shotWidth: 'shotgun_45deg',
        uniquePerks: ['aufscheuchen'],
    },
    team_member: {
        id: 'team_member',
        name: 'Team-Spieler (Domination / CTF / Seek & Destroy)',
        shortDescription: 'Symmetrische Rolle in allen Team-Modi — beide Teams nutzen dieselben ' +
            'Schusswerte, keine rollenspezifischen Perks (nur der gemeinsame Radar-Perk).',
        shotRangeMultiplier: 1.0,
        shotWidth: 'shotgun_45deg',
        uniquePerks: [],
    },
    // ── Spielerklassen — zusätzlich zu Rolle/Team, in jedem Modus wählbar ──
    scout: {
        id: 'scout',
        name: 'Scout',
        shortDescription: 'Normale Schussreichweite, breiter Schusskegel. Exklusiver Perk: ' +
            'Reveal-Trap (platzierbare Falle, deckt nahende Gegner auf).',
        shotRangeMultiplier: 1.0,
        shotWidth: 'shotgun_45deg', // ~4x Sniper's Kegelbreite, siehe hit.ts-Kommentar
        uniquePerks: ['reveal_trap'],
    },
    sniper: {
        id: 'sniper',
        name: 'Sniper',
        shortDescription: 'Doppelte Schussreichweite, aber enge laterale Toleranz (~2m, ' +
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
        shortDescription: 'Nur ein Viertel Schussreichweite, dafür 360° rundum statt Zielkegel ' +
            '— keine Zielrichtung nötig. Exklusiver Perk: Stealth (wiederverwendet ' +
            'Hiders Tarnung-Mechanik, hier klassengebunden statt rollengebunden, ' +
            'in jedem Modus nutzbar).',
        shotRangeMultiplier: 0.25,
        shotWidth: 'omni_360deg',
        uniquePerks: ['cloak'],
    },
};
exports.GLOSSARY = [
    { term: 'Freeze', definition: 'Ein getroffener Spieler kann sich für eine gewisse Zeit nicht bewegen, schießen, capturen, tragen oder pflanzen. ' +
            'Wer sich trotzdem zu weit bewegt (über die Toleranz hinaus), verlängert seinen eigenen Freeze.' },
    { term: 'Exposed', definition: 'Ein Spieler, der die Kulisse (Geofence) zu lange verlassen hat, wird für Gegner auf der Karte sichtbar — ' +
            'so lange, bis er wieder ins Feld zurückkehrt.' },
    { term: 'Geofence', definition: 'Die unsichtbare Grenze des Spielfelds (das vom Host gezeichnete Polygon). Wer sie verlässt, bekommt zunächst eine ' +
            'Vorwarnung, danach zählt die Zeit außerhalb bis zur Exposed-Sichtbarkeit bzw. automatischem Ausscheiden.' },
    { term: 'Zone', definition: 'Ein host-platzierter Bereich auf der Karte (z.B. Domination-Kontrollpunkt oder Seek&Destroy-Zielort), den Spieler ' +
            'durch Verweilen einnehmen/nutzen können.' },
    { term: 'Base', definition: 'Der Heimatbereich eines Teams (z.B. in Capture the Flag) — Ausgangspunkt für die eigene Flagge/Basis-Mechaniken.' },
    { term: 'Target', definition: 'Das jeweilige Ziel eines Modus — in Hide & Seek die Hider selbst, in Seek & Destroy der Bomben-Pflanzort.' },
    { term: 'Captain', definition: 'Der erste einem Team zugeloste Spieler — in Capture the Flag verantwortlich für die Basis-Platzierung zu Rundenbeginn.' },
    { term: 'Cloak (Tarnung)', definition: 'Perk, der einen Spieler für eine begrenzte Zeit unsichtbar für gegnerisches Radar macht.' },
    { term: 'Drohne', definition: 'Perk (nur Hider in Hide & Seek): meldet, ob ein Seeker innerhalb eines bestimmten Radius ist — ohne dessen genaue Position zu verraten.' },
    { term: 'Fake-Marker', definition: 'Perk (nur Hider in Hide & Seek): erzeugt Lockvogel-Positionen, die für eine Weile ununterscheidbar von echten Radar-Kontakten erscheinen.' },
    { term: 'Aufscheuchen', definition: 'Perk (nur Seeker in Hide & Seek): löst bei allen Hidern einen Näherungs-Alarm aus, unabhängig von der tatsächlichen Entfernung zum Seeker.' },
    { term: 'Radar', definition: 'Gemeinsamer Perk (alle Rollen/Modi): zeigt kurzzeitig die Positionen aktiver Gegner an, mit eigenem Cooldown.' },
    { term: 'Auto-Skalierung', definition: 'Alle Zeiten/Reichweiten passen sich automatisch an die Größe des gezeichneten Spielfelds an, statt feste Werte zu nutzen — ' +
            'per Host-Einstellung abschaltbar zugunsten manueller Werte.' },
    { term: 'Aim-Kegel / Hitbox', definition: 'Der Bereich, in dem ein Ziel als getroffen gilt: normalerweise ein Kegel um die Blickrichtung, bei manchen Spielerklassen ' +
            'stattdessen eine feste seitliche Toleranz oder 360° rundum.' },
    { term: 'Spawn / Respawn', definition: 'Der Ort, an dem ein Spieler ins Spiel einsteigt bzw. nach einem Ausscheiden zurückkehrt — Teil einer künftigen ' +
            'Erweiterung für Modi mit eigener Basis, noch nicht in jedem Modus verfügbar.' },
];
