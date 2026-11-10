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

// Account email: users set and change their address in Settings, confirm it through a link sent by mail, and only a
// confirmed address will get password reset mails (PR 2). Mail itself is optional (services/mailService.js).

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
const tokenFrom = (mail) => mail.text.match(/\/verify-email\/([A-Za-z0-9_-]+)/)[1];

function mailOn() {
  transport = { sendMail: jest.fn(async () => ({})) };
  mailService.configure(MAIL, { transport });
}

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}

const userRow = (id) => db().prepare('SELECT email, emailVerifiedAt FROM users WHERE id = ?').get(id);
const verify = (id, email) => db().prepare("UPDATE users SET email = ?, emailVerifiedAt = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(email, id);
const auditActions = () => db().prepare('SELECT action FROM audit_logs ORDER BY id').all().map(r => r.action);

async function loggedIn(user) {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username: user.username, password: 'password123' });
  expect(res.status).toBe(302);
  return agent;
}

let admin;
let ann;
beforeEach(async () => {
  setupService.reset();
  mailOn();
  admin = await createTestUser({ username: 'boss', isAdmin: 1, email: null });
  ann = await createTestUser({ username: 'ann', email: null });
});
afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

const changeEmail = (agent, email, currentPassword = 'password123') =>
  agent.put('/api/user/email').set(sameSite).send({ email, currentPassword });

describe('changing your email (PUT /api/user/email)', () => {
  it('stores it unverified and mails a confirmation link built from PUBLIC_URL, not the Host header', async () => {
    const agent = await loggedIn(ann);
    const res = await changeEmail(agent, '  Ann@Example.com ').set('Host', 'evil.example');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, email: 'Ann@Example.com', verified: false, mailSent: true });
    expect(userRow(ann.id)).toEqual({ email: 'Ann@Example.com', emailVerifiedAt: null });

    const [mail] = sent();
    expect(mail.to).toBe('Ann@Example.com');
    expect(mail.text).toContain('https://links.example.com/verify-email/');
    expect(mail.text).not.toContain('evil.example');
    expect(auditActions()).toContain('EMAIL_CHANGE');
  });

  it('needs the current password', async () => {
    const agent = await loggedIn(ann);
    expect((await changeEmail(agent, 'ann@example.com', 'wrong')).status).toBe(401);
    expect((await changeEmail(agent, 'ann@example.com', '')).status).toBe(400);
    expect(userRow(ann.id).email).toBeNull();
    expect(sent()).toHaveLength(0);
  });

  it.each(['ann', 'ann@', '@example.com', 'a b@example.com', `${'a'.repeat(250)}@example.com`])(
    'refuses %p', async (email) => {
      const agent = await loggedIn(ann);
      const res = await changeEmail(agent, email);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email address/i);
    });

  it('an empty address removes it (only the old confirmed address is told)', async () => {
    verify(ann.id, 'ann@example.com');
    const agent = await loggedIn(ann);
    const res = await changeEmail(agent, '');
    expect(res.body).toEqual(expect.objectContaining({ email: null, verified: false }));
    expect(userRow(ann.id)).toEqual({ email: null, emailVerifiedAt: null });
    expect(sent().map(m => m.subject)).toEqual([expect.stringMatching(/email address was changed/)]);
  });

  it('tells the old confirmed address about the change', async () => {
    verify(ann.id, 'old@example.com');
    const agent = await loggedIn(ann);
    await changeEmail(agent, 'new@example.com');
    const notice = sent().find(m => m.to === 'old@example.com');
    expect(notice.subject).toMatch(/email address was changed/);
    expect(notice.text).toContain('new@example.com');
  });

  it('the same address again changes nothing and sends nothing', async () => {
    verify(ann.id, 'ann@example.com');
    const agent = await loggedIn(ann);
    const res = await changeEmail(agent, 'ann@example.com');
    expect(res.body).toEqual(expect.objectContaining({ email: 'ann@example.com', verified: true, mailSent: false }));
    expect(userRow(ann.id).emailVerifiedAt).not.toBeNull();
    expect(sent()).toHaveLength(0);
  });

  it('a new address stops the links sent to the previous one', async () => {
    const agent = await loggedIn(ann);
    await changeEmail(agent, 'first@example.com');
    const firstToken = tokenFrom(sent()[0]);
    await changeEmail(agent, 'second@example.com');
    expect(UserToken.find('verify_email', firstToken)).toBeNull();
  });

  it('with mail off, the address is stored but nothing is sent', async () => {
    mailService.configure(null);
    const agent = await loggedIn(ann);
    const res = await changeEmail(agent, 'ann@example.com');
    expect(res.body).toEqual(expect.objectContaining({ email: 'ann@example.com', verified: false, mailSent: false }));
  });

  it('needs a login', async () => {
    expect((await changeEmail(request(app()), 'x@example.com')).status).toBe(302); // isAuthenticated → /login
  });
});

describe('confirming (GET/POST /verify-email/:token)', () => {
  async function linkFor(user, email) {
    const agent = await loggedIn(user);
    await changeEmail(agent, email);
    return `/verify-email/${tokenFrom(sent().at(-1))}`;
  }

  it('opening the link only asks: link checkers and previews must not use it up', async () => {
    const link = await linkFor(ann, 'ann@example.com');
    for (let i = 0; i < 2; i++) {
      const page = await request(app()).get(link);
      expect(page.status).toBe(200);
      expect(page.text).toContain('ann@example.com');
      expect(page.text).toMatch(/<form[^>]+method="post"/i);
    }
    expect(userRow(ann.id).emailVerifiedAt).toBeNull();
  });

  it('the button confirms it, once, without needing a login', async () => {
    const link = await linkFor(ann, 'ann@example.com');
    const res = await request(app()).post(link).set(sameSite);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/confirmed/i);
    expect(userRow(ann.id).emailVerifiedAt).not.toBeNull();
    expect(auditActions()).toContain('VERIFY_EMAIL');

    const again = await request(app()).post(link).set(sameSite);
    expect(again.status).toBe(410);
    expect((await request(app()).get(link)).status).toBe(410);
  });

  it("doesn't offer Settings to someone else who is logged in", async () => {
    const link = await linkFor(ann, 'ann@example.com');
    const agent = await loggedIn(admin);
    const page = await agent.post(link).set(sameSite);
    expect(page.text).toMatch(/confirmed/i);
    expect(page.text).not.toContain('href="/settings"');
  });

  it('an expired link says how to get a new one, also for an account still waiting at sign-up', async () => {
    const page = await request(app()).get('/verify-email/nope');
    expect(page.text).toMatch(/Log in to get a new one/);
  });

  it("the confirmation mail's footer names the contact address (MAIL_REPLY_TO) for questions", async () => {
    mailService.configure({ ...MAIL, replyTo: 'contact@example.com' }, { transport });
    const agent = await loggedIn(ann);
    await changeEmail(agent, 'ann@example.com');
    expect(sent()[0].text).toContain('Questions: contact@example.com');
  });

  it("mails take their colors from the site's light palette (Admin → Appearance)", async () => {
    const paletteService = require('../../services/paletteService');
    const light = paletteService.listPalettes('light', { builtInOnly: true }).find(p => p.id !== 'linksnip-light');
    setSettings({ branding: { lightPalette: light.id } });
    const agent = await loggedIn(ann);
    await changeEmail(agent, 'ann@example.com');
    const accent = paletteService.tokens(paletteService.getPalette(light.id))['--primary'];
    expect(sent()[0].html).toContain(`background:${accent}`);
    // and the dark palette for mail apps in dark mode
    const darkAccent = paletteService.tokens(paletteService.getPalette(configService.get('branding.darkPalette')))['--primary'];
    expect(sent()[0].html).toContain(`background:${darkAccent} !important`);
  });

  it('leads back to Settings when logged in, to the login page when not', async () => {
    const link = await linkFor(ann, 'ann@example.com');
    const agent = await loggedIn(ann);
    const page = await agent.post(link).set(sameSite);
    expect(page.text).toContain('href="/settings"');
    expect((await request(app()).get('/verify-email/nope')).text).toContain('href="/login"');
  });

  it.each(['/verify-email/nope', '/verify-email/'.padEnd(60, 'x')])('an unknown link %s says it no longer works', async (link) => {
    const res = await request(app()).get(link);
    expect(res.status).toBe(410);
    expect(res.text).toMatch(/no longer works/i);
  });

  it('an expired link no longer works', async () => {
    const link = await linkFor(ann, 'ann@example.com');
    db().prepare("UPDATE user_tokens SET expiresAt = '2000-01-01T00:00:00.000Z'").run();
    expect((await request(app()).post(link).set(sameSite)).status).toBe(410);
  });

  it('an address another account already confirmed is refused (ignoring case)', async () => {
    const bob = await createTestUser({ username: 'bob', email: null });
    verify(bob.id, 'shared@example.com');
    const link = await linkFor(ann, 'SHARED@example.com');
    const res = await request(app()).post(link).set(sameSite);
    expect(res.status).toBe(409);
    expect(res.text).toMatch(/another account/i);
    expect(userRow(ann.id).emailVerifiedAt).toBeNull();
  });

  it('works on a private instance (visitors reach it)', async () => {
    setSettings({ access: { loginRequired: true } });
    const link = await linkFor(ann, 'ann@example.com');
    expect((await request(app()).get(link)).status).toBe(200);
    expect((await request(app()).post(link).set(sameSite)).status).toBe(200);
  });

  it('a cross-site POST is refused', async () => {
    const link = await linkFor(ann, 'ann@example.com');
    expect((await request(app()).post(link).set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
    expect(userRow(ann.id).emailVerifiedAt).toBeNull();
  });
});

describe('sending the confirmation again (POST /api/user/email/resend)', () => {
  const resend = (agent) => agent.post('/api/user/email/resend').set(sameSite);

  it('sends a new link, at most 3 an hour', async () => {
    db().prepare("UPDATE users SET email = 'ann@example.com' WHERE id = ?").run(ann.id);
    const agent = await loggedIn(ann);
    for (let i = 0; i < 3; i++) expect((await resend(agent)).status).toBe(200);
    const res = await resend(agent);
    expect(res.status).toBe(429);
    expect(sent()).toHaveLength(3);
  });

  it('refuses without an address, or when it is already confirmed', async () => {
    const agent = await loggedIn(ann);
    expect((await resend(agent)).status).toBe(400);
    verify(ann.id, 'ann@example.com');
    expect((await resend(agent)).status).toBe(400);
  });

  it('answers 503 while mail is off', async () => {
    mailService.configure(null);
    db().prepare("UPDATE users SET email = 'ann@example.com' WHERE id = ?").run(ann.id);
    const agent = await loggedIn(ann);
    const res = await resend(agent);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('mail_disabled');
  });
});

describe('the Settings page', () => {
  it('shows the address and whether it is confirmed', async () => {
    db().prepare("UPDATE users SET email = 'ann@example.com' WHERE id = ?").run(ann.id);
    const agent = await loggedIn(ann);
    let page = await agent.get('/settings');
    expect(page.text).toContain('ann@example.com');
    expect(page.text).toMatch(/Not confirmed/);
    expect(page.text).toContain('id="resendEmailBtn"');

    verify(ann.id, 'ann@example.com');
    page = await agent.get('/settings');
    expect(page.text).toMatch(/Confirmed/);
    expect(page.text).not.toContain('id="resendEmailBtn"');
  });

  it("says when the site can't send mail", async () => {
    mailService.configure(null);
    const agent = await loggedIn(ann);
    const page = await agent.get('/settings');
    expect(page.text).toMatch(/can't send mail/);
  });
});

describe('registering with an email', () => {
  it('sends the confirmation link (the account waits for it: signupConfirmation.test.js)', async () => {
    const res = await request(app()).post('/register').set(sameSite).type('form')
      .send({ username: 'newbie', email: 'newbie@example.com', password: 'password123', confirmPassword: 'password123' });
    expect(res.status).toBe(200);
    expect(sent().map(m => m.to)).toEqual(['newbie@example.com']);
  });

  it('refuses an address that is not one', async () => {
    const res = await request(app()).post('/register').set(sameSite).type('form')
      .send({ username: 'newbie', email: 'not-an-address', password: 'password123', confirmPassword: 'password123' });
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/valid email address/i);
    expect(db().prepare("SELECT 1 FROM users WHERE username = 'newbie'").get()).toBeUndefined();
  });
});

describe('Admin → Users changing an address', () => {
  it('makes it unconfirmed', async () => {
    verify(ann.id, 'ann@example.com');
    const agent = await loggedIn(admin);
    const res = await agent.put(`/api/admin/users/${ann.id}`).set(sameSite).send({ email: 'other@example.com' });
    expect(res.status).toBe(200);
    expect(userRow(ann.id)).toEqual({ email: 'other@example.com', emailVerifiedAt: null });
  });

  it('keeps it confirmed when the address is unchanged', async () => {
    verify(ann.id, 'ann@example.com');
    const agent = await loggedIn(admin);
    await agent.put(`/api/admin/users/${ann.id}`).set(sameSite).send({ email: 'ann@example.com', role: 'trusted' });
    expect(userRow(ann.id).emailVerifiedAt).not.toBeNull();
  });
});

describe('Admin test mail (POST /api/admin/mail/test)', () => {
  const test = (agent) => agent.post('/api/admin/mail/test').set(sameSite);

  it("goes to the admin's confirmed address and waits for the server", async () => {
    verify(admin.id, 'boss@example.com');
    const agent = await loggedIn(admin);
    const res = await test(agent);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, to: 'boss@example.com' });
    expect(sent()[0].subject).toMatch(/Test email/);
    expect(auditActions()).toContain('SEND_TEST_EMAIL');
  });

  it('reports the server error', async () => {
    verify(admin.id, 'boss@example.com');
    transport.sendMail.mockRejectedValueOnce(new Error('535 authentication failed'));
    const agent = await loggedIn(admin);
    const res = await test(agent);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('535 authentication failed');
  });

  it('needs a confirmed address', async () => {
    const agent = await loggedIn(admin);
    expect((await test(agent)).status).toBe(400);
  });

  it('answers 503 while mail is off', async () => {
    mailService.configure(null);
    verify(admin.id, 'boss@example.com');
    const agent = await loggedIn(admin);
    expect((await test(agent)).status).toBe(503);
  });

  it('is for admins only', async () => {
    verify(ann.id, 'ann@example.com');
    const agent = await loggedIn(ann);
    expect((await test(agent)).status).toBe(302); // isAdmin → /
    expect(sent()).toHaveLength(0);
  });
});
