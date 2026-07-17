const jwt = require('jsonwebtoken');
const { db } = require('../index');

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1]
                || req.cookies?.access_token;
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query(
      'SELECT id, email, username, language, avatar_color, email_verified, is_guest FROM users WHERE id=$1',
      [payload.sub]
    );
    if (!rows[0]) return res.status(401).json({ error: 'user_not_found' });
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token_invalid' });
  }
}

function requireVerified(req, res, next) {
  if (!req.user.email_verified && !req.user.is_guest)
    return res.status(403).json({ error: 'email_not_verified' });
  next();
}

module.exports = { requireAuth, requireVerified };
