const bcrypt = require('bcrypt');
const db = require('../config/database');
const UserToken = require('../models/UserToken');
const mailService = require('./mailService');
const mailTemplates = require('./mailTemplates');
const { mailContext } = require('./accountEmail');
const { passwordProblem } = require('./passwordPolicy');
const { newPasswordSet } = require('./loginSession');
const { logAuth, ACTIONS } = require('./auditService');

/**
 * Forgot password (only with mail set up): a link by mail to the account's confirmed address, working once for
 * RESET_TTL_MINUTES. Asking never tells whether an account exists, is confirmed or is banned. Setting the new
 * password logs out every session of the account (users.sessionVersion) and mails a notice.
 */

const RESET_TTL_MINUTES = 30;
const RESETS_PER_HOUR = 3;

const USER_COLUMNS = 'id, username, email, emailVerifiedAt, isBanned, isAdmin';

/** The account a username or a confirmed address (ignoring case) belongs to, or null. */
function findAccount(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`).get(value) ||
    db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ? COLLATE NOCASE AND emailVerifiedAt IS NOT NULL`).get(value) ||
    null;
}

const canReset = (user) => !!(user && user.email && user.emailVerifiedAt && !user.isBanned);

/** "Forgot password?" form: mails a link when the account can get one (in the background). Returns nothing. */
function requestReset(req, identifier) {
  const user = findAccount(identifier);
  if (!canReset(user) || UserToken.countRecent(user.id, 'reset_password', 60) >= RESETS_PER_HOUR) return;

  const token = UserToken.create(user.id, 'reset_password', { ttlMinutes: RESET_TTL_MINUTES });
  const url = mailService.link(`/reset-password/${token}`);
  mailService.deliver({ to: user.email, ...mailTemplates.resetPassword({ ...mailContext(), username: user.username, url }) });
  logAuth(ACTIONS.PASSWORD_RESET_REQUEST, req, user.username, { to: user.email }, user.id);
}

/** The form (GET): whose password the link resets, without using it up. */
function pendingReset(token) {
  const found = UserToken.find('reset_password', token);
  const user = found && db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(found.userId);
  return canReset(user) ? { status: 'pending', user } : { status: 'invalid' };
}

/**
 * The form (POST). The password is checked before the link is used, so a typo doesn't cost the link.
 * @returns {Promise<{ status: 'reset', user } | { status: 'invalid' } | { status: 'problem', user, error }>}
 */
async function completeReset(req, token, password, confirmPassword) {
  const pending = pendingReset(token);
  if (pending.status !== 'pending') {
    logAuth(ACTIONS.PASSWORD_RESET_FAILED, req, null, { reason: 'Link unknown, used or expired' });
    return pending;
  }
  const problem = passwordProblem(password === undefined || password === null ? '' : String(password)) ||
    (password !== confirmPassword ? "The passwords don't match" : null);
  if (problem) return { status: 'problem', user: pending.user, error: problem };

  const hash = await bcrypt.hash(String(password), 10);
  const used = UserToken.consume('reset_password', token); // atomic: two tabs can't both use it
  if (!used) return { status: 'invalid' };

  const user = pending.user;
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  newPasswordSet(user.id);
  logAuth(ACTIONS.PASSWORD_RESET, req, user.username, undefined, user.id);
  notifyPasswordChanged(user);
  return { status: 'reset', user };
}

/** "Your password was changed" to the account's confirmed address (when there is one and mail is on). */
function notifyPasswordChanged(user) {
  if (!user.email || !user.emailVerifiedAt || !mailService.isEnabled()) return;
  UserToken.cancel(user.id, 'reset_password');
  mailService.deliver({ to: user.email, ...mailTemplates.passwordChanged({ ...mailContext(), username: user.username }) });
}

/**
 * Settings → Password, Admin → Users and the CLI: after a new password is stored. Logs out the account's sessions
 * (but `keepReq`'s), ends open reset links and sends the notice.
 */
function afterPasswordChange(userId, keepReq = null) {
  newPasswordSet(userId, keepReq);
  const user = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(userId);
  UserToken.cancel(userId, 'reset_password');
  if (user) notifyPasswordChanged(user);
}

module.exports = { requestReset, pendingReset, completeReset, afterPasswordChange, findAccount, RESET_TTL_MINUTES };
