"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const profiles_1 = require("../src/profiles");
// Mirrors the MODES keys in server/src/game/arops.js — kept as a literal list
// here (not imported, arops-shared has no dependency on server) so this test
// fails loudly if a mode gets added/renamed on one side but not the other.
const EXPECTED_MODE_IDS = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy', 'deathmatch'];
const EXPECTED_PLAYER_TYPE_IDS = ['hider', 'seeker', 'team_member', 'scout', 'sniper', 'bomber'];
(0, node_test_1.test)('GAME_MODE_PROFILES: has exactly the known AR Ops modes', () => {
    strict_1.default.deepEqual(Object.keys(profiles_1.GAME_MODE_PROFILES).sort(), [...EXPECTED_MODE_IDS].sort());
});
(0, node_test_1.test)('GAME_MODE_PROFILES: every entry is well-formed', () => {
    for (const [key, profile] of Object.entries(profiles_1.GAME_MODE_PROFILES)) {
        strict_1.default.equal(profile.id, key, `${key}: id must match its own map key`);
        strict_1.default.ok(profile.name.length > 0, `${key}: name must not be empty`);
        strict_1.default.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
        strict_1.default.ok(profile.longDescription.length > profile.shortDescription.length, `${key}: longDescription should be more detailed than shortDescription`);
        strict_1.default.equal(typeof profile.hasBases, 'boolean', `${key}: hasBases must be boolean`);
        strict_1.default.equal(typeof profile.hasTargets, 'boolean', `${key}: hasTargets must be boolean`);
        strict_1.default.ok(['team', 'individual'].includes(profile.partyMode), `${key}: invalid partyMode`);
        strict_1.default.ok(Array.isArray(profile.submodes), `${key}: submodes must be an array`);
        for (const sm of profile.submodes) {
            strict_1.default.ok(sm.id.length > 0, `${key}: submode id must not be empty`);
            strict_1.default.ok(sm.name.length > 0, `${key}: submode ${sm.id} name must not be empty`);
            strict_1.default.ok(sm.shortDescription.length > 0, `${key}: submode ${sm.id} shortDescription must not be empty`);
        }
        strict_1.default.ok(Array.isArray(profile.parameters), `${key}: parameters must be an array`);
        strict_1.default.ok(profile.parameters.length > 0, `${key}: parameters should not be empty`);
        for (const p of profile.parameters) {
            strict_1.default.ok(p.key.length > 0, `${key}: parameter key must not be empty`);
            strict_1.default.ok(p.name.length > 0, `${key}: parameter ${p.key} name must not be empty`);
            strict_1.default.ok(p.description.length > 0, `${key}: parameter ${p.key} description must not be empty`);
            strict_1.default.ok(p.unit.length > 0, `${key}: parameter ${p.key} unit must not be empty`);
        }
    }
});
(0, node_test_1.test)('GAME_MODE_PROFILES: only hide_and_seek has submodes today ("ffa"/"The Ship", ar_settings.hsVariant)', () => {
    for (const [key, profile] of Object.entries(profiles_1.GAME_MODE_PROFILES)) {
        if (key === 'hide_and_seek') {
            strict_1.default.deepEqual(profile.submodes.map(sm => sm.id), ['ffa', 'the_ship']);
        }
        else {
            strict_1.default.deepEqual(profile.submodes, [], `${key}: expected no submodes`);
        }
    }
});
(0, node_test_1.test)('GAME_MODE_PROFILES: partyMode matches arops.js usesTeams', () => {
    strict_1.default.equal(profiles_1.GAME_MODE_PROFILES.hide_and_seek.partyMode, 'individual', 'hide_and_seek should be individual (usesTeams: false, all 3 variants)');
    for (const id of ['domination', 'ctf', 'seek_destroy', 'deathmatch']) {
        strict_1.default.equal(profiles_1.GAME_MODE_PROFILES[id].partyMode, 'team', `${id} should be team-based`);
    }
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: has exactly the six known player types (3 roles + 3 classes)', () => {
    strict_1.default.deepEqual(Object.keys(profiles_1.PLAYER_TYPE_PROFILES).sort(), [...EXPECTED_PLAYER_TYPE_IDS].sort());
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: every entry is well-formed', () => {
    const validShotWidths = ['melee_2m', 'shotgun_45deg', 'omni_360deg', 'through_walls'];
    for (const [key, profile] of Object.entries(profiles_1.PLAYER_TYPE_PROFILES)) {
        strict_1.default.equal(profile.id, key, `${key}: id must match its own map key`);
        strict_1.default.ok(profile.name.length > 0, `${key}: name must not be empty`);
        strict_1.default.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
        strict_1.default.equal(typeof profile.shotRangeMultiplier, 'number', `${key}: shotRangeMultiplier must be a number`);
        strict_1.default.ok(profile.shotRangeMultiplier >= 0, `${key}: shotRangeMultiplier must not be negative`);
        strict_1.default.ok(validShotWidths.includes(profile.shotWidth), `${key}: invalid shotWidth`);
        strict_1.default.ok(Array.isArray(profile.uniquePerks), `${key}: uniquePerks must be an array`);
    }
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: hider cannot shoot (matches canShoot() in arops.js hide_and_seek plugin)', () => {
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.hider.shotRangeMultiplier, 0);
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: hider/seeker perks match actionArUsePerk\'s role gating in arops.js', () => {
    strict_1.default.deepEqual(profiles_1.PLAYER_TYPE_PROFILES.hider.uniquePerks.sort(), ['cloak', 'drone', 'fake_marker']);
    strict_1.default.deepEqual(profiles_1.PLAYER_TYPE_PROFILES.seeker.uniquePerks, ['aufscheuchen']);
    strict_1.default.deepEqual(profiles_1.PLAYER_TYPE_PROFILES.team_member.uniquePerks, []);
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: classes (scout/sniper/bomber) have the expected combat stats', () => {
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.scout.shotRangeMultiplier, 1.0);
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.scout.uniquePerks[0], 'reveal_trap');
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.sniper.shotRangeMultiplier, 2.0);
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.sniper.shotWidth, 'melee_2m');
    strict_1.default.deepEqual(profiles_1.PLAYER_TYPE_PROFILES.sniper.uniquePerks, ['fake_marker']);
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.bomber.shotRangeMultiplier, 0.25);
    strict_1.default.equal(profiles_1.PLAYER_TYPE_PROFILES.bomber.shotWidth, 'omni_360deg');
    strict_1.default.deepEqual(profiles_1.PLAYER_TYPE_PROFILES.bomber.uniquePerks, ['cloak']);
});
(0, node_test_1.test)('GLOSSARY: non-empty, every entry well-formed, no duplicate terms', () => {
    strict_1.default.ok(profiles_1.GLOSSARY.length > 0, 'glossary should not be empty');
    const seen = new Set();
    for (const entry of profiles_1.GLOSSARY) {
        strict_1.default.ok(entry.term.length > 0, 'term must not be empty');
        strict_1.default.ok(entry.definition.length > 0, `${entry.term}: definition must not be empty`);
        strict_1.default.ok(!seen.has(entry.term), `duplicate glossary term: ${entry.term}`);
        seen.add(entry.term);
    }
});
