/**
 * Logs a user in on a brand-new session. The session ID from before (which someone else may know: a planted cookie,
 * a shared computer) is thrown away with everything stored in it, so it never becomes a logged-in session.
 */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.isAdmin;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

module.exports = { startSession };
