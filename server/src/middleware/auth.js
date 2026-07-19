// @ts-check
// Pilot file for the incremental server TS migration (backend redesign
// plan, Phase 5) — plain JS, but type-checked via server/tsconfig.json's
// allowJs + this file's own @ts-check pragma. Everything else in server/
// stays unchecked JS until it's next touched (see ../types/express.d.ts
// for the shared req.user/req.db augmentation this file relies on).
const { verifyToken } = require('../auth/verifyToken');

/** @type {import('express').RequestHandler} */
async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1]
                || req.cookies?.access_token;
    req.user = await verifyToken(token);
    next();
  } catch (e) {
    const code = /** @type {{ code?: string }} */ (e)?.code;
    return res.status(401).json({ error: code || 'token_invalid' });
  }
}

// requireVerified/requireAdmin are only ever mounted after requireAuth, so
// req.user is guaranteed set in practice — but Express's types can't express
// that ordering, so we guard explicitly instead of asserting non-null.
/** @type {import('express').RequestHandler} */
function requireVerified(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!req.user.email_verified && !req.user.is_guest)
    return res.status(403).json({ error: 'email_not_verified' });
  next();
}

/** @type {import('express').RequestHandler} */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin_only' });
  next();
}

module.exports = { requireAuth, requireVerified, requireAdmin };
