const passwordReset = require('../services/passwordReset');
const { startSession } = require('../services/loginSession');

/**
 * Forgot password: /forgot-password (ask for a link) and /reset-password/:token (choose a new password). The routes
 * exist only while mail is set up (routes/passwordResetRoutes.js).
 */

function renderForm(res, status, data) {
  res.status(status).render('reset-password', {
    title: data.state === 'invalid' ? 'This link no longer works' : 'Choose a new password',
    error: null,
    username: null,
    noindex: true,
    ...data
  });
}

class PasswordResetController {
  /** GET /forgot-password */
  static showForgot(req, res) {
    res.render('forgot-password', { title: 'Forgot password', sent: false, identifier: '', noindex: true });
  }

  /** POST /forgot-password { identifier }: the same answer whatever was typed (the mail goes out in the background) */
  static requestReset(req, res) {
    const identifier = String((req.body && req.body.identifier) || '').slice(0, 254);
    passwordReset.requestReset(req, identifier);
    res.render('forgot-password', { title: 'Forgot password', sent: true, identifier: '', noindex: true });
  }

  /** GET /reset-password/:token: the form; opening the link doesn't use it up */
  static showReset(req, res) {
    const result = passwordReset.pendingReset(req.params.token);
    if (result.status !== 'pending') return renderForm(res, 410, { state: 'invalid' });
    renderForm(res, 200, { state: 'form', token: req.params.token, username: result.user.username });
  }

  /** POST /reset-password/:token { password, confirmPassword } */
  static async completeReset(req, res, next) {
    try {
      const { password, confirmPassword } = req.body || {};
      const result = await passwordReset.completeReset(req, req.params.token, password, confirmPassword);
      if (result.status === 'invalid') return renderForm(res, 410, { state: 'invalid' });
      if (result.status === 'problem') {
        return renderForm(res, 400, { state: 'form', token: req.params.token, username: result.user.username, error: result.error });
      }
      await startSession(req, result.user);
      res.redirect('/dashboard');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = PasswordResetController;
