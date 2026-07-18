#!/usr/bin/env node
// npm's handling of local `file:` tarball dependencies is unreliable about
// noticing the tarball's CONTENT changed when its path/version didn't —
// `npm install` has repeatedly kept serving a stale, previously-cached copy
// of vendor/arops-shared.tgz after sync-shared repacked it, because
// package-lock.json's recorded integrity hash for it was never updated to
// match. Rather than hoping `npm install` figures it out (it hasn't, more
// than once), patch the lockfile's integrity hash directly here, so the
// following `npm install` has no stale hash left to trust.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const tarballPath = path.join(__dirname, '..', 'vendor', 'arops-shared.tgz');
const lockPath = path.join(__dirname, '..', 'package-lock.json');
const key = 'node_modules/@craftworks/arops-shared';

const buf = fs.readFileSync(tarballPath);
const integrity = 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (!lock.packages || !lock.packages[key]) {
  console.error(`fix-shared-integrity: ${key} not found in package-lock.json — nothing to patch`);
  process.exit(1);
}
lock.packages[key].integrity = integrity;
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(`fix-shared-integrity: patched ${key} → ${integrity}`);
