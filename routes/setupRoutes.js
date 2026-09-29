const express = require('express');
const router = express.Router();
const setupService = require('../services/setupService');
const { SetupError, MIN_PASSWORD } = require('../services/setupService');
const { logAuth, ACTIONS } = require('../services/auditService');
const { authLimiter } = require('../middleware/rateLimiter');

// Once an admin exists, /setup doesn't exist (falls through to the 404).
const onlyDuringSetup = (req, res, next) => (setupService.needsSetup() ? next() : next('route'));

router.get('/setup', onlyDuringSetup, (req, res) => {
  res.render('setup', { error: null, username: '', minPassword: MIN_PASSWORD });
});

router.post('/setup', onlyDuringSetup, authLimiter, async (req, res) => {
  const { code, username, password, confirmPassword } = req.body;

  try {
    const admin = await setupService.createFirstAdmin({ code, username, password, confirmPassword });

    req.session.userId = admin.id;
    req.session.username = admin.username;
    req.session.isAdmin = 1;
    logAuth(ACTIONS.SETUP_ADMIN, req, admin.username, { userId: admin.id });

    res.redirect('/admin/settings');
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    res.status(400).render('setup', { error: error.message, username: username || '', minPassword: MIN_PASSWORD });
  }
});

module.exports = router;
