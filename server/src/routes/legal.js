// routes/legal.js
const router = require('express').Router();
router.get('/imprint',  (_, res) => res.json({ ok: true, type: 'imprint' }));
router.get('/privacy',  (_, res) => res.json({ ok: true, type: 'privacy' }));
module.exports = router;

// Fix lobbies export in index
// routes/lobbies-router.js used from index as /api/lobbies
