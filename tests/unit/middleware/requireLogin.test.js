const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const requireLogin = require('../../../middleware/requireLogin');

/**
 * access.loginRequired: a private instance. Visitors without an account reach only what logging in needs; everything
 * else (short links, pastes, files, bundles, info pages, QR codes, bio pages, /stats share links) sends them to log
 * in first.
 */
function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}
const privateInstance = (extra = {}) => setSettings({ access: { loginRequired: true }, ...extra });

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function makeApp(user = null) {
  const app = express();
  app.use((req, res, next) => { req.user = user; next(); });
  app.use(requireLogin);
  app.all('/{*any}', (req, res) => res.json({ reached: req.path }));
  return app;
}

describe('the setting', () => {
  it('is off by default', () => {
    expect(configService.get('access.loginRequired')).toBe(false);
  });

  it('off: visitors reach everything', async () => {
    const res = await request(makeApp()).get('/s/abc');
    expect(res.body).toEqual({ reached: '/s/abc' });
  });
});

describe('a private instance', () => {
  beforeEach(() => privateInstance());

  it.each([
    '/s/abc', '/p/notes', '/p/notes/raw', '/f/doc', '/f/doc/download', '/b/kit', '/bt/3', '/info/abc',
    '/qrcode/url/abc', '/bio/alice', '/stats/sometoken', '/unlock/url/abc', '/dashboard', '/https://example.com'
  ])('sends a visitor from %s to log in, and back afterwards', async (address) => {
    const res = await request(makeApp()).get(address);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/login?next=${encodeURIComponent(address)}`);
  });

  it('the home page goes to the plain login page (then the dashboard)', async () => {
    const res = await request(makeApp()).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('keeps the query string for afterwards', async () => {
    const res = await request(makeApp()).get('/dashboard?type=paste&page=2');
    expect(res.headers.location).toBe(`/login?next=${encodeURIComponent('/dashboard?type=paste&page=2')}`);
  });

  it('API requests get 401 JSON', async () => {
    const res = await request(makeApp()).get('/api/qrcode/url/abc/dataurl');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'login_required', message: expect.any(String) });
  });

  it('a form sent by a visitor goes to the login page (no next: it was not a page)', async () => {
    const res = await request(makeApp()).post('/create').type('form').send({ longUrl: 'https://example.com' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it.each([
    ['get', '/login'], ['post', '/login'], ['get', '/register'], ['post', '/register'],
    ['get', '/setup'], ['post', '/setup'], ['get', '/logout'], ['post', '/logout']
  ])('lets a visitor %s %s', async (method, address) => {
    const res = await request(makeApp())[method](address);
    expect(res.body).toEqual({ reached: address });
  });

  it('does not let look-alike paths through', async () => {
    for (const address of ['/login-x', '/loginx', '/register/../s/abc', '/setup2']) {
      const res = await request(makeApp()).get(address);
      expect(res.status).toBe(302);
    }
  });

  it('logged-in people reach everything', async () => {
    const res = await request(makeApp({ id: 1, username: 'alice' })).get('/s/abc');
    expect(res.body).toEqual({ reached: '/s/abc' });
  });

  it('reads the switch live', async () => {
    const app = makeApp();
    expect((await request(app).get('/s/abc')).status).toBe(302);
    setSettings({ access: { loginRequired: false } });
    expect((await request(app).get('/s/abc')).status).toBe(200);
  });
});

describe('app.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../app.js'), 'utf8');
  const at = (needle) => {
    const i = source.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    return i;
  };

  it('checks right after attachUser, before any content route', () => {
    const check = at('app.use(requireLogin)');
    expect(check).toBeGreaterThan(at('app.use(attachUser)'));
    expect(check).toBeLessThan(at('app.use(prefillFromPath('));
    expect(check).toBeLessThan(at("app.use('/', authRoutes)"));
    expect(check).toBeLessThan(at("app.use('/', urlRoutes)"));
  });

  it('lets the health check, static files and branding through (they come before it)', () => {
    const check = at('app.use(requireLogin)');
    expect(at("require('./routes/healthRoutes')")).toBeLessThan(check);
    expect(at('express.static(')).toBeLessThan(check);
    expect(at("require('./routes/brandingRoutes')")).toBeLessThan(check);
    expect(at("require('./routes/vendorRoutes')")).toBeLessThan(check);
  });
});
