import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_SNIPPETS } from '../src/simScript';

test('simScript: every snippet has a unique key', () => {
  const keys = SIM_SNIPPETS.map(s => s.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('simScript: every bot id is unique within its snippet', () => {
  for (const s of SIM_SNIPPETS) {
    const ids = s.bots.map(b => b.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate bot id in ${s.key}`);
  }
});

test('simScript: shoot/checkpoint actor refs resolve to a known bot or the tester', () => {
  for (const s of SIM_SNIPPETS) {
    const knownIds = new Set(['tester', ...s.bots.map(b => b.id)]);
    for (const beat of s.shoots) {
      assert.ok(knownIds.has(beat.shooterId), `${s.key}: unknown shooterId ${beat.shooterId}`);
      assert.ok(knownIds.has(beat.targetId), `${s.key}: unknown targetId ${beat.targetId}`);
    }
  }
});

test('simScript: per-actor route/shoot timestamps are non-decreasing', () => {
  for (const s of SIM_SNIPPETS) {
    for (const bot of s.bots) {
      const ts = bot.route.map(w => w.tMs);
      assert.deepEqual(ts, [...ts].sort((a, b) => a - b), `${s.key}/${bot.id}: route not chronological`);
      assert.equal(bot.route[0]?.tMs, 0, `${s.key}/${bot.id}: route must start at tMs=0`);
    }
    const shootTs = s.shoots.map(b => b.tMs);
    assert.deepEqual(shootTs, [...shootTs].sort((a, b) => a - b), `${s.key}: shoots not chronological`);
  }
});

test('simScript: every beat/checkpoint fits inside durationMs', () => {
  for (const s of SIM_SNIPPETS) {
    for (const beat of s.shoots) {
      assert.ok(beat.tMs < s.durationMs, `${s.key}: shoot at ${beat.tMs} exceeds durationMs ${s.durationMs}`);
    }
    for (const cp of s.checkpoints) {
      assert.ok(cp.tMs < s.durationMs, `${s.key}: checkpoint at ${cp.tMs} exceeds durationMs ${s.durationMs}`);
    }
    for (const bot of s.bots) {
      for (const w of bot.route) {
        assert.ok(w.tMs < s.durationMs, `${s.key}/${bot.id}: waypoint at ${w.tMs} exceeds durationMs ${s.durationMs}`);
      }
    }
  }
});

test('simScript: domination/seek_destroy snippets declare zones, others do not need to', () => {
  for (const s of SIM_SNIPPETS) {
    if (s.subMode === 'domination' || s.subMode === 'seek_destroy') {
      assert.ok((s.zones?.length ?? 0) >= 1, `${s.key}: needs at least one zone`);
    }
  }
});

test('simScript: field side is positive and reasonable', () => {
  for (const s of SIM_SNIPPETS) {
    assert.ok(s.fieldSideM >= 10 && s.fieldSideM <= 500, `${s.key}: implausible fieldSideM ${s.fieldSideM}`);
  }
});
