const { requireSessionSecret, requireIpHashSecret, parseTrustProxy } = require('../../../config/env');

describe('requireSessionSecret', () => {
  it('returns the secret when set', () => {
    expect(requireSessionSecret({ SESSION_SECRET: 'a'.repeat(64) })).toBe('a'.repeat(64));
  });

  it.each([
    [{}],
    [{ SESSION_SECRET: '' }],
    [{ SESSION_SECRET: '   ' }],
    [{ SESSION_SECRET: 'change-me' }], // the .env.example placeholder
    [{ SESSION_SECRET: 'your-secure-session-secret-change-this-in-production' }] // the old one, public in git history
  ])('refuses %o with a message that says how to fix it', (env) => {
    expect(() => requireSessionSecret(env)).toThrow(/SESSION_SECRET/);
    expect(() => requireSessionSecret(env)).toThrow(/openssl rand -hex 32/);
  });
});

describe('requireIpHashSecret', () => {
  const SESSION = { SESSION_SECRET: 's'.repeat(64) };

  it('returns the secret when set', () => {
    expect(requireIpHashSecret({ ...SESSION, IP_HASH_SECRET: ' ' + 'b'.repeat(64) + ' ' })).toBe('b'.repeat(64));
  });

  it.each([
    [{}],
    [{ IP_HASH_SECRET: '' }],
    [{ IP_HASH_SECRET: '   ' }],
    [{ IP_HASH_SECRET: 'change-me' }] // the .env.example placeholder
  ])('refuses %o with a message that says how to fix it', (env) => {
    expect(() => requireIpHashSecret({ ...SESSION, ...env })).toThrow(/IP_HASH_SECRET/);
    expect(() => requireIpHashSecret({ ...SESSION, ...env })).toThrow(/openssl rand -hex 32/);
  });

  it('refuses a short secret: whoever has the database could guess it', () => {
    expect(() => requireIpHashSecret({ ...SESSION, IP_HASH_SECRET: 'x'.repeat(31) })).toThrow(/at least 32/);
    expect(requireIpHashSecret({ ...SESSION, IP_HASH_SECRET: 'x'.repeat(32) })).toBe('x'.repeat(32));
  });

  it('refuses the session secret: rotating it must not change the IP hashes', () => {
    expect(() => requireIpHashSecret({ SESSION_SECRET: 'k'.repeat(64), IP_HASH_SECRET: 'k'.repeat(64) }))
      .toThrow(/differ from SESSION_SECRET/);
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['1', 1],
    ['2', 2],
    ['0', 0],
    ['true', true],
    ['false', false],
    ['loopback', 'loopback'],
    ['10.0.0.0/8, 172.16.0.0/12', '10.0.0.0/8, 172.16.0.0/12']
  ])('%p → %p', (input, expected) => {
    expect(parseTrustProxy(input)).toEqual(expected);
  });
});
