const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const AnalyticsService = require('../../../services/analyticsService');
const ReportController = require('../../../controllers/reportController');
const AdminController = require('../../../controllers/adminController');
const User = require('../../../models/User');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  jest.restoreAllMocks();
});

// Mounts routers the way app.js does, behind a fake session and the app's final 404.
function appWith(mount) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    const user = req.get('x-user') ? JSON.parse(req.get('x-user')) : null;
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, ...data }); // no view engine in tests
    next();
  });
  mount(app);
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

const admin = JSON.stringify({ id: 1, isAdmin: 1 });

describe('feature switches on real routes', () => {
  const pasteApp = () => appWith(app => app.use('/', featureRoutes('pastes', require('../../../routes/pasteRoutes'))));

  it('404s every paste route when pastes are off, admins included', async () => {
    setSettings({ features: { pastes: false } });
    const app = pasteApp();

    for (const [method, path] of [['post', '/api/pastes'], ['get', '/p/abc'], ['get', '/p/abc/raw'], ['get', '/admin/pastes']]) {
      const res = await request(app)[method](path).set('x-user', admin);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });

  it('serves paste routes when pastes are on', async () => {
    const res = await request(pasteApp()).post('/api/pastes').send({ content: '' });
    expect(res.status).toBe(400); // reached the controller's validation
  });

  it('404s paste QR codes when qrCodes are off, while pastes stay up', async () => {
    const owner = await createTestUser({ username: 'qrowner' });
    getTestDatabase().prepare("INSERT INTO pastes (slug, content, userId) VALUES ('abc', 'hi', ?)").run(owner.id);
    setSettings({ features: { qrCodes: false } });
    const app = appWith(a => {
      a.use('/', featureRoutes('pastes', require('../../../routes/pasteRoutes')));
      a.use('/', featureRoutes('qrCodes', require('../../../routes/qrcodeRoutes')));
    });

    expect((await request(app).get('/qrcode/paste/abc')).status).toBe(404);
    expect((await request(app).get('/api/qrcode/paste/abc/dataurl')).status).toBe(404);
    expect((await request(app).post('/api/pastes').send({ content: '' })).status).toBe(400);
  });

  it('404s bundle reports and admin bundle blocking when bundles are off', async () => {
    setSettings({ features: { bundles: false } });
    const app = appWith(a => {
      a.use('/', require('../../../routes/adminRoutes'));
      a.use('/', featureRoutes('reports', require('../../../routes/reportRoutes')));
    });

    const bundle = createTestBundle({ slug: 'bb' });
    expect((await request(app).post('/api/reports').send({ type: 'bundle', id: bundle.id, reason: 'SPAM' })).status).toBe(404);
    expect((await request(app).post('/api/admin/bundles/1/block').set('x-user', admin)).status).toBe(404);
  });

  it('404s link reports when reports are off', async () => {
    setSettings({ features: { reports: false } });
    const app = appWith(a => a.use('/', featureRoutes('reports', require('../../../routes/reportRoutes'))));

    const url = createTestUrl({ slug: 'uu' });
    expect((await request(app).post('/api/reports').send({ type: 'url', id: url.id, reason: 'SPAM' })).status).toBe(404);
  });
});

describe('registration.open', () => {
  const authApp = () => appWith(app => app.use('/', require('../../../routes/authRoutes')));

  it('serves /register while registration is open', async () => {
    const res = await request(authApp()).get('/register');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('register');
  });

  it('404s /register when registration is closed, for everyone', async () => {
    setSettings({ registration: { open: false } });
    const app = authApp();

    expect((await request(app).get('/register')).status).toBe(404);
    expect((await request(app).post('/register').send({ username: 'x', password: 'secret12', confirmPassword: 'secret12' })).status).toBe(404);
    expect((await request(app).get('/register').set('x-user', admin)).status).toBe(404);
    expect(User.findByUsername('x')).toBeUndefined();
  });

  describe('admins create accounts (POST /api/admin/users)', () => {
    function createReq(body) {
      return createMockRequest({ body, user: { id: 1, isAdmin: 1 }, session: { userId: 1, isAdmin: true }, get: () => undefined });
    }

    it('creates a user with a role, even while registration is closed', async () => {
      setSettings({ registration: { open: false } });
      await createTestUser({ username: 'boss', isAdmin: 1 });
      const res = createMockResponse();

      await AdminController.createUser(createReq({ username: 'newbie', password: 'secret12', role: 'trusted' }), res);

      expect(res.statusCode).toBe(201);
      const created = User.findByUsername('newbie');
      expect(created.role).toBe('trusted');
      expect(created.isAdmin).toBe(0);
      const audit = getTestDatabase().prepare("SELECT action FROM audit_logs WHERE action = 'CREATE_USER'").get();
      expect(audit).toBeDefined();
    });

    it('stores no role when none is given (follows defaultRole)', async () => {
      const res = createMockResponse();
      await AdminController.createUser(createReq({ username: 'plain', password: 'secret12' }), res);
      expect(User.findByUsername('plain').role).toBeNull();
    });

    it('rejects an unknown role, a short password and a taken username', async () => {
      await createTestUser({ username: 'taken' });
      for (const body of [
        { username: 'a', password: 'secret12', role: 'ghost' },
        { username: 'b', password: '123' },
        { username: 'taken', password: 'secret12' }
      ]) {
        const res = createMockResponse();
        await AdminController.createUser(createReq(body), res);
        expect(res.statusCode).toBe(400);
      }
    });
  });
});

describe('geo.enabled', () => {
  it('looks up countries by default', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ country: 'Portugal' }) });

    expect(await AnalyticsService.getCountryFromIp('8.8.8.8')).toBe('Portugal');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('never contacts ip-api.com when disabled', async () => {
    setSettings({ geo: { enabled: false } });
    const fetchSpy = jest.spyOn(global, 'fetch');

    expect(await AnalyticsService.getCountryFromIp('8.8.8.8')).toBe('Unknown');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('moderation.reportThreshold', () => {
  async function reportFromIps(urlId, n) {
    let res;
    for (let i = 1; i <= n; i++) {
      res = createMockResponse();
      ReportController.submit(createMockRequest({ body: { type: 'url', id: urlId, reason: 'SPAM' }, ip: `203.0.113.${i}`, get: () => undefined }), res);
    }
    return res;
  }

  // Spec change (PLAN 1.6): reaching the threshold quarantines the link instead of blocking it.
  const isQuarantined = (id) => getTestDatabase().prepare('SELECT isQuarantined FROM urls WHERE id = ?').get(id).isQuarantined;

  it('acts at the configured number of distinct reporters', async () => {
    setSettings({ moderation: { reportThreshold: 2 } });
    const url = createTestUrl({ slug: 'bad' });

    await reportFromIps(url.id, 1);
    expect(isQuarantined(url.id)).toBe(0);

    const res = await reportFromIps(url.id, 2); // .1 is a duplicate, .2 is the second reporter
    expect(res._jsonData.quarantined).toBe(true);
    expect(isQuarantined(url.id)).toBe(1);
  });

  it('defaults to 3', async () => {
    const url = createTestUrl({ slug: 'bad' });

    await reportFromIps(url.id, 2);
    expect(isQuarantined(url.id)).toBe(0);
    await reportFromIps(url.id, 3); // ips .1 and .2 are duplicates, .3 is new
    expect(isQuarantined(url.id)).toBe(1);
  });

  it('never acts automatically at 0, but still collects reports', async () => {
    setSettings({ moderation: { reportThreshold: 0 } });
    const url = createTestUrl({ slug: 'bad' });

    const res = await reportFromIps(url.id, 6);

    expect(res._jsonData.quarantined).toBe(false);
    expect(isQuarantined(url.id)).toBe(0);
    expect(getTestDatabase().prepare('SELECT COUNT(*) AS n FROM reports').get().n).toBe(6);
  });
});
