const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../config/database');

/**
 * First-run setup
 *
 * While no admin exists, a one-time setup code is written to the server log and
 * every page redirects to /setup, where the code plus a username and password
 * create the first admin. Once any admin exists (including one from a restored
 * backup or `npm run admin`), setup is over for good.
 */

// Crockford base32: no I, L, O or U, so the code survives being read aloud or retyped.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MIN_PASSWORD = 8;

class SetupError extends Error {}

const normalize = (code) => String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function generateCode() {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join(''); // 256 % 32 = 0, so no bias
  return chars.match(/.{4}/g).join('-');
}

class SetupService {
  constructor() {
    this.reset();
  }

  /** Forget the code and the "done" flag (used by tests). */
  reset() {
    this._code = null;
    this._done = false;
  }

  /** True while no admin account exists. Once false it stays false. */
  needsSetup() {
    if (this._done) return false;
    const admin = db.prepare('SELECT 1 FROM users WHERE isAdmin = 1 LIMIT 1').get();
    if (admin) {
      this._done = true;
      this._code = null;
    }
    return !admin;
  }

  /**
   * Called on startup. When setup is needed, generates the code and logs it.
   * @returns {string|null} The code, or null when an admin already exists
   */
  start(logger = console) {
    if (!this.needsSetup()) return null;
    this._code = generateCode();
    logger.log([
      '',
      '════════════════════════════════════════════════════════════',
      '  No admin account yet. Open /setup in your browser and use',
      `  this one-time setup code:   ${this._code}`,
      '════════════════════════════════════════════════════════════',
      ''
    ].join('\n'));
    return this._code;
  }

  /** Constant-time check of a submitted code (case, spaces and dashes ignored). */
  checkCode(input) {
    if (!this._code) return false;
    const expected = Buffer.from(normalize(this._code));
    const given = Buffer.from(normalize(input));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  /**
   * Create the first admin.
   * @throws {SetupError} with a message fit to show on the form
   */
  async createFirstAdmin({ code, username, password, confirmPassword }) {
    if (!this.needsSetup()) throw new SetupError('Setup is already complete.');
    if (!this.checkCode(code)) throw new SetupError('That setup code is not correct. Check the server log.');

    const name = String(username || '').trim();
    if (!name) throw new SetupError('Username is required.');
    if (!password || password.length < MIN_PASSWORD) {
      throw new SetupError(`Password must be at least ${MIN_PASSWORD} characters.`);
    }
    if (password !== confirmPassword) throw new SetupError('Passwords do not match.');

    const hash = await bcrypt.hash(password, 10);

    // Re-check inside the transaction so two simultaneous submits can't both win.
    const id = db.transaction(() => {
      if (db.prepare('SELECT 1 FROM users WHERE isAdmin = 1 LIMIT 1').get()) {
        throw new SetupError('Setup is already complete.');
      }
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
        throw new SetupError('That username is taken.');
      }
      return db.prepare('INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 1)').run(name, hash).lastInsertRowid;
    })();

    this._done = true;
    this._code = null;
    return db.prepare('SELECT id, username, isAdmin FROM users WHERE id = ?').get(id);
  }
}

module.exports = new SetupService();
module.exports.SetupError = SetupError;
module.exports.MIN_PASSWORD = MIN_PASSWORD;
