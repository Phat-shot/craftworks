'use strict';
// Single shared pg.Pool instance. Previously created inline in index.js and
// re-imported elsewhere via `require('../index').db` — a circular-require
// smell (six files reaching back into the app's own entry point just to
// grab a Pool) that only worked because of Node's module cache. Extracted
// here so nothing needs to require index.js just for the database handle.
const { Pool } = require('pg');

// `max` explicit rather than relying on pg's own default (10) — a sustained,
// DB-heavy stretch (e.g. the mobile app's debug-only Match-Simulation
// feature, ~50 back-to-back short matches each with several queries and a
// telemetry write every second) can exhaust a small pool under real load,
// and pool exhaustion previously surfaced client-side as a misleading
// "session expired" (a query timeout/error inside requireAuth's user lookup
// or /auth/refresh's token lookup was — before that bug was fixed — reported
// as an authentication failure, not a database one). Raising this doesn't
// fix that class of bug by itself, just reduces how often ordinary load
// triggers the underlying contention at all.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

module.exports = pool;
