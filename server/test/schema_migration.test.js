'use strict';
// ═══════════════════════════════════════════════════════════
//  Regression test for a real production bug: server/src/index.js's
//  migrate() takes an "incremental" path on any DB that already has a
//  `users` table — it does NOT hand the whole schema.sql to Postgres in
//  one client.query() call (which parses comments/strings correctly).
//  Instead it does a naive `sql.split(';')`, which has no idea what a SQL
//  comment or string literal is: a literal `;` anywhere in a `--` comment
//  splits the file there too, potentially fracturing a real multi-line
//  CREATE TABLE into two pieces — one an invalid truncated fragment (syntax
//  error at execution) and, worse, the other silently DROPPED if it no
//  longer matches the incremental allowlist regex (e.g. the real column
//  list without the leading "CREATE TABLE" keyword). This is exactly what
//  happened to hunt_pois: a comment `-- puzzle: {...}; target/base: ...`
//  cut the statement in half, hunt_pois was silently never created, and
//  every hunt_* insert/select on a long-running (already-migrated) server
//  failed with "relation hunt_pois does not exist" from then on — while
//  every other check here (pure hunt.js engine tests, `node --check`
//  syntax checks) stayed green, because none of them touch schema.sql or a
//  real Postgres at all. Run: node server/test/schema_migration.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

const sql = fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

// Mirrors migrate()'s incremental-path split EXACTLY — any drift here
// would defeat the point of this test.
const INCREMENTAL_RE = /CREATE EXTENSION IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE.*ADD COLUMN IF NOT EXISTS/i;
const incrementalStatements = sql
  .split(';')
  .filter(s => s.match(INCREMENTAL_RE))
  .map(s => s.trim())
  .filter(Boolean);

check('every incrementally-split CREATE TABLE statement has balanced parentheses', () => {
  const unbalanced = incrementalStatements.filter(stmt => {
    if (!/CREATE TABLE IF NOT EXISTS/i.test(stmt)) return false;
    const opens = (stmt.match(/\(/g) || []).length;
    const closes = (stmt.match(/\)/g) || []).length;
    return opens !== closes;
  });
  assert.deepEqual(unbalanced, [],
    'A comment containing a literal ";" inside one of these CREATE TABLE '
    + 'statements is fracturing it mid-column-list — see this file\'s header.');
});

// The stronger check: every table schema.sql defines (found via a proper
// multiline scan of the UNSPLIT file, so it can't itself be fooled by an
// embedded semicolon) must also come through cleanly as a real, complete
// CREATE TABLE statement on the incremental path — catches a fragment
// being silently dropped by the allowlist filter, not just a syntax error.
check('every CREATE TABLE IF NOT EXISTS in schema.sql survives the incremental split intact', () => {
  const allTableNames = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(m => m[1]);
  assert.ok(allTableNames.length > 10, 'sanity check — expected many tables in schema.sql');

  const survivedTableNames = incrementalStatements
    .filter(stmt => /CREATE TABLE IF NOT EXISTS/i.test(stmt))
    .map(stmt => stmt.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)?.[1])
    .filter(Boolean);

  const missing = allTableNames.filter(t => !survivedTableNames.includes(t));
  assert.deepEqual(missing, [],
    `Table(s) ${missing.join(', ')} never reach the DB on an already-migrated `
    + 'server — their CREATE TABLE fragment either has no closing ")" (syntax '
    + 'error) or lost its own "CREATE TABLE" keyword to an earlier fracture '
    + '(silently dropped, no error at all). Check for a literal ";" inside a '
    + '-- comment anywhere inside that table\'s column list.');
});

check('every ALTER TABLE ... ADD COLUMN IF NOT EXISTS statement is well-formed', () => {
  // Matched on "ADD COLUMN IF NOT EXISTS" specifically, not just the
  // substring "ALTER TABLE" — a CREATE TABLE statement's own leading
  // comment block can innocently mention "ALTER TABLE" in prose (e.g.
  // "see the ALTER TABLE users below") without being one itself.
  const broken = incrementalStatements.filter(stmt =>
    /ADD COLUMN IF NOT EXISTS/i.test(stmt) && !/ALTER TABLE\s+\w+\s+ADD COLUMN IF NOT EXISTS\s+\w+/i.test(stmt));
  assert.deepEqual(broken, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
