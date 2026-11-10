const db = require('../config/database');

/**
 * Logs a user in on a brand-new session. The session ID from before (which someone else may know: a planted cookie,
 * a shared computer) is thrown away with everything stored in it, so it never becomes a logged-in session.
 * The session keeps the account's sessionVersion: a new password raises it (newPasswordSet), and attachUser logs out
 * every session started with an older one.
 */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.isAdmin;
      req.session.sessionVersion = currentVersion(user.id);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

function currentVersion(userId) {
  const row = db.prepare('SELECT sessionVersion FROM users WHERE id = ?').get(userId);
  return (row && row.sessionVersion) || 0;
}

/**
 * A new password was set: every session of the account is logged out on its next request. Pass the request whose
 * session should stay logged in (the user changing their own password), if any.
 * @returns {number} The new version
 */
function newPasswordSet(userId, keepReq = null) {
  db.prepare('UPDATE users SET sessionVersion = sessionVersion + 1 WHERE id = ?').run(userId);
  const version = currentVersion(userId);
  if (keepReq && keepReq.session && keepReq.session.userId === userId) keepReq.session.sessionVersion = version;
  return version;
}

/** Whether a session was started before the account's latest password (sessions from before have no version: 0). */
function isOutdated(session, user) {
  return (session.sessionVersion || 0) !== (user.sessionVersion || 0);
}

module.exports = { startSession, newPasswordSet, isOutdated };
