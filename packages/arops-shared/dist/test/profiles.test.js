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
const EXPECTED_MODE_IDS = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy'];
const EXPECTED_PLAYER_TYPE_IDS = ['hider', 'seeker', 'team_member'];
(0, node_test_1.test)('GAME_MODE_PROFILES: has exactly the four known AR Ops modes', () => {
    strict_1.default.deepEqual(Object.keys(profiles_1.GAME_MODE_PROFILES).sort(), [...EXPECTED_MODE_IDS].sort());
});
(0, node_test_1.test)('GAME_MODE_PROFILES: every entry is well-formed', () => {
    for (const [key, profile] of Object.entries(profiles_1.GAME_MODE_PROFILES)) {
        strict_1.default.equal(profile.id, key, `${key}: id must match its own map key`);
        strict_1.default.ok(profile.name.length > 0, `${key}: name must not be empty`);
        strict_1.default.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
        strict_1.default.equal(typeof profile.hasBases, 'boolean', `${key}: hasBases must be boolean`);
        strict_1.default.equal(typeof profile.hasTargets, 'boolean', `${key}: hasTargets must be boolean`);
        strict_1.default.ok(['team', 'individual'].includes(profile.partyMode), `${key}: invalid partyMode`);
    }
});
(0, node_test_1.test)('GAME_MODE_PROFILES: partyMode matches arops.js usesTeams (hide_and_seek is the only individual mode)', () => {
    strict_1.default.equal(profiles_1.GAME_MODE_PROFILES.hide_and_seek.partyMode, 'individual');
    for (const id of ['domination', 'ctf', 'seek_destroy']) {
        strict_1.default.equal(profiles_1.GAME_MODE_PROFILES[id].partyMode, 'team', `${id} should be team-based`);
    }
});
(0, node_test_1.test)('PLAYER_TYPE_PROFILES: has exactly the three known player types', () => {
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
