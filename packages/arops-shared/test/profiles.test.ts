import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_MODE_PROFILES, PLAYER_TYPE_PROFILES, GLOSSARY } from '../src/profiles';

// Mirrors the MODES keys in server/src/game/arops.js — kept as a literal list
// here (not imported, arops-shared has no dependency on server) so this test
// fails loudly if a mode gets added/renamed on one side but not the other.
const EXPECTED_MODE_IDS = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy', 'deathmatch'];
const EXPECTED_PLAYER_TYPE_IDS = ['hider', 'seeker', 'team_member', 'scout', 'sniper', 'bomber'];

test('GAME_MODE_PROFILES: has exactly the four known AR Ops modes', () => {
  assert.deepEqual(Object.keys(GAME_MODE_PROFILES).sort(), [...EXPECTED_MODE_IDS].sort());
});

test('GAME_MODE_PROFILES: every entry is well-formed', () => {
  for (const [key, profile] of Object.entries(GAME_MODE_PROFILES)) {
    assert.equal(profile.id, key, `${key}: id must match its own map key`);
    assert.ok(profile.name.length > 0, `${key}: name must not be empty`);
    assert.ok(profile.shortDescription.length > 0, `${key}: shortDescription must not be empty`);
    assert.ok(profile.longDescription.length > profile.shortDescription.length,
      `${key}: longDescription should be more detailed than shortDescription`);
    assert.equal(typeof profile.hasBases, 'boolean', `${key}: hasBases must be boolean`);
    assert.equal(typeof profile.hasTargets, 'boolean', `${key}: hasTargets must be boolean`);
    assert.ok(['team', 'individual'].includes(profile.partyMode), `${key}: invalid partyMode`);
    assert.ok(Array.isArray(profile.submodes), `${key}: submodes must be an array`);
    assert.ok(Array.isArray(profile.parameters), `${key}: parameters must be an array`);
    assert.ok(profile.parameters.length > 0, `${key}: parameters should not be empty`);
    for (const p of profile.parameters) {
      assert.ok(p.key.length > 0, `${key}: parameter key must not be empty`);
      assert.ok(p.name.length > 0, `${key}: parameter ${p.key} name must not be empty`);
      assert.ok(p.description.length > 0, `${key}: parameter ${p.key} description must not be empty`);
      assert.ok(p.unit.length > 0, `${key}: parameter ${p.key} unit must not be empty`);
    }
  }
});

test('GAME_MODE_PROFILES: none of the four existing modes has submodes yet (none implemented today)', () => {
  for (const [key, profile] of Object.entries(GAME_MODE_PROFILES)) {
    assert.deepEqual(profile.submodes, [], `${key}: expected no submodes yet`);
  }
});

test('GAME_MODE_PROFILES: partyMode matches arops.js usesTeams (hide_and_seek is the only individual mode)', () => {
  assert.equal(GAME_MODE_PROFILES.hide_and_seek!.partyMode, 'individual');
  for (const id of ['domination', 'ctf', 'seek_destroy', 'deathmatch']) {
    assert.equal(GAME_MODE_PROFILES[id]!.partyMode, 'team', `${id} should be team-based`);
  }
});

test('PLAYER_TYPE_PROFILES: has exactly the six known player types (3 roles + 3 classes)', () => {
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

test('PLAYER_TYPE_PROFILES: classes (scout/sniper/bomber) have the expected combat stats', () => {
  assert.equal(PLAYER_TYPE_PROFILES.scout!.shotRangeMultiplier, 1.0);
  assert.equal(PLAYER_TYPE_PROFILES.scout!.uniquePerks[0], 'reveal_trap');

  assert.equal(PLAYER_TYPE_PROFILES.sniper!.shotRangeMultiplier, 2.0);
  assert.equal(PLAYER_TYPE_PROFILES.sniper!.shotWidth, 'melee_2m');
  assert.deepEqual(PLAYER_TYPE_PROFILES.sniper!.uniquePerks, ['fake_marker']);

  assert.equal(PLAYER_TYPE_PROFILES.bomber!.shotRangeMultiplier, 0.25);
  assert.equal(PLAYER_TYPE_PROFILES.bomber!.shotWidth, 'omni_360deg');
  assert.deepEqual(PLAYER_TYPE_PROFILES.bomber!.uniquePerks, ['cloak']);
});

test('GLOSSARY: non-empty, every entry well-formed, no duplicate terms', () => {
  assert.ok(GLOSSARY.length > 0, 'glossary should not be empty');
  const seen = new Set<string>();
  for (const entry of GLOSSARY) {
    assert.ok(entry.term.length > 0, 'term must not be empty');
    assert.ok(entry.definition.length > 0, `${entry.term}: definition must not be empty`);
    assert.ok(!seen.has(entry.term), `duplicate glossary term: ${entry.term}`);
    seen.add(entry.term);
  }
});
