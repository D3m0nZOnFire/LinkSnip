/**
 * Infrastructure settings that come from the environment (everything else lives
 * in DATA_DIR/settings.json): PORT, NODE_ENV, SESSION_SECRET, IP_HASH_SECRET, DATA_DIR, TRUST_PROXY, and the
 * optional mail setup (SMTP_*, MAIL_*, PUBLIC_URL).
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

const MAIL_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_REPLY_TO', 'PUBLIC_URL'];

/**
 * The address links in mails start with. Never taken from a request: a forged Host header would otherwise put
 * an attacker's site into a real password reset mail.
 * @returns {string} The origin, without a trailing slash
 */
function readPublicUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash ||
      url.username || url.password) {
    throw new Error(`PUBLIC_URL must be this site's address, like https://links.example.com (no path), not "${value}".`);
  }
  return url.origin;
}

/**
 * Mail (address verification, password reset). Off unless set up: returns null when none of the mail variables
 * is set. A half-finished setup refuses to start, naming what is missing.
 * MAIL_TRANSPORT=console (development only) prints mails instead of sending them.
 * @returns {null|{ transport: 'smtp'|'console', host?, port?, secure?, user?, pass?, from, replyTo, publicUrl }}
 * @throws {Error} When the setup is incomplete or a value can't be read
 */
function readMailConfig(env = process.env) {
  const get = (name) => (env[name] || '').trim();
  const transport = get('MAIL_TRANSPORT') || 'smtp';
  if (!['smtp', 'console'].includes(transport)) {
    throw new Error(`MAIL_TRANSPORT must be smtp (the default) or console, not "${transport}".`);
  }

  const replyTo = get('MAIL_REPLY_TO') || null;
  if (transport === 'console') {
    if (get('NODE_ENV') === 'production') {
      throw new Error('MAIL_TRANSPORT=console only prints mails; it is for development, not NODE_ENV=production.');
    }
    return {
      transport,
      from: get('MAIL_FROM') || 'LinkSnip <no-reply@localhost>',
      replyTo,
      publicUrl: readPublicUrl(get('PUBLIC_URL') || `http://localhost:${get('PORT') || 8081}`)
    };
  }

  if (!MAIL_VARS.some(get)) return null;

  const missing = ['SMTP_HOST', 'MAIL_FROM', 'PUBLIC_URL'].filter(name => !get(name));
  if (missing.length) {
    throw new Error(`Mail is only partly set up: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing. ` +
      'Set them all to send mail (password reset, address verification), or remove the mail variables.');
  }
  if (!get('SMTP_USER') !== !get('SMTP_PASS')) {
    throw new Error('Set SMTP_USER and SMTP_PASS together (or neither, for a server that needs no login).');
  }
  const port = get('SMTP_PORT') ? Number(get('SMTP_PORT')) : 465;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a port number (465 for TLS, 587 for STARTTLS), not "${get('SMTP_PORT')}".`);
  }
  if (!/@[^@\s>]+\.?[^@\s>]*>?$/.test(get('MAIL_FROM'))) {
    throw new Error(`MAIL_FROM needs an address, like: LinkSnip <no-reply@example.com>, not "${get('MAIL_FROM')}".`);
  }

  return {
    transport,
    host: get('SMTP_HOST'),
    port,
    secure: port === 465,
    user: get('SMTP_USER') || null,
    pass: get('SMTP_PASS') || null,
    from: get('MAIL_FROM'),
    replyTo,
    publicUrl: readPublicUrl(get('PUBLIC_URL'))
  };
}

module.exports = { requireSessionSecret, requireIpHashSecret, parseTrustProxy, readMailConfig };
