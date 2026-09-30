const fs = require('fs');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { createUnlockRouter } = require('../../../routes/unlockRoutes');
const { createUnlockLimiter } = require('../../../middleware/rateLimiter');
const { checkAccess } = require('../../../services/accessService');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile
} = require('../../setup/testHelpers');

const PAST = '2000-01-01T00:00:00.000Z';
let HASH;
beforeAll(async () => { HASH = await bcrypt.hash('open sesame', 4); });

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

// One session per x-visitor header (default 'a'); X-Forwarded-For sets the IP.
function makeApp(limiterOptions) {
  const app = express();
  const sessions = {};
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const visitor = req.get('x-visitor') || 'a';
    req.session = sessions[visitor] = sessions[visitor] || {};
    req.user = null;
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.use(createUnlockRouter({ limiter: createUnlockLimiter(limiterOptions) }));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return { app, sessions };
}

let owner;
beforeEach(async () => {
  owner = await createTestUser({ username: 'owner' });
});

const MAKE = {
  url: (f = {}) => createTestUrl({ slug: 'it', password: HASH, ...f }),
  bundle: (f = {}) => createTestBundle({ slug: 'it', password: HASH, ...f }),
  paste: (f = {}) => createTestPaste(owner.id, { slug: 'it', title: 'Secret notes', password: HASH, ...f }),
  file: (f = {}) => createTestFile(owner.id, { slug: 'it', originalName: 'plans.pdf', password: HASH, ...f })
};
const PUBLIC = { url: '/s/it', bundle: '/b/it', paste: '/p/it', file: '/f/it' };
const LABEL = { url: /\/s\/it$/, bundle: 'Test Bundle', paste: 'Secret notes', file: 'plans.pdf' };

const unlock = (app, type, password, fields = {}, headers = {}) => {
  const req = request(app).post(`/unlock/${type}/it`).type('form').send({ password, ...fields });
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req;
};
const statusFor = (session, type, record) => checkAccess({ session, query: {}, user: null }, type, record).status;

describe.each(Object.keys(MAKE))('/unlock/%s/:slug', (type) => {
  it('shows one unlock page for the type', async () => {
    MAKE[type]();
    const { app } = makeApp();
    const res = await request(app).get(`/unlock/${type}/it`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ view: 'unlock', type, slug: 'it', error: null }));
    expect(res.body.label).toMatch(LABEL[type]);
    expect(res.body.canRemember).toBe(type !== 'bundle');
  });

  it('redirects to the item when it has no password', async () => {
    MAKE[type]({ password: null });
    const { app } = makeApp();
    const res = await request(app).get(`/unlock/${type}/it`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PUBLIC[type]);
  });

  it('refuses an item that is no longer available', async () => {
    MAKE[type]({ expiresAt: PAST });
    const { app } = makeApp();
    expect((await request(app).get(`/unlock/${type}/it`)).status).toBe(410);
    expect((await unlock(app, type, 'open sesame')).status).toBe(410);
  });

  it('a wrong password is a 401 with the page and an error, and unlocks nothing', async () => {
    const record = MAKE[type]();
    const { app, sessions } = makeApp();
    const res = await unlock(app, type, 'nope');

    expect(res.status).toBe(401);
    expect(res.body).toEqual(expect.objectContaining({ view: 'unlock', type, error: expect.stringMatching(/incorrect/i) }));
    expect(statusFor(sessions.a, type, record)).toBe('password_required');
  });

  it('the right password with "remember" unlocks it for the session', async () => {
    const record = MAKE[type]();
    const { app, sessions } = makeApp();
    const res = await unlock(app, type, 'open sesame', { remember: '1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(PUBLIC[type]);
    expect(sessions.a.unlocked[type]).toEqual([record.id]);
    expect(statusFor(sessions.a, type, record)).toBe('active');
    expect(statusFor(sessions.a, type, record)).toBe('active');
  });
});

describe('remembering', () => {
  it.each(['url', 'paste', 'file'])('%s without "remember" opens once', async (type) => {
    const record = MAKE[type]();
    const { app, sessions } = makeApp();
    await unlock(app, type, 'open sesame');

    expect(sessions.a.unlockOnce).toEqual({ type, id: record.id });
    expect(statusFor(sessions.a, type, record)).toBe('active');
    expect(statusFor(sessions.a, type, record)).toBe('password_required');
  });

  it('bundles are always remembered (their item links need the unlock to last)', async () => {
    const record = MAKE.bundle();
    const { app, sessions } = makeApp();
    await unlock(app, 'bundle', 'open sesame');

    expect(sessions.a.unlocked.bundle).toEqual([record.id]);
    expect(statusFor(sessions.a, 'bundle', record)).toBe('active');
    expect(statusFor(sessions.a, 'bundle', record)).toBe('active');
  });

  it('an unlock is per type: the same ID of another type stays locked', async () => {
    const url = MAKE.url();
    const paste = MAKE.paste();
    const { app, sessions } = makeApp();
    await unlock(app, 'url', 'open sesame', { remember: '1' });

    expect(url.id).toBe(paste.id);
    expect(statusFor(sessions.a, 'paste', paste)).toBe('password_required');
  });
});

describe('what is not found', () => {
  it('404s an unknown type or slug', async () => {
    MAKE.url();
    const { app } = makeApp();
    expect((await request(app).get('/unlock/nope/it')).status).toBe(404);
    expect((await request(app).get('/unlock/url/missing')).status).toBe(404);
    expect((await unlock(app, 'nope', 'x')).status).toBe(404);
  });

  it.each([['paste', 'pastes'], ['file', 'files'], ['bundle', 'bundles']])(
    '404s %s unlocks when that feature is off', async (type, feature) => {
      fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { [feature]: false } }));
      configService.reload();
      MAKE[type]();
      const { app } = makeApp();
      expect((await request(app).get(`/unlock/${type}/it`)).status).toBe(404);
      expect((await unlock(app, type, 'open sesame')).status).toBe(404);
    }
  );
});

describe('the old addresses', () => {
  it.each([
    ['/unlock/it', '/unlock/url/it'],
    ['/unlock-bundle/it', '/unlock/bundle/it'],
    ['/unlock-paste/it', '/unlock/paste/it'],
    ['/unlock-file/it', '/unlock/file/it']
  ])('%s redirects permanently to %s, for GET and POST', async (from, to) => {
    const { app } = makeApp();
    const get = await request(app).get(from);
    const post = await request(app).post(from).type('form').send({ password: 'x' });

    expect([get.status, post.status]).toEqual([308, 308]);
    expect(get.headers.location).toBe(to);
    expect(post.headers.location).toBe(to);
  });
});

describe('rate limiting (failed attempts only, separate from login)', () => {
  const failures = async (app, type, n, ip = '203.0.113.1') => {
    const statuses = [];
    for (let i = 0; i < n; i++) statuses.push((await unlock(app, type, 'nope', {}, { 'X-Forwarded-For': ip })).status);
    return statuses;
  };

  it('locks one item for a visitor after 10 wrong passwords, with the unlock page', async () => {
    MAKE.paste();
    const { app } = makeApp();

    expect(await failures(app, 'paste', 10)).toEqual(Array(10).fill(401));
    const locked = await unlock(app, 'paste', 'open sesame', {}, { 'X-Forwarded-For': '203.0.113.1' });

    expect(locked.status).toBe(429);
    expect(locked.body).toEqual(expect.objectContaining({ view: 'unlock', type: 'paste', error: expect.stringMatching(/too many/i) }));
  });

  it('does not count successful unlocks', async () => {
    MAKE.url();
    const { app } = makeApp();
    for (let i = 0; i < 15; i++) {
      expect((await unlock(app, 'url', 'open sesame', {}, { 'X-Forwarded-For': '203.0.113.1' })).status).toBe(302);
    }
  });

  it('counts per item: other items and other visitors are not locked', async () => {
    MAKE.paste();
    MAKE.file();
    const { app } = makeApp();
    await failures(app, 'paste', 11);

    expect((await unlock(app, 'file', 'nope', {}, { 'X-Forwarded-For': '203.0.113.1' })).status).toBe(401);
    expect((await unlock(app, 'paste', 'nope', {}, { 'X-Forwarded-For': '198.51.100.7' })).status).toBe(401);
  });

  it('caps a visitor at 30 wrong passwords across all items', async () => {
    const { app } = makeApp();
    const slugs = ['a1', 'a2', 'a3', 'a4'];
    for (const slug of slugs) createTestUrl({ slug, password: HASH });
    const tryUrl = (slug) => request(app).post(`/unlock/url/${slug}`).type('form')
      .send({ password: 'nope' }).set('X-Forwarded-For', '203.0.113.1');

    for (const slug of slugs.slice(0, 3)) {
      for (let i = 0; i < 10; i++) expect((await tryUrl(slug)).status).toBe(401);
    }
    expect((await tryUrl('a4')).status).toBe(429);
  });

  it('writes one audit entry per lockout, not one per blocked attempt', async () => {
    MAKE.paste();
    const { app } = makeApp();
    await failures(app, 'paste', 14);

    const entries = getTestDatabase().prepare("SELECT * FROM audit_logs WHERE action = 'UNLOCK_LOCKOUT'").all();
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe('SECURITY');
    expect(entries[0].targetDescription).toBe('/p/it');
  });

  it('does not share its count with the login limiter', async () => {
    const { authLimiter } = require('../../../middleware/rateLimiter');
    MAKE.paste();
    const { app } = makeApp();
    await failures(app, 'paste', 12);

    const login = express();
    login.post('/login', authLimiter, (req, res) => res.status(401).end());
    expect((await request(login).post('/login')).status).toBe(401);
  });
});
