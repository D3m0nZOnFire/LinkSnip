const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { createTestUser } = require('../../setup/testHelpers');

// Logging out changes something, so it's a POST: another site can't log you out (middleware/sameOrigin.js refuses
// cross-site POSTs) and a prefetched or scanned link can't either. GET /logout asks first, for old bookmarks.

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.get('/as/:id', (req, res) => {
    req.session.userId = Number(req.params.id);
    res.json({ ok: true });
  });
  app.get('/whoami', (req, res) => res.json({ userId: req.session.userId || null }));
  app.use(require('../../../middleware/auth').attachUser);
  app.use(require('../../../routes/authRoutes'));
  return app;
}

async function loggedIn(app) {
  const user = await createTestUser({ username: 'alice' });
  const res = await request(app).get(`/as/${user.id}`);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('logout', () => {
  it('POST /logout ends the session and goes to the login page', async () => {
    const app = makeApp();
    const cookie = await loggedIn(app);

    const res = await request(app).post('/logout').set('Cookie', cookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
    expect((await request(app).get('/whoami').set('Cookie', cookie)).body.userId).toBeNull();
  });

  it('GET /logout only asks: the session stays', async () => {
    const app = makeApp();
    const cookie = await loggedIn(app);

    const res = await request(app).get('/logout').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.view).toBe('logout');
    expect((await request(app).get('/whoami').set('Cookie', cookie)).body.userId).not.toBeNull();
  });

  it('GET /logout without a session goes to the login page', async () => {
    const res = await request(makeApp()).get('/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('POST /logout without a session goes to the login page too', async () => {
    const res = await request(makeApp()).post('/logout');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
