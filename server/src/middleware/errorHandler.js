'use strict';
const { fail } = require('../utils/respond');

// Centralized fallback — catches anything that reaches Express's own error
// handling (uncaught throws in route code, any next(err) call) instead of
// falling through to Express's default HTML error page. Existing routes
// already handle their own errors with try/catch + res.json({error: ...});
// this only changes what happens for the previously-unhandled case, so it's
// additive, not a rewrite of any route's own response shape.
module.exports = function errorHandler(err, _req, res, next) {
  console.error('[unhandled]', err.stack || err.message);
  if (res.headersSent) return next(err);
  fail(res, 500, 'server_error');
};
