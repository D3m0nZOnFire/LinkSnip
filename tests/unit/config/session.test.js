const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { sessionOptions } = require('../../../config/session');

function makeApp() {
  const app = express();
  app.use(session(sessionOptions({ store: new session.MemoryStore(), secret: 'test-secret' })));
  app.get('/login', (req, res) => { req.session.userId = 1; res.send('ok'); });
  return app;
}

describe('session cookie', () => {
  it('is SameSite=Lax, HttpOnly and lasts 7 days', async () => {
    const res = await request(makeApp()).get('/login');
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('connect.sid='));

    expect(cookie).toMatch(/; SameSite=Lax/);
    expect(cookie).toMatch(/; HttpOnly/);
    const expires = Date.parse(cookie.match(/; Expires=([^;]+)/)[1]);
    expect(expires - Date.now()).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60 * 1000);
  });

  it('is Secure over HTTPS behind a proxy, and not on plain http', async () => {
    const app = makeApp();
    app.set('trust proxy', 1);

    const https = await request(app).get('/login').set('X-Forwarded-Proto', 'https');
    const http = await request(app).get('/login');

    expect(https.headers['set-cookie'][0]).toMatch(/; Secure/);
    expect(http.headers['set-cookie'][0]).not.toMatch(/; Secure/);
  });

  it('does not create sessions for visitors who store nothing', async () => {
    const app = makeApp();
    app.get('/', (req, res) => res.send('home'));
    const res = await request(app).get('/');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('app.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../app.js'), 'utf8');

  it('builds the session from config/session.js', () => {
    expect(source).toMatch(/session\(sessionOptions\(/);
  });

  it('checks cross-site requests before sessions and routes', () => {
    const at = (needle) => {
      const i = source.indexOf(needle);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const check = at('app.use(sameOrigin)');
    expect(check).toBeLessThan(at('session(sessionOptions('));
    expect(check).toBeLessThan(at("app.use('/', setupRoutes)"));
    expect(check).toBeLessThan(at("app.use('/', authRoutes)"));
  });
});
