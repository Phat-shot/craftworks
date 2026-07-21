'use strict';
// Single shared pg.Pool instance. Previously created inline in index.js and
// re-imported elsewhere via `require('../index').db` — a circular-require
// smell (six files reaching back into the app's own entry point just to
// grab a Pool) that only worked because of Node's module cache. Extracted
// here so nothing needs to require index.js just for the database handle.
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;
