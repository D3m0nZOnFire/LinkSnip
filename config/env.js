/**
 * Infrastructure settings that come from the environment (everything else lives
 * in DATA_DIR/settings.json): PORT, NODE_ENV, SESSION_SECRET, DATA_DIR, TRUST_PROXY.
 */

// Example values that are public, so never safe to sign sessions with
const PLACEHOLDER_SECRETS = ['change-me', 'your-secure-session-secret-change-this-in-production'];

/**
 * @returns {string} SESSION_SECRET
 * @throws {Error} When it is missing or still the .env.example placeholder
 */
function requireSessionSecret(env = process.env) {
  const secret = (env.SESSION_SECRET || '').trim();
  if (!secret || PLACEHOLDER_SECRETS.includes(secret)) {
    throw new Error([
      'SESSION_SECRET is not set. LinkSnip needs it to sign login sessions.',
      'Generate one and put it in your .env file:',
      '',
      '  SESSION_SECRET=$(openssl rand -hex 32)',
      '',
      "(or: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
    ].join('\n'));
  }
  return secret;
}

/**
 * Express 'trust proxy' from TRUST_PROXY. Default 1: one reverse proxy (Caddy, nginx)
 * in front. Accepts a hop count, true/false, or Express's address/subnet list.
 */
function parseTrustProxy(value) {
  const v = (value || '').trim();
  if (v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

module.exports = { requireSessionSecret, parseTrustProxy };
