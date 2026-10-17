const request = require('supertest');
const setupService = require('../../services/setupService');
const { createApp } = require('../../createApp');
const { createTestUser } = require('../setup/testHelpers');

// The real app, for the CodeQL fixes that are about routing and rate limits.

const app = createApp({ sessionSecret: 'code-scanning-test-secret-'.padEnd(64, 'x') });
const sameSite = { 'Sec-Fetch-Site': 'same-origin' };

async function loggedIn(username, extra = {}) {
  await createTestUser({ username, ...extra });
  const agent = request.agent(app);
  await agent.post('/login').set(sameSite).type('form').send({ username, password: 'password123' });
  return agent;
}

beforeEach(async () => {
  setupService.reset();
  await createTestUser({ username: 'boss', isAdmin: 1 });
});

describe('a type name that is only an Object property is a 404, not a crash', () => {
  it.each(['/unlock/constructor/abc', '/qrcode/constructor/abc'])('GET %s', async (address) => {
    const res = await request(app).get(address);
    expect(res.status).toBe(404);
  });

  it('GET /analytics/__proto__/1, logged in (visitors are sent to log in first)', async () => {
    const agent = await loggedIn('viewer');
    expect((await agent.get('/analytics/__proto__/1')).status).toBe(404);
  });

  it('POST /api/reports with type "constructor"', async () => {
    const res = await request(app).post('/api/reports').set(sameSite).send({ type: 'constructor', id: 1, reason: 'spam' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('an admin action on type "constructor"', async () => {
    const admin = request.agent(app);
    await admin.post('/login').set(sameSite).type('form').send({ username: 'boss', password: 'password123' });
    const res = await admin.post('/api/admin/constructor/1/block').set(sameSite);
    expect(res.status).toBe(404);
  });
});

describe('checks of the current password are limited like logins', () => {
  it.each([
    ['put', '/api/user/password', { currentPassword: 'wrong-guess', newPassword: 'a-new-password' }, '203.0.113.1'],
    ['put', '/api/user/username', { currentPassword: 'wrong-guess', newUsername: 'someone' }, '203.0.113.2'],
    ['delete', '/api/user/account', { password: 'wrong-guess' }, '203.0.113.3']
  ])('%s %s: wrong guesses are cut off', async (method, address, body, ip) => {
    // The login limiter counts per address, across logins and these routes: one address per case
    const from = { ...sameSite, 'X-Forwarded-For': ip };
    const agent = await loggedIn(`user${ip.split('.').pop()}`);
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await agent[method](address).set(from).send(body)).status);
    expect(statuses.slice(0, 10).every(s => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('the global per-visitor limit', () => {
  it('applies to pages and the API', async () => {
    for (const address of ['/login', '/b/nothing', '/f/nothing/download', '/branding/logo']) {
      const res = await request(app).get(address);
      expect([address, res.headers['ratelimit-policy']]).toEqual([address, expect.stringMatching(/^1000;w=300/)]);
    }
  });

  it('not to the health check or static files', async () => {
    for (const address of ['/healthz', '/css/main.css']) {
      expect([address, (await request(app).get(address)).headers['ratelimit-policy']]).toEqual([address, undefined]);
    }
  });
});
