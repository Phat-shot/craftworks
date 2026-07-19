// ═══════════════════════════════════════════════════════════
//  AR OPS — Steckbriefe (Spielmodi + Spielertypen)
//
//  Rein deklarative Beschreibung dessen, was server/src/game/arops.js's
//  MODES-Plugin-Tabelle und actionArUsePerk HEUTE tatsächlich tun — noch
//  KEINE Verhaltens-Quelle. Die eigentlichen Modi/Perks bleiben vorerst in
//  arops.js implementiert; dieses Modul ist das Fundament, aus dem sie
//  später abgeleitet werden sollen (siehe Backend-Redesign-Plan).
// ═══════════════════════════════════════════════════════════

/** Team-basiert (zwei Seiten gegeneinander) oder individuelle Rollen ohne
 *  Team-Zugehörigkeit. AR Ops hat aktuell keinen echten Solo-/PvE-Modus
 *  (GPS-Multiplayer-Spiel) — 'individual' deckt Hide & Seek ab, wo jeder
 *  Spieler eine eigene Rolle (Hider/Seeker) hat, aber kein Team. */
export type PartyMode = 'team' | 'individual';

export interface GameModeProfile {
  /** Muss mit dem Key in server/src/game/arops.js's MODES-Tabelle übereinstimmen. */
  id: string;
  name: string;
  shortDescription: string;
  hasBases: boolean;
  hasTargets: boolean;
  partyMode: PartyMode;
}

export const GAME_MODE_PROFILES: Record<string, GameModeProfile> = {
  hide_and_seek: {
    id: 'hide_and_seek',
    name: 'Hide & Seek',
    shortDescription:
      'Seeker fotografieren Hider im Aim-Kegel; gefundene Hider scheiden aus ' +
      '(oder wechseln die Seite, je nach Host-Einstellung "foundMode").',
    hasBases: false,
    hasTargets: true, // die Hider selbst sind die Ziele
    partyMode: 'individual',
  },
  domination: {
    id: 'domination',
    name: 'Domination',
    shortDescription:
      'Zwei Teams halten host-platzierte Zonen; Punkte pro Sekunde im Besitz, ' +
      'erstes Team zur Zielpunktzahl gewinnt.',
    hasBases: false,
    hasTargets: false, // Zonen/Territorium, kein Ziel im Schützen-Sinn
    partyMode: 'team',
  },
  ctf: {
    id: 'ctf',
    name: 'Capture the Flag',
    shortDescription:
      'Kapitäne platzieren zu Rundenbeginn eine Basis; Flagge aus der ' +
      'gegnerischen Basis stehlen und zur eigenen zurückbringen.',
    hasBases: true,
    hasTargets: false,
    partyMode: 'team',
  },
  seek_destroy: {
    id: 'seek_destroy',
    name: 'Seek & Destroy',
    shortDescription:
      'Angreifer (Team a) platzieren an einem Zielort eine Bombe, ' +
      'Verteidiger (Team b) müssen sie vor der Explosion entschärfen.',
    hasBases: false,
    hasTargets: true, // der Plant-Site ist das Ziel der Angreifer
    partyMode: 'team',
  },
};

/**
 * Schusskegel-Kategorie eines Spielertyps — bewusst symbolische Label, keine
 * exakten Grad-/Meterwerte (die stehen weiterhin numerisch in HitConfig,
 * siehe types.ts). Beispielwerte laut Anfrage: enge Reichweite (~2m),
 * Schrotkegel (~45°), Rundum (360°), durch Gebäude (ignoriert Deckung).
 */
export type ShotWidth = 'melee_2m' | 'shotgun_45deg' | 'omni_360deg' | 'through_walls';

export interface PlayerTypeProfile {
  /** Muss mit dem `role`-Wert in server/src/game/arops.js übereinstimmen
   *  (bzw. bei den Team-Modi ein Platzhalter, da dort keine eigene
   *  Rollen-Unterscheidung über Team-Zugehörigkeit hinaus existiert). */
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
};
