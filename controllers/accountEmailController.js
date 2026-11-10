const bcrypt = require('bcrypt');
const db = require('../config/database');
const accountEmail = require('../services/accountEmail');
const User = require('../models/User');
const { startSession } = require('../services/loginSession');

/**
 * Account email: Settings → Email (change, send the confirmation again), the confirmation link from the mail
 * (/verify-email/:token: GET asks, POST confirms), and Admin → Settings → Send test email.
 */

function sendError(res, error, fallback) {
  if (error instanceof accountEmail.EmailError) {
    return res.status(error.status).json({ error: error.code || error.message, message: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback });
}

// The page for each outcome of a confirmation link
const PAGES = {
  pending: { status: 200, title: 'Confirm your email address' },
  confirmed: { status: 200, title: 'Email address confirmed' },
  invalid: { status: 410, title: 'This link no longer works' },
  taken: { status: 409, title: 'Address already in use' }
};

function renderVerifyPage(req, res, result) {
  const page = PAGES[result.status];
  res.status(page.status).render('verify-email', {
    title: page.title,
    // Settings only for the account the link belongs to (someone else may be logged in on this browser)
    user: req.user && result.userId === req.user.id ? req.user : null,
    state: result.status,
    email: result.email || null,
    username: result.username || null,
    signedUp: !!result.signedUp,
    token: req.params.token,
    noindex: true
  });
}

class AccountEmailController {
  /** PUT /api/user/email { email, currentPassword } ('' removes the address) */
  static async updateEmail(req, res) {
    const { email, currentPassword } = req.body || {};
    if (!currentPassword) {
      return res.status(400).json({ error: 'Enter your current password' });
    }
    try {
      const { password } = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
      if (!(await bcrypt.compare(String(currentPassword), password))) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
      const result = accountEmail.changeEmail(req, req.user.id, email);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof accountEmail.EmailError) return res.status(error.status).json({ error: error.message });
      sendError(res, error, 'Could not change the email address');
    }
  }

  /** POST /api/user/email/resend */
  static resend(req, res) {
    try {
      accountEmail.resendVerification(req.user.id);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error, 'Could not send the confirmation mail');
    }
  }

  /** GET /verify-email/:token: shows what the link confirms; opening it doesn't use it up (link checkers do that) */
  static showVerify(req, res) {
    renderVerifyPage(req, res, accountEmail.pendingVerification(req.params.token));
  }

  /** POST /verify-email/:token */
  static async confirmVerify(req, res, next) {
    try {
      const result = accountEmail.confirmVerification(req, req.params.token);
      // Signing up: the link proves the mailbox, so the new account is logged in here (no second login)
      if (result.status === 'confirmed' && result.signedUp) {
        await startSession(req, User.findById(result.userId));
        req.user = User.findById(result.userId);
      }
      renderVerifyPage(req, res, result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/admin/mail/test */
  static async sendTestMail(req, res) {
    try {
      const to = await accountEmail.sendTestMail(req);
      res.json({ success: true, to });
    } catch (error) {
      sendError(res, error, 'Could not send the test mail');
    }
  }
}

module.exports = AccountEmailController;
