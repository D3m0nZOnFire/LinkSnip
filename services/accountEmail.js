const db = require('../config/database');
const UserToken = require('../models/UserToken');
const mailService = require('./mailService');
const mailTemplates = require('./mailTemplates');
const configService = require('./configService');
const { logAccountChange, logAdminAction, ACTIONS } = require('./auditService');

/**
 * A user's email address: set or change it, confirm it through a link sent by mail. Only a confirmed address
 * (users.emailVerifiedAt) gets password reset mails, and only one account can confirm an address (ignoring case).
 */

const VERIFY_TTL_MINUTES = 24 * 60;
const RESENDS_PER_HOUR = 3;
const MAX_EMAIL_LENGTH = 254;

class EmailError extends Error {
  constructor(message, status = 400, code = null) {
    super(message);
    this.name = 'EmailError';
    this.status = status;
    this.code = code;
  }
}

const siteName = () => configService.get('branding.name').trim() || 'LinkSnip';
// What every template needs: the site's name and where replies go (MAIL_REPLY_TO)
const mailContext = () => ({
  siteName: siteName(),
  replyTo: (mailService.summary() || {}).replyTo || null,
  theme: mailTheme('light'),
  darkTheme: mailTheme('dark')
});

/**
 * Mail colors from the site's palettes (Admin → Appearance: branding.lightPalette / darkPalette), the same tokens
 * /theme.css uses; LinkSnip's own palette of that mode when the setting names no fitting one. Mail apps get plain
 * colors (no CSS variables).
 */
function mailTheme(mode) {
  const paletteService = require('./paletteService');
  let palette = paletteService.getPalette(configService.get(`branding.${mode}Palette`));
  if (!palette || palette.mode !== mode) palette = paletteService.getPalette(paletteService.DEFAULTS[mode]);
  if (!palette) return undefined;
  const t = paletteService.tokens(palette);
  return {
    background: mode === 'light' ? t['--secondary'] : t['--background'], card: t['--card'], text: t['--foreground'],
    muted: t['--muted-foreground'], border: t['--border'], accent: t['--primary'], accentText: t['--primary-foreground']
  };
}
const sameAddress = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * @returns {string|null} The address trimmed, or null when empty
 * @throws {EmailError} When it isn't an email address
 */
function normalizeEmail(value) {
  const email = String(value === undefined || value === null ? '' : value).trim();
  if (!email) return null;
  if (email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EmailError('Enter a valid email address');
  }
  return email;
}

function userRow(userId) {
  return db.prepare('SELECT id, username, email, emailVerifiedAt, pendingConfirmation FROM users WHERE id = ?').get(userId);
}

const UNCONFIRMED_ACCOUNT_DAYS = 7;

/** Whether another account already confirmed this address (ignoring case). */
function isAddressTaken(email, exceptUserId = null) {
  return !!db.prepare(`
    SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND emailVerifiedAt IS NOT NULL AND id IS NOT ?
  `).get(email, exceptUserId);
}

/**
 * Sign-up with mail on: the account can't log in until its address is confirmed (login shows "Check your inbox").
 * Mail switched off since: nothing can be confirmed, so it no longer waits.
 */
function isWaitingForConfirmation(user) {
  return !!(user && user.pendingConfirmation && !user.emailVerifiedAt && mailService.isEnabled());
}

/** Marks a new account as waiting and mails its link. */
function startSignupConfirmation(user) {
  db.prepare('UPDATE users SET pendingConfirmation = 1 WHERE id = ?').run(user.id);
  sendVerification(user);
}

/**
 * "Send the link again" on the Check your inbox page: by username, answering the same whatever the account is.
 * Sends only to an account still waiting, at most RESENDS_PER_HOUR an hour (the sign-up mail counts).
 */
function resendSignupLink(username) {
  const user = db.prepare('SELECT id, username, email, emailVerifiedAt, pendingConfirmation FROM users WHERE username = ?')
    .get(String(username || ''));
  if (!isWaitingForConfirmation(user)) return;
  if (UserToken.countRecent(user.id, 'verify_email', 60) >= RESENDS_PER_HOUR) return;
  sendVerification(user);
}

/** Nightly: accounts that signed up and never confirmed their address within UNCONFIRMED_ACCOUNT_DAYS. */
function unconfirmedAccountIds() {
  return db.prepare(`
    SELECT id FROM users
    WHERE pendingConfirmation = 1 AND emailVerifiedAt IS NULL AND isAdmin = 0
      AND julianday(createdAt) < julianday('now', ?)
  `).all(`-${UNCONFIRMED_ACCOUNT_DAYS} days`).map(r => r.id);
}

/**
 * Mails a confirmation link to the user's current address (in the background).
 * @returns {Promise<boolean>|false} false when there is nothing to send or mail is off
 */
function sendVerification(user) {
  if (!user.email || !mailService.isEnabled()) return false;
  const token = UserToken.create(user.id, 'verify_email', { email: user.email, ttlMinutes: VERIFY_TTL_MINUTES });
  const url = mailService.link(`/verify-email/${token}`);
  mailService.deliver({ to: user.email, ...mailTemplates.verifyEmail({ ...mailContext(), username: user.username, url }) });
  return true;
}

/**
 * Settings → Email. A new address is stored unconfirmed and gets a confirmation link; a confirmed address it
 * replaces is told. The same address again changes nothing.
 * @returns {{ email: string|null, verified: boolean, mailSent: boolean }}
 */
function changeEmail(req, userId, value) {
  const email = normalizeEmail(value);
  const before = userRow(userId);
  if (email === before.email) {
    return { email, verified: !!before.emailVerifiedAt, mailSent: false };
  }

  db.prepare('UPDATE users SET email = ?, emailVerifiedAt = NULL WHERE id = ?').run(email, userId);
  UserToken.cancel(userId, 'verify_email');
  logAccountChange(ACTIONS.EMAIL_CHANGE, req, { from: before.email, to: email });

  if (before.emailVerifiedAt && before.email && !sameAddress(before.email, email) && mailService.isEnabled()) {
    mailService.deliver({
      to: before.email,
      ...mailTemplates.emailChanged({ ...mailContext(), username: before.username, newEmail: email || '(none)' })
    });
  }
  const mailSent = sendVerification({ ...before, email });
  return { email, verified: false, mailSent };
}

/** A new confirmation link (Settings → Send again), at most RESENDS_PER_HOUR an hour. */
function resendVerification(userId) {
  if (!mailService.isEnabled()) throw new EmailError("This site can't send mail", 503, 'mail_disabled');
  const user = userRow(userId);
  if (!user.email) throw new EmailError('Add an email address first');
  if (user.emailVerifiedAt) throw new EmailError('Your email address is already confirmed');
  if (UserToken.countRecent(userId, 'verify_email', 60) >= RESENDS_PER_HOUR) {
    throw new EmailError('Too many confirmation mails. Try again in an hour.', 429);
  }
  sendVerification(user);
}

/**
 * The confirmation page (GET): what the link would confirm, without using it up.
 * @returns {{ status: 'pending', email: string, username: string } | { status: 'invalid' }}
 */
function pendingVerification(token) {
  const found = UserToken.find('verify_email', token);
  const user = found && userRow(found.userId);
  if (!user || !sameAddress(user.email, found.email)) return { status: 'invalid' };
  return { status: 'pending', email: found.email, username: user.username, userId: user.id };
}

/**
 * Confirms the address (POST): uses the link up.
 * @returns {{ status: 'confirmed'|'invalid'|'taken', email?: string }}
 */
function confirmVerification(req, token) {
  const found = UserToken.consume('verify_email', token);
  const user = found && userRow(found.userId);
  if (!user || !sameAddress(user.email, found.email)) return { status: 'invalid' };

  try {
    db.prepare(`
      UPDATE users SET emailVerifiedAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), pendingConfirmation = 0 WHERE id = ?
    `).run(user.id);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return { status: 'taken', email: user.email };
    throw error;
  }
  logAccountChange(ACTIONS.VERIFY_EMAIL, req, { email: user.email }, user);
  // The first confirmation after signing up finishes creating the account: the caller logs it in
  return { status: 'confirmed', email: user.email, userId: user.id, signedUp: !!user.pendingConfirmation };
}

/** Admin → Settings → Send test email: to the admin's confirmed address, waiting for the server's answer. */
async function sendTestMail(req) {
  if (!mailService.isEnabled()) throw new EmailError("This site can't send mail", 503, 'mail_disabled');
  const user = userRow(req.user.id);
  if (!user.email || !user.emailVerifiedAt) {
    throw new EmailError('Confirm your own email address in Settings first; the test mail goes there');
  }
  try {
    await mailService.send({ to: user.email, ...mailTemplates.testMail({ ...mailContext(), username: user.username }) });
  } catch (error) {
    throw new EmailError(`The mail server refused it: ${error.message}`, 502);
  }
  logAdminAction(ACTIONS.SEND_TEST_EMAIL, req, 'mail', null, user.email);
  return user.email;
}

module.exports = {
  mailContext, EmailError, normalizeEmail, sendVerification, changeEmail, resendVerification, pendingVerification,
  confirmVerification, sendTestMail, siteName, VERIFY_TTL_MINUTES, isAddressTaken, isWaitingForConfirmation,
  startSignupConfirmation, resendSignupLink, unconfirmedAccountIds, UNCONFIRMED_ACCOUNT_DAYS
};
