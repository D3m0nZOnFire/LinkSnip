const { requireSessionSecret, requireIpHashSecret, parseTrustProxy, readMailConfig } = require('../../../config/env');

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

describe('readMailConfig', () => {
  const SMTP = {
    SMTP_HOST: 'mail.example.com',
    SMTP_USER: 'no-reply@example.com',
    SMTP_PASS: 'secret',
    MAIL_FROM: 'LinkSnip <no-reply@example.com>',
    PUBLIC_URL: 'https://links.example.com'
  };

  it('is null (mail off) when nothing is set', () => {
    expect(readMailConfig({})).toBeNull();
    expect(readMailConfig({ SMTP_HOST: '  ', PUBLIC_URL: '' })).toBeNull();
  });

  it('reads a full SMTP setup, port 465 with TLS by default', () => {
    expect(readMailConfig(SMTP)).toEqual({
      transport: 'smtp',
      host: 'mail.example.com',
      port: 465,
      secure: true,
      user: 'no-reply@example.com',
      pass: 'secret',
      from: 'LinkSnip <no-reply@example.com>',
      replyTo: null,
      publicUrl: 'https://links.example.com'
    });
  });

  it('uses STARTTLS (secure false) on another port, and reads Reply-To', () => {
    const config = readMailConfig({ ...SMTP, SMTP_PORT: '587', MAIL_REPLY_TO: 'contact@example.com' });
    expect(config).toEqual(expect.objectContaining({ port: 587, secure: false, replyTo: 'contact@example.com' }));
  });

  it('allows a server without login (no user and no password)', () => {
    const { SMTP_USER, SMTP_PASS, ...noLogin } = SMTP;
    expect(readMailConfig(noLogin)).toEqual(expect.objectContaining({ user: null, pass: null }));
  });

  it('keeps only the origin of PUBLIC_URL (a trailing slash is fine)', () => {
    expect(readMailConfig({ ...SMTP, PUBLIC_URL: 'https://links.example.com/' }).publicUrl)
      .toBe('https://links.example.com');
    expect(readMailConfig({ ...SMTP, PUBLIC_URL: 'http://localhost:8081' }).publicUrl).toBe('http://localhost:8081');
  });

  it.each([
    [{ SMTP_HOST: 'mail.example.com' }, /MAIL_FROM.*PUBLIC_URL|PUBLIC_URL.*MAIL_FROM/],
    [{ ...SMTP, SMTP_HOST: '' }, /SMTP_HOST/],
    [{ ...SMTP, MAIL_FROM: '' }, /MAIL_FROM/],
    [{ ...SMTP, PUBLIC_URL: '' }, /PUBLIC_URL/],
    [{ ...SMTP, SMTP_PASS: '' }, /SMTP_USER and SMTP_PASS/],
    [{ ...SMTP, SMTP_USER: '' }, /SMTP_USER and SMTP_PASS/]
  ])('refuses a partial setup and names what is missing (%#)', (env, message) => {
    expect(() => readMailConfig(env)).toThrow(message);
  });

  it.each([
    ['links.example.com', /PUBLIC_URL/],
    ['ftp://links.example.com', /PUBLIC_URL/],
    ['https://links.example.com/app', /PUBLIC_URL/],
    ['https://links.example.com/?a=1', /PUBLIC_URL/]
  ])('refuses PUBLIC_URL %p (an http(s) address without a path)', (publicUrl, message) => {
    expect(() => readMailConfig({ ...SMTP, PUBLIC_URL: publicUrl })).toThrow(message);
  });

  it.each(['0', '70000', 'abc', '25.5'])('refuses SMTP_PORT %p', (port) => {
    expect(() => readMailConfig({ ...SMTP, SMTP_PORT: port })).toThrow(/SMTP_PORT/);
  });

  it.each(['LinkSnip', 'nobody'])('refuses MAIL_FROM %p without an address', (from) => {
    expect(() => readMailConfig({ ...SMTP, MAIL_FROM: from })).toThrow(/MAIL_FROM/);
  });

  describe('MAIL_TRANSPORT=console (development: mails are printed, not sent)', () => {
    it('needs no SMTP and defaults the sender and the public URL to localhost', () => {
      expect(readMailConfig({ MAIL_TRANSPORT: 'console', PORT: '9000' })).toEqual(expect.objectContaining({
        transport: 'console',
        from: 'LinkSnip <no-reply@localhost>',
        publicUrl: 'http://localhost:9000'
      }));
      expect(readMailConfig({ MAIL_TRANSPORT: 'console' }).publicUrl).toBe('http://localhost:8081');
    });

    it('is refused in production', () => {
      expect(() => readMailConfig({ MAIL_TRANSPORT: 'console', NODE_ENV: 'production' })).toThrow(/MAIL_TRANSPORT/);
    });

    it('refuses an unknown transport', () => {
      expect(() => readMailConfig({ ...SMTP, MAIL_TRANSPORT: 'carrier-pigeon' })).toThrow(/MAIL_TRANSPORT/);
    });
  });
});
