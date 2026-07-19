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
export declare const GAME_MODE_PROFILES: Record<string, GameModeProfile>;
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
export declare const PLAYER_TYPE_PROFILES: Record<string, PlayerTypeProfile>;
