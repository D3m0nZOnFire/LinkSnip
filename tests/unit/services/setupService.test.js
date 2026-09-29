const express = require('express');
const session = require('express-session');
const request = require('supertest');
const setupService = require('../../../services/setupService');
const requireSetupComplete = require('../../../middleware/requireSetupComplete');
const User = require('../../../models/User');
const { createTestUser } = require('../../setup/testHelpers');

const quiet = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

beforeEach(() => {
  setupService.reset();
  quiet.log.mockClear();
});

const validForm = (code) => ({ code, username: 'root', password: 'longenough', confirmPassword: 'longenough' });

describe('setupService', () => {
  describe('needsSetup', () => {
    it('is true while no admin exists', async () => {
      await createTestUser({ username: 'regular', isAdmin: 0 });
      expect(setupService.needsSetup()).toBe(true);
    });

    it('is false once an admin exists (e.g. a restored backup)', async () => {
      await createTestUser({ username: 'boss', isAdmin: 1 });
      expect(setupService.needsSetup()).toBe(false);
    });

    it('notices an admin created elsewhere (the CLI) while running', async () => {
      expect(setupService.needsSetup()).toBe(true);
      await createTestUser({ username: 'boss', isAdmin: 1 });
      expect(setupService.needsSetup()).toBe(false);
    });
  });

  describe('start', () => {
    it('generates a code and writes it to the log when setup is needed', () => {
      const code = setupService.start(quiet);

      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(quiet.log.mock.calls.flat().join('\n')).toContain(code);
    });

    it('generates a different code each start', () => {
      const first = setupService.start(quiet);
      setupService.reset();
      expect(setupService.start(quiet)).not.toBe(first);
    });

    it('does nothing once an admin exists', async () => {
      await createTestUser({ username: 'boss', isAdmin: 1 });
      expect(setupService.start(quiet)).toBeNull();
      expect(quiet.log).not.toHaveBeenCalled();
    });
  });

  describe('checkCode', () => {
    it('accepts the code regardless of case, spaces and dashes', () => {
      const code = setupService.start(quiet);
      expect(setupService.checkCode(code)).toBe(true);
      expect(setupService.checkCode(code.toLowerCase().replace(/-/g, ' '))).toBe(true);
    });

    it('rejects a wrong or missing code', () => {
      setupService.start(quiet);
      expect(setupService.checkCode('AAAA-AAAA-AAAA')).toBe(false);
      expect(setupService.checkCode('')).toBe(false);
      expect(setupService.checkCode(undefined)).toBe(false);
    });

    it('rejects everything when no code was generated', () => {
      expect(setupService.checkCode('AAAA-AAAA-AAAA')).toBe(false);
    });
  });

  describe('createFirstAdmin', () => {
    it('creates an admin with the right code', async () => {
      const code = setupService.start(quiet);

      const user = await setupService.createFirstAdmin(validForm(code));

      expect(user.isAdmin).toBe(1);
      expect(await User.verifyPassword('longenough', User.findByUsername('root').password)).toBe(true);
      expect(setupService.needsSetup()).toBe(false);
    });

    it('rejects a wrong code without creating anyone', async () => {
      setupService.start(quiet);

      await expect(setupService.createFirstAdmin(validForm('AAAA-AAAA-AAAA'))).rejects.toThrow(/code/i);
      expect(User.findByUsername('root')).toBeUndefined();
    });

    it.each([
      [{ username: '' }, /username/i],
      [{ password: 'short', confirmPassword: 'short' }, /8 characters/],
      [{ confirmPassword: 'different1' }, /match/i]
    ])('validates the form %o', async (override, message) => {
      const code = setupService.start(quiet);
      await expect(setupService.createFirstAdmin({ ...validForm(code), ...override })).rejects.toThrow(message);
      expect(setupService.needsSetup()).toBe(true);
    });

    it('works only once: the code is used up', async () => {
      const code = setupService.start(quiet);
      await setupService.createFirstAdmin(validForm(code));

      await expect(setupService.createFirstAdmin({ ...validForm(code), username: 'second' }))
        .rejects.toThrow(/already/i);
      expect(User.findByUsername('second')).toBeUndefined();
    });

    it('refuses when an admin appeared after the code was issued', async () => {
      const code = setupService.start(quiet);
      await createTestUser({ username: 'boss', isAdmin: 1 });

      await expect(setupService.createFirstAdmin(validForm(code))).rejects.toThrow(/already/i);
    });
  });
});

describe('setup flow over HTTP', () => {
  function makeApp() {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
    app.use((req, res, next) => {
      res.render = (view, data) => res.json({ view, ...data });
      next();
    });
    app.use(requireSetupComplete);
    app.use(require('../../../routes/setupRoutes'));
    app.get('/', (req, res) => res.json({ home: true, userId: req.session.userId || null }));
    app.get('/api/thing', (req, res) => res.json({ ok: true }));
    app.use((req, res) => res.status(404).json({ notFound: true }));
    return app;
  }

  it('redirects every page to /setup while no admin exists', async () => {
    setupService.start(quiet);
    const res = await request(makeApp()).get('/').set('Accept', 'text/html');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('answers API calls with 503 setup_required', async () => {
    setupService.start(quiet);
    const res = await request(makeApp()).get('/api/thing').set('Accept', 'application/json');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('setup_required');
  });

  it('shows the setup form', async () => {
    setupService.start(quiet);
    const res = await request(makeApp()).get('/setup');

    expect(res.status).toBe(200);
    expect(res.body.view).toBe('setup');
  });

  it('rejects a wrong code and keeps redirecting', async () => {
    setupService.start(quiet);
    const app = makeApp();

    const res = await request(app).post('/setup').type('form').send(validForm('AAAA-AAAA-AAAA'));

    expect(res.status).toBe(400);
    expect(res.body.view).toBe('setup');
    expect(res.body.error).toMatch(/code/i);
    expect(res.body.username).toBe('root');
    expect((await request(app).get('/').set('Accept', 'text/html')).status).toBe(302);
  });

  it('creates the admin, logs them in, then /setup is 404 for good', async () => {
    const code = setupService.start(quiet);
    const agent = request.agent(makeApp());

    const res = await agent.post('/setup').type('form').send(validForm(code));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/admin/settings');

    const home = await agent.get('/').set('Accept', 'text/html');
    expect(home.status).toBe(200);
    expect(home.body.userId).toBe(User.findByUsername('root').id);

    expect((await agent.get('/setup')).status).toBe(404);
    expect((await agent.post('/setup').type('form').send(validForm(code))).status).toBe(404);
  });

  it('is 404 from the start when an admin already exists', async () => {
    await createTestUser({ username: 'boss', isAdmin: 1 });
    setupService.start(quiet);
    const app = makeApp();

    expect((await request(app).get('/setup')).status).toBe(404);
    expect((await request(app).get('/').set('Accept', 'text/html')).status).toBe(200);
  });
});
