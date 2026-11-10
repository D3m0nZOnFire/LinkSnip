const express = require('express');
const router = express.Router();
const AccountEmailController = require('../controllers/accountEmailController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Settings → Email. Changing it checks the current password: wrong guesses count like failed logins.
router.put('/api/user/email', isAuthenticated, authLimiter, AccountEmailController.updateEmail);
router.post('/api/user/email/resend', isAuthenticated, AccountEmailController.resend);

// The confirmation link from the mail (open to visitors, also on a private instance: requireLogin OPEN_PREFIXES)
router.get('/verify-email/:token', AccountEmailController.showVerify);
router.post('/verify-email/:token', AccountEmailController.confirmVerify);

// Admin → Settings → General → Send test email
router.post('/api/admin/mail/test', isAuthenticated, isAdmin, AccountEmailController.sendTestMail);

module.exports = router;
