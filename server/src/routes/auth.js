const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { nanoid }= require('nanoid');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const nodemailer= require('nodemailer');
const { db }    = require('../index');
const crypto    = require('crypto');

const authLimiter = rateLimit({ windowMs: 15*60_000, max: 20 });

// Mail transport
const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   +process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

function signAccess(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '15m' });
}
function signRefresh(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

async function sendVerificationEmail(email, token, lang = 'de') {
  const base = process.env.APP_URL;
  const link = `${base}/verify-email?token=${token}`;
  const subject = lang === 'de' ? 'E-Mail bestätigen' : 'Verify your email';
  const body = lang === 'de'
    ? `Hallo! Klicke hier, um deine E-Mail zu bestätigen:\n\n${link}\n\nDer Link ist 24 Stunden gültig.`
    : `Hello! Click here to verify your email:\n\n${link}\n\nThis link expires in 24 hours.`;
  await mailer.sendMail({ from: process.env.SMTP_FROM, to: email, subject, text: body });
}

// ── REGISTER ────────────────────────────
router.post('/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('username').trim().isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_-]+$/),
  body('password').isLength({ min: 8 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, username, password, language = 'de' } = req.body;
    try {
      const hash = await bcrypt.hash(password, 12);
      const { rows } = await db.query(
        `INSERT INTO users (email, username, password_hash, language)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [email, username, hash, language]
      );
      const userId = rows[0].id;

      // Create verification token
      const token = nanoid(64);
      const exp = new Date(Date.now() + 24*3600*1000);
      await db.query(
        'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [userId, token, exp]
      );

      // Log consent
      const ipHash = crypto.createHash('sha256')
        .update(req.ip + process.env.HASH_SALT).digest('hex');
      await db.query(
        'INSERT INTO consent_log (user_id, event, ip_hash) VALUES ($1,$2,$3)',
        [userId, 'registered', ipHash]
      );

      await sendVerificationEmail(email, token, language);

      res.status(201).json({ ok: true, message: 'verification_sent' });
    } catch (e) {
      if (e.constraint === 'users_email_key')    return res.status(409).json({ error: 'email_taken' });
      if (e.constraint === 'users_username_key') return res.status(409).json({ error: 'username_taken' });
      console.error(e);
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ── GUEST LOGIN ──────────────────────────
router.post('/guest', authLimiter,
  body('username').trim().isLength({ min: 2, max: 24 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { username, language = 'de' } = req.body;
    const email = `guest_${nanoid(12)}@guest.internal`;
    const hash  = await bcrypt.hash(nanoid(32), 8);
    try {
      const { rows } = await db.query(
        `INSERT INTO users (email, username, password_hash, email_verified, is_guest, language)
         VALUES ($1,$2,$3,true,true,$4) RETURNING id, username, avatar_color`,
        [email, username, hash, language]
      );
      const user = rows[0];
      const access  = signAccess(user.id);
      const refresh = signRefresh(user.id);
      const exp = new Date(Date.now() + 30*24*3600*1000);
      await db.query(
        'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
        [user.id, refresh, exp]
      );
      res.json({ access_token: access, refresh_token: refresh, user });
    } catch (e) {
      res.status(500).json({ error: 'server_error' });
    }
  }
);

// ── LOGIN ────────────────────────────────
router.post('/login', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, password } = req.body;
    const { rows } = await db.query(
      'SELECT * FROM users WHERE email=$1 AND is_guest=false', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    const access  = signAccess(user.id);
    const refresh = signRefresh(user.id);
    const exp = new Date(Date.now() + 30*24*3600*1000);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refresh, exp]
    );

    res.json({
      access_token:  access,
      refresh_token: refresh,
      user: {
        id: user.id, username: user.username, email: user.email,
        avatar_color: user.avatar_color, language: user.language,
        email_verified: user.email_verified,
      }
    });
  }
);

// ── VERIFY EMAIL ─────────────────────────
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const { rows } = await db.query(
    `SELECT * FROM email_verifications
     WHERE token=$1 AND used=false AND expires_at > NOW()`,
    [token]
  );
  if (!rows[0]) return res.status(400).json({ error: 'invalid_or_expired' });

  await db.query('UPDATE users SET email_verified=true WHERE id=$1', [rows[0].user_id]);
  await db.query('UPDATE email_verifications SET used=true WHERE id=$1', [rows[0].id]);

  // Redirect to frontend
  res.redirect(`${process.env.APP_URL}/login?verified=1`);
});

// ── REFRESH TOKEN ────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(401).json({ error: 'missing_token' });

  try {
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const { rows } = await db.query(
      'SELECT * FROM refresh_tokens WHERE token=$1 AND expires_at > NOW()',
      [refresh_token]
    );
    if (!rows[0] || rows[0].user_id !== payload.sub)
      return res.status(401).json({ error: 'invalid_token' });

    const access = signAccess(payload.sub);
    res.json({ access_token: access });
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
});

// ── LOGOUT ───────────────────────────────
router.post('/logout', async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    await db.query('DELETE FROM refresh_tokens WHERE token=$1', [refresh_token]);
  }
  res.json({ ok: true });
});

module.exports = router;
