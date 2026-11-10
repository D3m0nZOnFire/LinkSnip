const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const mailService = require('../../services/mailService');
const UserToken = require('../../models/UserToken');
const { createApp } = require('../../createApp');
const { getTestDatabase } = require('../setup/testDatabase');
const { createTestUser } = require('../setup/testHelpers');

// Forgot password: a link by mail, only to a confirmed address. The form answers the same whatever was typed, the link
// works once for 30 minutes, opening it doesn't use it up, and a new password logs out every other session (as does
// changing it in Settings or an admin setting it).

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
const resetLinkIn = (mail) => mail.text.match(/https:\/\/links\.example\.com(\/reset-password\/[A-Za-z0-9_-]+)/)[1];
const auditActions = () => db().prepare('SELECT action FROM audit_logs ORDER BY id').all().map(r => r.action);
const confirm = (id, email) => db().prepare("UPDATE users SET email = ?, emailVerifiedAt = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(email, id);

async function loggedIn(username, password = 'password123') {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username, password });
  expect(res.status).toBe(302);
  return agent;
}
const isLoggedIn = async (agent) => (await agent.get('/settings')).status === 200;
// The form's limiter (5 per 15 minutes per IP) lives as long as this file: each test gets its own visitor IP
let testIp = 0;
beforeEach(() => { testIp += 1; });
const forgot = (identifier, agent = request(app())) => agent.post('/forgot-password').set(sameSite)
  .set('X-Forwarded-For', `10.9.0.${testIp}`).type('form').send({ identifier });
const reset = (link, password, confirmPassword = password, agent = request(app())) =>
  agent.post(link).set(sameSite).type('form').send({ password, confirmPassword });

let ann;
beforeEach(async () => {
  setupService.reset();
  transport = { sendMail: jest.fn(async () => ({})) };
  mailService.configure(MAIL, { transport });
  await createTestUser({ username: 'boss', isAdmin: 1, email: null });
  ann = await createTestUser({ username: 'ann', email: null });
  confirm(ann.id, 'ann@example.com');
});
afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('the login page', () => {
  it('links to "Forgot password?" when mail is set up, not otherwise', async () => {
    expect((await request(app()).get('/login')).text).toContain('href="/forgot-password"');
    mailService.configure(null);
    expect((await request(app()).get('/login')).text).not.toContain('href="/forgot-password"');
  });
});

describe('asking for a link (POST /forgot-password)', () => {
  it('mails a link built from PUBLIC_URL to the confirmed address, by username or by address (any case)', async () => {
    for (const identifier of ['ann', 'ANN@example.com']) {
      transport.sendMail.mockClear();
      const res = await forgot(identifier).set('Host', 'evil.example');
      expect(res.status).toBe(200);
      const [mail] = sent();
      expect(mail.to).toBe('ann@example.com');
      expect(mail.subject).toMatch(/Reset your password/);
      expect(mail.text).toContain('https://links.example.com/reset-password/');
      expect(mail.text).not.toContain('evil.example');
      expect(mail.text).toMatch(/30 minutes/);
    }
    expect(auditActions()).toContain('PASSWORD_RESET_REQUEST');
  });

  it('answers with the same page whatever was typed, and sends nothing when it cannot', async () => {
    const banned = await createTestUser({ username: 'bad', isBanned: 1, email: null });
    confirm(banned.id, 'bad@example.com');
    const unconfirmed = await createTestUser({ username: 'unc', email: 'unc@example.com' });
    const answers = [];
    for (const identifier of ['ann', 'nobody', 'nobody@example.com', 'unc', 'unc@example.com', 'bad', '']) {
      testIp += 100; // not the visitor limit
      const res = await forgot(identifier);
      expect(res.status).toBe(200);
      answers.push(res.text.replace(/value="[^"]*"/g, ''));
    }
    expect(new Set(answers).size).toBe(1);
    expect(sent().map(m => m.to)).toEqual(['ann@example.com']);
    expect(unconfirmed).toBeDefined();
  });

  it('at most 3 mails an hour per account', async () => {
    for (let i = 0; i < 5; i++) await forgot('ann'); // 5: still under the visitor limit
    expect(sent()).toHaveLength(3);
  });

  it('more than 5 requests in 15 minutes from one visitor are refused', async () => {
    for (let i = 0; i < 5; i++) expect((await forgot('nobody')).status).toBe(200);
    expect((await forgot('nobody')).status).toBe(429);
  });

  it('works on a private instance', async () => {
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ access: { loginRequired: true } }));
    configService.reload();
    expect((await request(app()).get('/forgot-password')).status).toBe(200);
    expect((await forgot('ann')).status).toBe(200);
    expect((await request(app()).get(resetLinkIn(sent()[0]))).status).toBe(200);
  });

  it('is not there while mail is off', async () => {
    mailService.configure(null);
    expect((await request(app()).get('/forgot-password')).status).toBe(404);
    expect((await forgot('ann')).status).toBe(404);
  });
});

describe('the link (GET/POST /reset-password/:token)', () => {
  async function linkForAnn() {
    await forgot('ann');
    return resetLinkIn(sent().at(-1));
  }

  it('opening it only shows the form (mail scanners open links)', async () => {
    const link = await linkForAnn();
    for (let i = 0; i < 2; i++) {
      const page = await request(app()).get(link);
      expect(page.status).toBe(200);
      expect(page.text).toContain('ann');
      expect(page.text).toMatch(/<form[^>]+method="post"/i);
    }
  });

  it('sets the new password, logs in on this browser, and works only once', async () => {
    const link = await linkForAnn();
    const agent = request.agent(app());
    const res = await reset(link, 'brand-new-pass', 'brand-new-pass', agent);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    expect(await isLoggedIn(agent)).toBe(true);

    await loggedIn('ann', 'brand-new-pass');
    expect((await request(app()).post('/login').set(sameSite).type('form').send({ username: 'ann', password: 'password123' })).status).toBe(200);
    expect(auditActions()).toContain('PASSWORD_RESET');

    expect((await reset(link, 'another-pass-1')).status).toBe(410);
    expect((await request(app()).get(link)).status).toBe(410);
  });

  it('mails a "password changed" notice', async () => {
    const link = await linkForAnn();
    await reset(link, 'brand-new-pass');
    expect(sent().at(-1).subject).toMatch(/password was changed/i);
    expect(sent().at(-1).to).toBe('ann@example.com');
  });

  it('a too short or mismatched password shows the form again and keeps the link working', async () => {
    const link = await linkForAnn();
    let res = await reset(link, 'short');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/at least 8 characters/);
    res = await reset(link, 'brand-new-pass', 'brand-new-typo');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/don(&#39;|')t match/); // HTML-escaped
    expect((await reset(link, 'brand-new-pass')).status).toBe(302);
  });

  it('an unknown or expired link no longer works', async () => {
    expect((await request(app()).get('/reset-password/nope')).status).toBe(410);
    const link = await linkForAnn();
    db().prepare("UPDATE user_tokens SET expiresAt = '2000-01-01T00:00:00.000Z'").run();
    const res = await reset(link, 'brand-new-pass');
    expect(res.status).toBe(410);
    expect(res.text).toMatch(/no longer works/i);
    expect(res.text).toContain('href="/forgot-password"');
  });

  it('a newer link replaces the older one', async () => {
    const first = await linkForAnn();
    await linkForAnn();
    expect((await request(app()).get(first)).status).toBe(410);
  });

  it('a banned account cannot use a link it got before', async () => {
    const link = await linkForAnn();
    db().prepare('UPDATE users SET isBanned = 1 WHERE id = ?').run(ann.id);
    expect((await reset(link, 'brand-new-pass')).status).toBe(410);
  });

  it('a cross-site POST is refused', async () => {
    const link = await linkForAnn();
    const res = await request(app()).post(link).set('Sec-Fetch-Site', 'cross-site').type('form')
      .send({ password: 'brand-new-pass', confirmPassword: 'brand-new-pass' });
    expect(res.status).toBe(403);
  });
});

describe('a new password logs out every other session', () => {
  it('after a reset', async () => {
    const elsewhere = await loggedIn('ann');
    await forgot('ann');
    await reset(resetLinkIn(sent().at(-1)), 'brand-new-pass');
    expect(await isLoggedIn(elsewhere)).toBe(false);
  });

  it('after changing it in Settings, keeping the session that changed it', async () => {
    const here = await loggedIn('ann');
    const elsewhere = await loggedIn('ann');
    const res = await here.put('/api/user/password').set(sameSite).send({ currentPassword: 'password123', newPassword: 'brand-new-pass' });
    expect(res.status).toBe(200);
    expect(await isLoggedIn(here)).toBe(true);
    expect(await isLoggedIn(elsewhere)).toBe(false);
    expect(sent().map(m => m.subject)).toEqual([expect.stringMatching(/password was changed/i)]);
  });

  it('after an admin sets it in Admin → Users', async () => {
    const elsewhere = await loggedIn('ann');
    const admin = await loggedIn('boss');
    await admin.put(`/api/admin/users/${ann.id}`).set(sameSite).send({ password: 'brand-new-pass' });
    expect(await isLoggedIn(elsewhere)).toBe(false);
  });

  it('sessions started before this version (no version stored) stay logged in', async () => {
    const agent = await loggedIn('ann');
    // An old session has no sessionVersion; the account's is 0 until its password changes
    expect(await isLoggedIn(agent)).toBe(true);
  });

  it('the reset link stops working when the password is changed in Settings', async () => {
    await forgot('ann');
    const link = resetLinkIn(sent().at(-1));
    const here = await loggedIn('ann');
    await here.put('/api/user/password').set(sameSite).send({ currentPassword: 'password123', newPassword: 'brand-new-pass' });
    expect((await request(app()).get(link)).status).toBe(410);
    expect(UserToken.countRecent(ann.id, 'reset_password', 60)).toBe(1);
  });
});
