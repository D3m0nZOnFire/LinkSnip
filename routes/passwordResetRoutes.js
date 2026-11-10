const express = require('express');
const router = express.Router();
const PasswordResetController = require('../controllers/passwordResetController');
const mailService = require('../services/mailService');
const { authLimiter, forgotPasswordLimiter } = require('../middleware/rateLimiter');

// Forgot password exists only while mail is set up (otherwise 404, and the login page has no link)
const mailOn = (req, res, next) => (mailService.isEnabled() ? next() : next('route'));

// Open to visitors, also on a private instance (requireLogin OPEN_PATHS / OPEN_PREFIXES)
router.get('/forgot-password', mailOn, PasswordResetController.showForgot);
router.post('/forgot-password', mailOn, forgotPasswordLimiter, PasswordResetController.requestReset);
router.get('/reset-password/:token', mailOn, PasswordResetController.showReset);
// Failed attempts (unknown links) count like failed logins
router.post('/reset-password/:token', mailOn, authLimiter, PasswordResetController.completeReset);

module.exports = router;
