import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MODE_PROFILES, PLAYER_TYPE_PROFILES } from '../src/profiles';

// Mirrors the MODES keys in server/src/game/arops.js — kept as a literal list
// here (not imported, arops-shared has no dependency on server) so this test
// fails loudly if a mode gets added/renamed on one side but not the other.
const EXPECTED_MODE_IDS = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy'];
const EXPECTED_PLAYER_TYPE_IDS = ['hider', 'seeker', 'team_member'];

test('GAME_MODE_PROFILES: has exactly the four known AR Ops modes', () => {
  assert.deepEqual(Object.keys(GAME_MODE_PROFILES).sort(), [...EXPECTED_MODE_IDS].sort());
});

test('GAME_MODE_PROFILES: every entry is well-formed', () => {
  for (const [key, profile] of Object.entries(GAME_MODE_PROFILES)) {
    assert.equal(profile.id, key, `${key}: id must match its own map key`);
    assert.ok(profile.name.length > 0, `${key}: name must not be empty`);
    assert.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
    assert.equal(typeof profile.hasBases, 'boolean', `${key}: hasBases must be boolean`);
    assert.equal(typeof profile.hasTargets, 'boolean', `${key}: hasTargets must be boolean`);
    assert.ok(['team', 'individual'].includes(profile.partyMode), `${key}: invalid partyMode`);
  }
});

test('GAME_MODE_PROFILES: partyMode matches arops.js usesTeams (hide_and_seek is the only individual mode)', () => {
  assert.equal(GAME_MODE_PROFILES.hide_and_seek!.partyMode, 'individual');
  for (const id of ['domination', 'ctf', 'seek_destroy']) {
    assert.equal(GAME_MODE_PROFILES[id]!.partyMode, 'team', `${id} should be team-based`);
  }
});

test('PLAYER_TYPE_PROFILES: has exactly the three known player types', () => {
  assert.deepEqual(Object.keys(PLAYER_TYPE_PROFILES).sort(), [...EXPECTED_PLAYER_TYPE_IDS].sort());
});

test('PLAYER_TYPE_PROFILES: every entry is well-formed', () => {
  const validShotWidths = ['melee_2m', 'shotgun_45deg', 'omni_360deg', 'through_walls'];
  for (const [key, profile] of Object.entries(PLAYER_TYPE_PROFILES)) {
    assert.equal(profile.id, key, `${key}: id must match its own map key`);
    assert.ok(profile.name.length > 0, `${key}: name must not be empty`);
    assert.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
    assert.equal(typeof profile.shotRangeMultiplier, 'number', `${key}: shotRangeMultiplier must be a number`);
    assert.ok(profile.shotRangeMultiplier >= 0, `${key}: shotRangeMultiplier must not be negative`);
    assert.ok(validShotWidths.includes(profile.shotWidth), `${key}: invalid shotWidth`);
    assert.ok(Array.isArray(profile.uniquePerks), `${key}: uniquePerks must be an array`);
  }
});

test('PLAYER_TYPE_PROFILES: hider cannot shoot (matches canShoot() in arops.js hide_and_seek plugin)', () => {
  assert.equal(PLAYER_TYPE_PROFILES.hider!.shotRangeMultiplier, 0);
});

test('PLAYER_TYPE_PROFILES: hider/seeker perks match actionArUsePerk\'s role gating in arops.js', () => {
  assert.deepEqual(PLAYER_TYPE_PROFILES.hider!.uniquePerks.sort(), ['cloak', 'drone', 'fake_marker']);
  assert.deepEqual(PLAYER_TYPE_PROFILES.seeker!.uniquePerks, ['aufscheuchen']);
  assert.deepEqual(PLAYER_TYPE_PROFILES.team_member!.uniquePerks, []);
});
