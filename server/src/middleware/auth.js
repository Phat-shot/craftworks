const { verifyToken } = require('../auth/verifyToken');

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1]
                || req.cookies?.access_token;
    req.user = await verifyToken(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: e.code || 'token_invalid' });
  }
}

function requireVerified(req, res, next) {
  if (!req.user.email_verified && !req.user.is_guest)
    return res.status(403).json({ error: 'email_not_verified' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'admin_only' });
  next();
}

module.exports = { requireAuth, requireVerified, requireAdmin };
