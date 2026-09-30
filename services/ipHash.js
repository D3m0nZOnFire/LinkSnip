const crypto = require('crypto');
const { requireIpHashSecret } = require('../config/env');

/**
 * Stored IP hashes (analytics_events.ipHash, reports.reporterIpHash):
 * HMAC-SHA256(IP_HASH_SECRET, SHA-256(ip)), in hex. A plain SHA-256 of an IP can be
 * reversed by trying all ~4 billion IPv4 addresses; without the secret, which lives
 * in the environment and not in the database, it can't. Hashing the SHA-256 (rather
 * than the IP) lets migrateIpHashes turn old plain hashes into the same values.
 * The secret is read on every call.
 */
const SCHEME = 'hmac-sha256-v1';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (value) => crypto.createHmac('sha256', requireIpHashSecret()).update(value).digest('hex');

/** @returns {string|null} the stored hash of an IP, null without one */
function hashIp(ip) {
  if (!ip) return null;
  return hmac(sha256(String(ip)));
}

/** An old plain SHA-256 hash → the hash a new visit from that IP gets. */
function rewrapLegacy(legacyHash) {
  return hmac(legacyHash);
}

/** Identifies the current secret (to notice when it changes) without revealing it. */
function fingerprint() {
  return hmac('linksnip:ip-hash-fingerprint').slice(0, 16);
}

module.exports = { SCHEME, hashIp, rewrapLegacy, fingerprint };
