/**
 * express-session options. The cookie is SameSite=Lax: a link clicked in a chat or an e-mail arrives logged in,
 * but the browser leaves it off cross-site form posts and fetches (middleware/sameOrigin.js refuses those too).
 *
 * @param {{ store: object, secret: string }} options
 * @returns {object} options for session()
 */
function sessionOptions({ store, secret }) {
  return {
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
      sameSite: 'lax',
      // Secure over HTTPS (incl. behind a proxy sending X-Forwarded-Proto), still works on plain http://localhost
      secure: 'auto'
    }
  };
}

module.exports = { sessionOptions };
