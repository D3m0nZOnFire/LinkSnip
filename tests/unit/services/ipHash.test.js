const crypto = require('crypto');
const ipHash = require('../../../services/ipHash');

// Stored IP hashes are HMAC(IP_HASH_SECRET, SHA-256(ip)): without the secret, which
// lives outside the database, nobody can test the ~4 billion IPv4 addresses against
// them. Hashing the plain SHA-256 lets old stored hashes be rewrapped into the same values.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');

let saved;
beforeEach(() => { saved = process.env.IP_HASH_SECRET; });
afterEach(() => { process.env.IP_HASH_SECRET = saved; });

describe('hashIp', () => {
  it('is HMAC(secret, SHA-256(ip)) in hex', () => {
    expect(ipHash.hashIp('192.168.1.1')).toBe(hmac(process.env.IP_HASH_SECRET, sha256('192.168.1.1')));
    expect(ipHash.hashIp('192.168.1.1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is not the plain SHA-256 anyone could compute', () => {
    expect(ipHash.hashIp('192.168.1.1')).not.toBe(sha256('192.168.1.1'));
  });

  it('is the same for the same IP and differs between IPs', () => {
    expect(ipHash.hashIp('10.0.0.1')).toBe(ipHash.hashIp('10.0.0.1'));
    expect(ipHash.hashIp('10.0.0.1')).not.toBe(ipHash.hashIp('10.0.0.2'));
  });

  it('depends on the secret, read live', () => {
    const before = ipHash.hashIp('10.0.0.1');
    process.env.IP_HASH_SECRET = 'z'.repeat(64);
    expect(ipHash.hashIp('10.0.0.1')).not.toBe(before);
  });

  it('returns null without an IP', () => {
    expect(ipHash.hashIp(null)).toBeNull();
    expect(ipHash.hashIp(undefined)).toBeNull();
    expect(ipHash.hashIp('')).toBeNull();
  });

  it('refuses to hash without a usable secret', () => {
    process.env.IP_HASH_SECRET = '';
    expect(() => ipHash.hashIp('10.0.0.1')).toThrow(/IP_HASH_SECRET/);
  });
});

describe('rewrapLegacy', () => {
  it('turns an old plain SHA-256 hash into the hash a new visit from that IP gets', () => {
    expect(ipHash.rewrapLegacy(sha256('203.0.113.9'))).toBe(ipHash.hashIp('203.0.113.9'));
  });
});

describe('fingerprint', () => {
  it('identifies the secret without revealing it, and changes with it', () => {
    const fp = ipHash.fingerprint();
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(process.env.IP_HASH_SECRET).not.toContain(fp);
    expect(ipHash.fingerprint()).toBe(fp);
    process.env.IP_HASH_SECRET = 'z'.repeat(64);
    expect(ipHash.fingerprint()).not.toBe(fp);
  });
});
