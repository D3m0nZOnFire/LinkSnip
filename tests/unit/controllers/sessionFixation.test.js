const express = require('express');
const session = require('express-session');
const request = require('supertest');
const AuthController = require('../../../controllers/authController');
const setupService = require('../../../services/setupService');
const User = require('../../../models/User');
const { createTestUser } = require('../../setup/testHelpers');

// Session fixation: a session ID known before logging in (planted by someone else, or read on a shared computer)
// must not become a logged-in session. Login, registration and setup start a fresh session.

const quiet = { log: () => {} };

function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.get('/plant', (req, res) => {
    req.session.planted = true;
    res.json({ ok: true });
  });
  app.get('/whoami', (req, res) => res.json({ userId: req.session.userId || null, planted: !!req.session.planted }));
  app.use(require('../../../routes/setupRoutes'));
  app.post('/login', AuthController.postLogin);
  app.post('/register', AuthController.postRegister);
  return app;
}

const sid = (res) => (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));

async function expectFreshSession(app, send) {
  const planted = await request(app).get('/plant');
  const oldCookie = sid(planted);
  expect(oldCookie).toBeTruthy();

  const res = await send(oldCookie);
  expect(res.status).toBe(302);
  const newCookie = sid(res);
  expect(newCookie).toBeTruthy();
  expect(newCookie).not.toBe(oldCookie);

  const old = await request(app).get('/whoami').set('Cookie', oldCookie);
  expect(old.body.userId).toBeNull();

  const fresh = await request(app).get('/whoami').set('Cookie', newCookie);
  expect(fresh.body.userId).toEqual(expect.any(Number));
  expect(fresh.body.planted).toBe(false);
}

describe('a new session ID after logging in', () => {
  it('login', async () => {
    await createTestUser({ username: 'alice', password: 'password123' });
    const app = makeApp();
    await expectFreshSession(app, (cookie) =>
      request(app).post('/login').set('Cookie', cookie).type('form').send({ username: 'alice', password: 'password123' }));
  });

  it('a failed login keeps the session as it is', async () => {
    await createTestUser({ username: 'alice', password: 'password123' });
    const app = makeApp();
    const cookie = sid(await request(app).get('/plant'));

    const res = await request(app).post('/login').set('Cookie', cookie).type('form').send({ username: 'alice', password: 'wrong-one' });
    expect(res.body.view).toBe('login');
    expect((await request(app).get('/whoami').set('Cookie', cookie)).body).toEqual({ userId: null, planted: true });
  });

  it('registration', async () => {
    const app = makeApp();
    await expectFreshSession(app, (cookie) =>
      request(app).post('/register').set('Cookie', cookie).type('form')
        .send({ username: 'newbie', email: '', password: 'password123', confirmPassword: 'password123' }));
    expect(User.findByUsername('newbie')).toBeTruthy();
  });

  it('setup', async () => {
    const code = setupService.start(quiet);
    const app = makeApp();
    await expectFreshSession(app, (cookie) =>
      request(app).post('/setup').set('Cookie', cookie).type('form')
        .send({ code, username: 'root', password: 'password123', confirmPassword: 'password123' }));
  });
});
