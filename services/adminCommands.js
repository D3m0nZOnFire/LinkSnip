const bcrypt = require('bcrypt');
const db = require('../config/database');
const User = require('../models/User');
const { MIN_PASSWORD } = require('./setupService');
const { logAdminAction, ACTIONS } = require('./auditService');

/**
 * The commands behind `npm run admin` (scripts/admin.js).
 * Each throws an Error with a message fit to print when it can't proceed.
 * Actions are audit-logged with { via: 'cli' } and no acting user.
 */

function checkPassword(password) {
  if (!password || password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
}

function findUser(username) {
  const user = User.findByUsername(String(username || '').trim());
  if (!user) throw new Error(`No user named "${username}".`);
  return user;
}

async function createAdmin(username, password) {
  const name = String(username || '').trim();
  if (!name) throw new Error('Username is required.');
  checkPassword(password);
  if (User.findByUsername(name)) throw new Error(`A user named "${name}" already exists. Use "promote" instead.`);

  const created = await User.create(name, password, true);
  logAdminAction(ACTIONS.CREATE_USER, null, 'user', created.id, name, { isAdmin: true, via: 'cli' });
  return User.findById(created.id);
}

function promote(username) {
  const user = findUser(username);
  if (user.isAdmin) throw new Error(`"${user.username}" is already an admin.`);

  db.prepare('UPDATE users SET isAdmin = 1 WHERE id = ?').run(user.id);
  logAdminAction(ACTIONS.GRANT_ADMIN, null, 'user', user.id, user.username, { via: 'cli' });
  return User.findById(user.id);
}

async function resetPassword(username, password) {
  const user = findUser(username);
  checkPassword(password);

  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  logAdminAction(ACTIONS.UPDATE_USER, null, 'user', user.id, user.username, { passwordReset: true, via: 'cli' });
  return User.findById(user.id);
}

module.exports = { createAdmin, promote, resetPassword };
