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
export declare const GAME_MODE_PROFILES: Record<string, GameModeProfile>;
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
export declare const PLAYER_TYPE_PROFILES: Record<string, PlayerTypeProfile>;
/** Ein einzelner Glossar-Eintrag: Fachbegriff + einfache Erklärung, für ein
 *  künftiges In-App-Glossar (Web-Lobby + Mobile App). Reine Daten, keine
 *  Logik. */
export interface GlossaryEntry {
    term: string;
    definition: string;
}
export declare const GLOSSARY: GlossaryEntry[];
