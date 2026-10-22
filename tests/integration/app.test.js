const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const { createApp } = require('../../createApp');
const { createTestUser } = require('../setup/testHelpers');

// The real app as createApp() builds it: every middleware in its real order, the real routers and views.
// Only the session store differs (in memory) and nothing listens or schedules.

const SECRET = 'integration-test-session-secret-'.padEnd(64, 'x');
const app = () => createApp({ sessionSecret: SECRET });

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}

beforeEach(() => setupService.reset());
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

const sameSite = { 'Sec-Fetch-Site': 'same-origin' };

async function loggedIn(user) {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username: user.username, password: 'password123' });
  expect(res.status).toBe(302);
  return agent;
}

describe('before the first admin exists', () => {
  it('sends every page to /setup', async () => {
    const res = await request(app()).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/setup');
  });

  it('still serves the health check and static files (the setup page needs its styles)', async () => {
    expect((await request(app()).get('/healthz')).status).toBe(200);
    expect((await request(app()).get('/css/main.css')).status).toBe(200);
  });
});

describe('with an admin', () => {
  let admin;
  beforeEach(async () => { admin = await createTestUser({ username: 'boss', isAdmin: 1 }); });

  describe('security headers', () => {
    it.each(['/healthz', '/css/main.css', '/login', '/no-such-page'])('%s has the CSP and no X-Powered-By', async (address) => {
      const res = await request(app()).get(address);
      expect(res.headers['content-security-policy']).toMatch(/script-src 'self';/);
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('a bio page gets the wider policy for its icons', async () => {
      const res = await request(app()).get(`/bio/${admin.username}`);
      expect(res.headers['content-security-policy']).toContain('https://unpkg.com/ionicons@7.1.0/');
    });
  });

  describe('cross-site requests', () => {
    it('are refused before any session is read or created', async () => {
      const res = await request(app()).post('/login')
        .set('Sec-Fetch-Site', 'cross-site').type('form').send({ username: 'boss', password: 'password123' });
      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('logging in', () => {
    it('sets an HttpOnly, SameSite=Lax session cookie that opens the dashboard', async () => {
      const agent = request.agent(app());
      const login = await agent.post('/login').set(sameSite).type('form').send({ username: 'boss', password: 'password123' });
      expect(login.status).toBe(302);
      const cookie = login.headers['set-cookie'].join(';');
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);

      const dashboard = await agent.get('/dashboard');
      expect(dashboard.status).toBe(200);
      expect(dashboard.text).toContain('Dashboard');
    });
  });

  describe('a private instance (access.loginRequired)', () => {
    beforeEach(() => setSettings({ access: { loginRequired: true } }));

    it('sends visitors to log in, keeping where they were going', async () => {
      const res = await request(app()).get('/info/abc');
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login?next=%2Finfo%2Fabc');
    });

    it('lets the health check, static files, branding and Chart.js through', async () => {
      for (const address of ['/healthz', '/css/main.css', '/theme.css', '/vendor/chart.umd.js', '/login']) {
        expect([address, (await request(app()).get(address)).status]).toEqual([address, 200]);
      }
    });
  });

  describe('feature switches', () => {
    it('a switched-off feature is a 404, also for an admin', async () => {
      setSettings({ features: { analytics: false } });
      const agent = await loggedIn(admin);
      const res = await agent.get('/analytics/url/1');
      expect(res.status).toBe(404);
    });
  });

  describe('the end of the chain', () => {
    it('an unknown page renders the 404 page', async () => {
      const res = await request(app()).get('/no-such-page');
      expect(res.status).toBe(404);
      expect(res.text).toContain('Page Not Found');
    });

    it('a file name a scanner probes for is a 404, not the create page', async () => {
      for (const address of ['/xmlrpc.php', '/wp-login.php', '/index.html']) {
        expect([address, (await request(app()).get(address)).status]).toEqual([address, 404]);
        expect([address, (await request(app()).post(address)).status]).toEqual([address, 404]);
      }
    });

    it('a link in the path opens the create page with it filled in', async () => {
      const res = await request(app()).get('/https://example.com/some/page');
      expect(res.status).toBe(200);
      expect(res.text).toContain('https://example.com/some/page');
    });
  });
});

describe('createApp()', () => {
  it('needs the session secret', () => {
    expect(() => createApp({})).toThrow(/sessionSecret/);
  });
});
