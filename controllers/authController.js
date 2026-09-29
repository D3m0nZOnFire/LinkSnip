const User = require('../models/User');
const { logAuth, ACTIONS } = require('../services/auditService');

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

    if (password.length < 6) {
      return res.render('register', { error: 'Password must be at least 6 characters', username, email: email || '' });
    }

    if (password !== confirmPassword) {
      return res.render('register', { error: 'Passwords do not match', username, email: email || '' });
    }

    try {
      const user = await User.create(username, password, false, email || null);

      // Log successful registration
      logAuth(ACTIONS.REGISTER, req, username, { email: email || null });

      // Auto-login after registration
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.isAdmin;

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
    res.render('login', { error: null, username: '' });
  }

  /**
   * Handle user login
   */
  static async postLogin(req, res) {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.render('login', { error: 'Username and password are required', username: username || '' });
    }

    try {
      const user = User.findByUsername(username);

      if (!user) {
        // Log failed login - user not found
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'User not found' });
        return res.render('login', { error: 'Invalid username or password', username });
      }

      // Check if user is banned
      if (user.isBanned) {
        // Log failed login - user banned
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'Account banned' });
        return res.render('login', { error: 'Your account has been suspended. Please contact support.', username });
      }

      const isValidPassword = await User.verifyPassword(password, user.password);

      if (!isValidPassword) {
        // Log failed login - wrong password
        logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'Invalid password' });
        return res.render('login', { error: 'Invalid username or password', username });
      }

      // Log successful login
      logAuth(ACTIONS.LOGIN_SUCCESS, req, username);

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.isAdmin;

      res.redirect('/dashboard');
    } catch (error) {
      // Log login error
      logAuth(ACTIONS.LOGIN_FAILED, req, username, { reason: 'System error', error: error.message });
      res.render('login', { error: 'An error occurred. Please try again.', username });
    }
  }

  /**
   * Handle logout
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