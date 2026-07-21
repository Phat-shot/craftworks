'use strict';
// Consistent response envelope — adopted incrementally as routes are
// touched (backend redesign plan, Phase 4). Existing routes keep their
// current ad-hoc res.json() shapes until they're next modified; new/
// touched routes should use these instead of raw res.json().
function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, status, error, extra) {
  return res.status(status).json({ ok: false, error, ...extra });
}

module.exports = { ok, fail };
