/**
 * Infrastructure settings that come from the environment (everything else lives
 * in DATA_DIR/settings.json): PORT, NODE_ENV, SESSION_SECRET, IP_HASH_SECRET, DATA_DIR, TRUST_PROXY.
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

const MIN_IP_HASH_SECRET_LENGTH = 32;

/**
 * The key for stored IP hashes (services/ipHash.js). Kept outside the database, so a
 * copy of the database alone can't be matched against every IPv4 address. Separate
 * from SESSION_SECRET, so rotating that (logging everyone out) keeps the hashes.
 * @returns {string} IP_HASH_SECRET
 * @throws {Error} When it is missing, the .env.example placeholder, too short, or SESSION_SECRET
 */
function requireIpHashSecret(env = process.env) {
  const secret = (env.IP_HASH_SECRET || '').trim();
  const howTo = [
    'Generate one and put it in your .env file (keep it: a new one restarts unique-visitor counts):',
    '',
    '  IP_HASH_SECRET=$(openssl rand -hex 32)'
  ];
  if (!secret || PLACEHOLDER_SECRETS.includes(secret)) {
    throw new Error(['IP_HASH_SECRET is not set. LinkSnip needs it to hash visitor IPs.', ...howTo].join('\n'));
  }
  if (secret.length < MIN_IP_HASH_SECRET_LENGTH) {
    throw new Error([`IP_HASH_SECRET must be at least ${MIN_IP_HASH_SECRET_LENGTH} characters.`, ...howTo].join('\n'));
  }
  if (secret === (env.SESSION_SECRET || '').trim()) {
    throw new Error(['IP_HASH_SECRET must differ from SESSION_SECRET.', ...howTo].join('\n'));
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

module.exports = { requireSessionSecret, requireIpHashSecret, parseTrustProxy };
