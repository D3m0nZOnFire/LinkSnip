const { passwordProblem } = require('../services/passwordPolicy');
const User = require('../models/User');
const { startSession } = require('../services/loginSession');
const { logAuth, ACTIONS } = require('../services/auditService');
const accountEmail = require('../services/accountEmail');
const mailService = require('../services/mailService');

/**
 * Where to go after logging in (?next=, from a page that needed an account): only a path on this site, so it
 * can't become an open redirect. Anything else is null.
 */
function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\') || /[\r\n]/.test(value)) return null;
  return value;
}

class AuthController {
  /**
   * Render registration page
   */
  static getRegister(req, res) {
    res.render('register', { error: null, username: '', email: '' });
  }

  /**
   * Handle user registration
   */
  static async postRegister(req, res) {
    const { username, email, password, confirmPassword } = req.body;

    // Validation
    if (!username || !password || !confirmPassword) {
      return res.render('register', { error: 'Username and passwords are required', username: username || '', email: email || '' });
    }

    const weak = passwordProblem(password);
    if (weak) {
      return res.render('register', { error: weak, username, email: email || '' });
    }

    if (password !== confirmPassword) {
      return res.render('register', { error: 'Passwords do not match', username, email: email || '' });
    }

    let address;
    try {
      address = accountEmail.normalizeEmail(email);
    } catch (error) {
      return res.render('register', { error: error.message, username, email: email || '' });
    }

    // With mail set up, the address is required and confirmed before the account can be used
    const confirmFirst = mailService.isEnabled();
    if (confirmFirst && !address) {
      return res.render('register', { error: 'Enter your email address: a link to confirm it finishes creating your account', username, email: '' });
    }
    if (address && accountEmail.isAddressTaken(address)) {
      return res.render('register', { error: 'This email address is already used by another account', username, email: address });
    }

    try {
      const user = await User.create(username, password, false, address);

      // Log successful registration
      logAuth(ACTIONS.REGISTER, req, username, { email: address, waitsForConfirmation: confirmFirst }, user.id);

      if (confirmFirst) {
        accountEmail.startSignupConfirmation({ id: user.id, username: user.username, email: address });
        return res.render('check-inbox', { title: 'Check your inbox', username: user.username, email: address, resent: false, noindex: true });
      }

      // Auto-login after registration
      await startSession(req, user);

      res.redirect('/dashboard');
    } catch (error) {
      // Log failed registration
      logAuth(ACTIONS.REGISTER_FAILED, req, username, { error: error.message, email: email || null });

      res.render('register', { error: error.message, username, email: email || '' });
    }
  }

  /**
   * Render login page
   */
  static getLogin(req, res) {
    res.render('login', { error: null, username: '', next: safeNext(req.query.next) });
  }

  /**
   * Handle user login
   */
  static async postLogin(req, res) {
    const { username, password } = req.body;
    const next = safeNext(req.body.next);

    if (!username || !password) {
      return res.render('login', { error: 'Username and password are required', username: username || '', next });
    }

    try {
      const user = User.findByUsername(username);

      if (!user) {
        // Log failed login - user not found
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'User not found' });
        return res.render('login', { error: 'Invalid username or password', username, next });
      }

      // Check if user is banned
      if (user.isBanned) {
        // Log failed login - user banned
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'Account banned' }, user.id);
        return res.render('login', { error: 'Your account has been suspended. Please contact support.', username, next });
      }

      const isValidPassword = await User.verifyPassword(password, user.password);

      if (!isValidPassword) {
        // Log failed login - wrong password
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'Invalid password' }, user.id);
        return res.render('login', { error: 'Invalid username or password', username, next });
      }

      // Signed up but hasn't opened the confirmation link yet (only now that the password is known to be right)
      if (accountEmail.isWaitingForConfirmation(user)) {
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'Email not confirmed' }, user.id);
        return res.status(403).render('check-inbox', {
          title: 'Check your inbox', username: user.username, email: user.email, resent: false, noindex: true
        });
      }

      // Log successful login
      logAuth(ACTIONS.LOGIN_SUCCESS, req, user.username, undefined, user.id);

      await startSession(req, user);

      res.redirect(next || '/dashboard');
    } catch (error) {
      // Log login error
      logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'System error', error: error.message });
      res.render('login', { error: 'An error occurred. Please try again.', username, next });
    }
  }

  /**
   * POST /register/resend { username }: a new confirmation link for an account still waiting. The answer is the same
   * for every username, so it doesn't tell whether an account exists or waits.
   */
  static resendSignupLink(req, res) {
    const username = String((req.body && req.body.username) || '').slice(0, 100);
    accountEmail.resendSignupLink(username);
    res.render('check-inbox', { title: 'Check your inbox', username, email: null, resent: true, noindex: true });
  }

  /**
   * Handle logout
   */
  /**
   * GET /logout (old bookmarks): asks first. Logging out itself is POST /logout.
   */
  static getLogout(req, res) {
    if (!req.user) return res.redirect('/login');
    res.render('logout', { title: 'Log out', user: req.user });
  }

  /**
   * POST /logout. A POST, so another site (middleware/sameOrigin.js) or a prefetched link can't log anyone out.
   */
  static logout(req, res) {
    // Log logout before destroying session
    if (req.user) {
      logAuth(ACTIONS.LOGOUT, req, req.user.username);
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
      res.redirect('/login');
    });
  }
}

module.exports = AuthController;
module.exports.safeNext = safeNext;
