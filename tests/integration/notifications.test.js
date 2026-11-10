const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const mailService = require('../../services/mailService');
const notifications = require('../../services/notificationService');
const { createApp } = require('../../createApp');
const { getTestDatabase } = require('../setup/testDatabase');
const { createTestUser } = require('../setup/testHelpers');

// The Notifications page (seeing a notification there cancels its mail), the preferences in Settings, and the
// unsubscribe links in mails (open without logging in, also on a private instance).

const SECRET = 'integration-test-session-secret-'.padEnd(64, 'x');
const app = () => createApp({ sessionSecret: SECRET });
const sameSite = { 'Sec-Fetch-Site': 'same-origin' };
const db = () => getTestDatabase();
const MAIL = {
  transport: 'smtp', host: 'mail.example.com', port: 465, secure: true, user: 'u', pass: 'p',
  from: 'LinkSnip <no-reply@example.com>', replyTo: null, publicUrl: 'https://links.example.com'
};
let transport;

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}
async function loggedIn(user) {
  const agent = request.agent(app());
  const res = await agent.post('/login').set(sameSite).type('form').send({ username: user.username, password: 'password123' });
  expect(res.status).toBe(302);
  return agent;
}
const item = (slug) => ({ item: { type: 'url', noun: 'link', slug, address: `/s/${slug}`, path: `/info/${slug}` } });
const later = () => new Date(Date.now() + 60 * 60000);

let ann;
let bob;
beforeEach(async () => {
  setupService.reset();
  transport = { sendMail: jest.fn(async () => ({})) };
  mailService.configure(MAIL, { transport });
  await createTestUser({ username: 'boss', isAdmin: 1 });
  ann = await createTestUser({ username: 'ann', email: 'ann@example.com' });
  bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
  db().prepare("UPDATE users SET emailVerifiedAt = '2026-01-01T00:00:00.000Z'").run();
});
afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('GET /notifications', () => {
  it('lists the user\'s notifications, newest first, with links', async () => {
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: item('first') });
    notifications.notify(ann.id, 'unblocked', { type: 'url', id: 1, payload: item('second') });
    notifications.notify(bob.id, 'blocked', { type: 'url', id: 2, payload: item('bobs') });
    const res = await (await loggedIn(ann)).get('/notifications');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/s/second');
    expect(res.text.indexOf('/s/second')).toBeLessThan(res.text.indexOf('/s/first'));
    expect(res.text).toContain('href="/info/first"');
    expect(res.text).not.toContain('/s/bobs');
  });

  it('marks what it showed as read, so its mail is not sent', async () => {
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: item('seen') });
    notifications.notify(bob.id, 'blocked', { type: 'url', id: 2, payload: item('unseen') });
    const agent = await loggedIn(ann);
    const first = await agent.get('/notifications');
    expect(first.text).toMatch(/notification-item[^"]*unread/);
    const second = await agent.get('/notifications');
    expect(second.text).not.toMatch(/notification-item[^"]*unread/);

    await notifications.sendDue(later());
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(transport.sendMail.mock.calls[0][0].to).toBe('bob@example.com');
  });

  it('shows the unread count in the sidebar until the page is opened', async () => {
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: item('a') });
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 2, payload: item('b') });
    const agent = await loggedIn(ann);
    const dashboard = await agent.get('/dashboard');
    expect(dashboard.text).toMatch(/href="\/notifications"[\s\S]*?data-unread-count[^>]*>2</);
    await agent.get('/notifications');
    expect((await agent.get('/dashboard')).text).not.toContain('data-unread-count');
  });

  it('names the unread count on the top bar\'s menu button, singular for one', async () => {
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: item('a') });
    const agent = await loggedIn(ann);
    expect((await agent.get('/dashboard')).text).toContain('aria-label="Open menu (1 unread notification)"');
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 2, payload: item('b') });
    expect((await agent.get('/dashboard')).text).toContain('aria-label="Open menu (2 unread notifications)"');
  });

  it('shows an empty state', async () => {
    const res = await (await loggedIn(ann)).get('/notifications');
    expect(res.text).toMatch(/No notifications/);
  });

  it('pages long lists', async () => {
    for (let i = 0; i < 30; i++) notifications.notify(ann.id, 'blocked', { type: 'url', id: i, payload: item(`n${i}`) });
    const agent = await loggedIn(ann);
    const page2 = await agent.get('/notifications?page=2');
    expect(page2.text).toContain('/s/n0');
    expect(page2.text).not.toContain('/s/n29');
  });

  it('needs a login; 404 while the feature is off (and no sidebar entry)', async () => {
    expect((await request(app()).get('/notifications')).status).toBe(302);
    const agent = await loggedIn(ann);
    setSettings({ features: { notifications: false } });
    expect((await agent.get('/notifications')).status).toBe(404);
    expect((await agent.get('/dashboard')).text).not.toContain('href="/notifications"');
    expect((await agent.post('/api/notifications/read-all').set(sameSite)).status).toBe(404);
  });
});

describe('marking read', () => {
  it('POST /api/notifications/read marks the user\'s own rows; read-all marks every one', async () => {
    const a = notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 2 });
    const bobs = notifications.notify(bob.id, 'blocked', { type: 'url', id: 3 });
    const agent = await loggedIn(ann);

    const res = await agent.post('/api/notifications/read').set(sameSite).send({ ids: [a.id, bobs.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, unread: 1 });
    expect(db().prepare('SELECT readAt FROM notifications WHERE id = ?').get(bobs.id).readAt).toBeNull();

    const all = await agent.post('/api/notifications/read-all').set(sameSite);
    expect(all.body).toEqual({ success: true, unread: 0 });
  });

  it('refuses a malformed body', async () => {
    const agent = await loggedIn(ann);
    expect((await agent.post('/api/notifications/read').set(sameSite).send({ ids: 'x' })).status).toBe(400);
  });
});

describe('preferences', () => {
  it('Settings shows a toggle per event and channel', async () => {
    const res = await (await loggedIn(ann)).get('/settings');
    expect(res.text).toContain('id="notifications"');
    expect(res.text).toMatch(/data-notification-event="blocked"[^>]*data-channel="mail"[^>]*checked|data-channel="mail"[^>]*data-notification-event="blocked"[^>]*checked/);
    expect(res.text).not.toContain('data-notification-event="account_banned"');
  });

  it('disables the mail toggles without a confirmed address', async () => {
    db().prepare('UPDATE users SET emailVerifiedAt = NULL WHERE id = ?').run(ann.id);
    const res = await (await loggedIn(ann)).get('/settings');
    expect(res.text).toMatch(/data-channel="mail"[^>]*disabled/);
  });

  it('GET/PUT /api/user/notification-preferences', async () => {
    const agent = await loggedIn(ann);
    const before = await agent.get('/api/user/notification-preferences');
    expect(before.body.preferences.blocked).toEqual({ inApp: true, mail: true });

    const res = await agent.put('/api/user/notification-preferences').set(sameSite)
      .send({ preferences: { blocked: { inApp: true, mail: false } } });
    expect(res.status).toBe(200);
    expect(res.body.preferences.blocked).toEqual({ inApp: true, mail: false });
    expect(notifications.preferences(ann.id).blocked.mail).toBe(false);
  });

  it('refuses a malformed body', async () => {
    const agent = await loggedIn(ann);
    expect((await agent.put('/api/user/notification-preferences').set(sameSite).send({ preferences: 'x' })).status).toBe(400);
  });

  it('hides the section while the feature is off', async () => {
    setSettings({ features: { notifications: false } });
    const res = await (await loggedIn(ann)).get('/settings');
    expect(res.text).not.toContain('id="notifications"');
  });
});

describe('unsubscribe links', () => {
  const linkPath = (userId, event) => new URL(notifications.unsubscribeUrl(userId, event)).pathname;

  it('GET asks first and changes nothing (mail scanners open links)', async () => {
    const res = await request(app()).get(linkPath(ann.id, 'blocked'));
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<form[^>]*method="post"/i);
    expect(notifications.preferences(ann.id).blocked.mail).toBe(true);
  });

  it('POST from the page turns that mail off, without logging in', async () => {
    const res = await request(app()).post(linkPath(ann.id, 'blocked')).set(sameSite).type('form').send({});
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/won.t get/i);
    expect(notifications.preferences(ann.id).blocked).toEqual({ inApp: true, mail: false });
  });

  it('answers a one-click POST from a mail app (RFC 8058)', async () => {
    const res = await request(app()).post(linkPath(ann.id, 'all')).type('form').send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect(Object.values(notifications.preferences(ann.id)).some(p => p.mail)).toBe(false);
  });

  it('works on a private instance', async () => {
    setSettings({ access: { loginRequired: true } });
    expect((await request(app()).get(linkPath(ann.id, 'blocked'))).status).toBe(200);
  });

  it('is a 404 for an unknown key or event', async () => {
    const path = linkPath(ann.id, 'blocked');
    expect((await request(app()).get(path.replace(/\/[^/]+\/blocked$/, '/nope/blocked'))).status).toBe(404);
    expect((await request(app()).get(path.replace(/blocked$/, 'constructor'))).status).toBe(404);
    expect((await request(app()).post(path.replace(/\/[^/]+\/blocked$/, '/nope/blocked')).type('form').send({})).status).toBe(404);
  });
});
