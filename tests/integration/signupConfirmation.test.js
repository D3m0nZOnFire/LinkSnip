const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const mailService = require('../../services/mailService');
const ScheduledTasks = require('../../services/scheduledTasks');
const { createApp } = require('../../createApp');
const { getTestDatabase } = require('../setup/testDatabase');
const { createTestUser } = require('../setup/testHelpers');

// Sign-up with mail set up: an email address is required, the account waits until the link sent to it is opened,
// and it can't log in before that. Without mail, registration stays as it was (address optional, no waiting).

const SECRET = 'integration-test-session-secret-'.padEnd(64, 'x');
const app = () => createApp({ sessionSecret: SECRET });
const sameSite = { 'Sec-Fetch-Site': 'same-origin' };
const db = () => getTestDatabase();

const MAIL = {
  transport: 'smtp', host: 'mail.example.com', port: 465, secure: true, user: 'u', pass: 'p',
  from: 'LinkSnip <no-reply@example.com>', replyTo: null, publicUrl: 'https://links.example.com'
};
let transport;
const sent = () => transport.sendMail.mock.calls.map(([mail]) => mail);
const linkIn = (mail) => mail.text.match(/https:\/\/links\.example\.com(\/verify-email\/[A-Za-z0-9_-]+)/)[1];
const account = (username) => db().prepare('SELECT * FROM users WHERE username = ?').get(username);

const register = (agent, fields = {}) => agent.post('/register').set(sameSite).type('form').send({
  username: 'newbie', email: 'newbie@example.com', password: 'password123', confirmPassword: 'password123', ...fields
});
const login = (agent, username = 'newbie', password = 'password123') =>
  agent.post('/login').set(sameSite).type('form').send({ username, password });

beforeEach(async () => {
  setupService.reset();
  transport = { sendMail: jest.fn(async () => ({})) };
  mailService.configure(MAIL, { transport });
  await createTestUser({ username: 'boss', isAdmin: 1, email: null });
});
afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('registering while mail is set up', () => {
  it('asks for the address on the form', async () => {
    const page = await request(app()).get('/register');
    expect(page.text).toMatch(/<input type="email" id="email" name="email"[^>]* required/);
    expect(page.text).not.toMatch(/optional/);
    expect(page.text).not.toMatch(/get a link/);
  });

  it('refuses to register without an address', async () => {
    const res = await register(request(app()), { email: '' });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Enter your email address/);
    expect(account('newbie')).toBeUndefined();
  });

  it('creates the account waiting for confirmation, mails the link and logs nobody in', async () => {
    const agent = request.agent(app());
    const res = await register(agent);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Check your inbox/);
    expect(res.text).toContain('newbie@example.com');

    expect(account('newbie')).toEqual(expect.objectContaining({ pendingConfirmation: 1, emailVerifiedAt: null }));
    expect(sent().map(m => m.to)).toEqual(['newbie@example.com']);
    expect((await agent.get('/dashboard')).status).toBe(302); // not logged in
  });

  it("can't log in before the link is opened (the page offers to send it again)", async () => {
    await register(request(app()));
    const agent = request.agent(app());
    const res = await login(agent);
    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Check your inbox/);
    expect(res.text).toContain('id="resendSignupLink"');
    expect((await agent.get('/dashboard')).status).toBe(302);
  });

  it('a wrong password still says only "invalid", not that the account waits', async () => {
    await register(request(app()));
    const res = await login(request(app()), 'newbie', 'wrong-password');
    expect(res.text).toMatch(/Invalid username or password/);
    expect(res.text).not.toMatch(/Check your inbox/);
  });

  it('after the link is confirmed, the account logs in normally', async () => {
    await register(request(app()));
    const link = linkIn(sent()[0]);
    expect((await request(app()).post(link).set(sameSite)).status).toBe(200);

    expect(account('newbie')).toEqual(expect.objectContaining({ pendingConfirmation: 0 }));
    expect(account('newbie').emailVerifiedAt).not.toBeNull();
    const res = await login(request.agent(app()));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('confirming the sign-up logs the account in on that browser (no second login)', async () => {
    await register(request(app()));
    const browser = request.agent(app());
    const page = await browser.post(linkIn(sent()[0])).set(sameSite);
    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/dashboard"');
    expect((await browser.get('/settings')).status).toBe(200);
  });

  it('confirming a changed address (not a sign-up) logs nobody in', async () => {
    const ann = await createTestUser({ username: 'ann', email: null });
    const owner = request.agent(app());
    await login(owner, 'ann');
    await owner.put('/api/user/email').set(sameSite).send({ email: 'ann@example.com', currentPassword: 'password123' });
    const browser = request.agent(app());
    await browser.post(linkIn(sent().at(-1))).set(sameSite);
    expect((await browser.get('/settings')).status).toBe(302);
    expect(ann).toBeDefined();
  });

  it('refuses an address another account already confirmed (ignoring case)', async () => {
    const other = await createTestUser({ username: 'other', email: null });
    db().prepare("UPDATE users SET email = 'taken@example.com', emailVerifiedAt = '2026-01-01' WHERE id = ?").run(other.id);
    const res = await register(request(app()), { email: 'TAKEN@example.com' });
    expect(res.text).toMatch(/already used by another account/);
    expect(account('newbie')).toBeUndefined();
  });

  describe('sending the link again (POST /register/resend)', () => {
    const resend = (username) => request(app()).post('/register/resend').set(sameSite).type('form').send({ username });

    it('sends a new link to a waiting account, at most 3 an hour (the sign-up mail counts)', async () => {
      await register(request(app()));
      for (let i = 0; i < 3; i++) {
        const res = await resend('newbie');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/If .*newbie.* is waiting for confirmation/);
      }
      expect(sent()).toHaveLength(3);
    });

    it('answers the same for an unknown or already confirmed account, and sends nothing', async () => {
      const unknown = await resend('nobody');
      const confirmed = await resend('boss');
      expect(unknown.status).toBe(200);
      expect(confirmed.status).toBe(200);
      expect(unknown.text.replace(/nobody/g, 'X')).toBe(confirmed.text.replace(/boss/g, 'X'));
      expect(sent()).toHaveLength(0);
    });

    it('is open on a private instance', async () => {
      fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ access: { loginRequired: true } }));
      configService.reload();
      expect((await resend('nobody')).status).toBe(200);
    });
  });

  it('accounts that never confirmed are deleted after 7 days, confirmed and older accounts stay', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await register(request(app()));
    await register(request(app()), { username: 'fresh', email: 'fresh@example.com' });
    const old = await createTestUser({ username: 'oldtimer', email: null }); // from before: not waiting
    db().prepare("UPDATE users SET createdAt = datetime('now', '-8 days') WHERE username IN ('newbie', 'oldtimer')").run();

    ScheduledTasks.cleanupUnconfirmedAccounts();

    expect(account('newbie')).toBeUndefined();
    expect(account('fresh')).toBeDefined();
    expect(account('oldtimer')).toEqual(expect.objectContaining({ id: old.id }));
    log.mockRestore();
  });
});

describe('without mail', () => {
  beforeEach(() => mailService.configure(null));

  it('keeps the address optional and logs the new account in', async () => {
    const page = await request(app()).get('/register');
    expect(page.text).not.toMatch(/<input type="email" id="email" name="email"[^>]* required/);

    const agent = request.agent(app());
    const res = await register(agent, { email: '' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    expect(account('newbie').pendingConfirmation).toBe(0);
  });

  it('an account left waiting (mail switched off since) can log in', async () => {
    mailService.configure(MAIL, { transport });
    await register(request(app()));
    mailService.configure(null);
    expect((await login(request.agent(app()))).status).toBe(302);
  });
});

describe('accounts an admin creates', () => {
  it("don't wait for confirmation", async () => {
    const agent = request.agent(app());
    await login(agent, 'boss');
    const res = await agent.post('/api/admin/users').set(sameSite)
      .send({ username: 'made', email: 'made@example.com', password: 'password123' });
    expect(res.status).toBe(201);
    expect(account('made').pendingConfirmation).toBe(0);
    expect((await login(request.agent(app()), 'made')).status).toBe(302);
  });
});
