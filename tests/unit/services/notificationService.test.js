const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const mailService = require('../../../services/mailService');
const notifications = require('../../../services/notificationService');
const Notification = require('../../../models/Notification');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl, createTestPaste } = require('../../setup/testHelpers');

// Events become rows (the in-app list) and, when the user wants mail, wait in the same rows for a batched mail.
// A row seen in the app before its mail goes out is dropped from the mail.

const MAIL = {
  transport: 'smtp', host: 'mail.example.com', port: 465, secure: true, user: 'u', pass: 'p',
  from: 'LinkSnip <no-reply@example.com>', replyTo: null, publicUrl: 'https://links.example.com'
};
const db = () => getTestDatabase();
const rows = () => db().prepare('SELECT * FROM notifications ORDER BY id').all();
const minutesFromNow = (m) => new Date(Date.now() + m * 60000);

let transport;
function mailOn() {
  transport = { sendMail: jest.fn(async () => ({ messageId: '<x@example.com>' })) };
  mailService.configure(MAIL, { transport });
}
function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
async function confirmedUser(username = 'ann') {
  const user = await createTestUser({ username, email: `${username}@example.com` });
  db().prepare("UPDATE users SET emailVerifiedAt = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(user.id);
  return user;
}

afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('notify', () => {
  it('stores an in-app row with its payload; no mail while mail is off', async () => {
    const ann = await confirmedUser();
    const row = notifications.notify(ann.id, 'blocked', { type: 'url', id: 7, payload: { item: { address: '/s/a' } } });
    expect(row).toEqual(expect.objectContaining({ userId: ann.id, event: 'blocked', targetType: 'url', targetId: 7, inApp: 1, mailState: 'none' }));
    expect(JSON.parse(rows()[0].payload)).toEqual({ item: { address: '/s/a' } });
  });

  it('queues a mail for a confirmed address, after notifications.mailDelayMinutes', async () => {
    mailOn();
    setSettings({ notifications: { mailDelayMinutes: 20 } });
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 7 });
    const [row] = rows();
    expect(row.mailState).toBe('pending');
    const wait = (Date.parse(row.mailAfter) - Date.now()) / 60000;
    expect(wait).toBeGreaterThan(19);
    expect(wait).toBeLessThanOrEqual(20);
  });

  it('queues no mail for an unconfirmed address or an event whose mail is off by default', async () => {
    mailOn();
    const bob = await createTestUser({ username: 'bob', email: 'bob@example.com' });
    notifications.notify(bob.id, 'blocked', { type: 'url', id: 1 });
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'unblocked', { type: 'url', id: 1 });
    expect(rows().map(r => r.mailState)).toEqual(['none', 'none']);
  });

  it('sends the ban mail right away, and only by mail', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'account_banned', {});
    const [row] = rows();
    expect(row).toEqual(expect.objectContaining({ inApp: 0, mailState: 'pending' }));
    expect(Date.parse(row.mailAfter)).toBeLessThanOrEqual(Date.now());
  });

  it('stores nothing for a ban when the mail can\'t go out (nothing in-app either)', async () => {
    const ann = await confirmedUser();
    expect(notifications.notify(ann.id, 'account_banned', {})).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('does not tell people about their own actions', async () => {
    const ann = await confirmedUser();
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, actorId: ann.id })).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('does nothing while features.notifications is off', async () => {
    setSettings({ features: { notifications: false } });
    const ann = await confirmedUser();
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 })).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('ignores unknown users and events', async () => {
    expect(notifications.notify(999, 'blocked', {})).toBeNull();
    expect(notifications.notify(null, 'blocked', {})).toBeNull();
    const ann = await confirmedUser();
    expect(notifications.notify(ann.id, 'constructor', {})).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('tells a banned user nothing but the ban', async () => {
    mailOn();
    const ann = await confirmedUser();
    db().prepare('UPDATE users SET isBanned = 1 WHERE id = ?').run(ann.id);
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 })).toBeNull();
    expect(notifications.notify(ann.id, 'account_banned', {})).not.toBeNull();
  });

  it('follows the preferences: nothing when both are off, a mail-only row when only mail is on', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.setPreferences(ann.id, { blocked: { inApp: false, mail: false }, unblocked: { inApp: false, mail: true } });
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 })).toBeNull();
    notifications.notify(ann.id, 'unblocked', { type: 'url', id: 1 });
    expect(rows()).toEqual([expect.objectContaining({ event: 'unblocked', inApp: 0, mailState: 'pending' })]);
  });

  it('stores nothing for a mail-only preference when the mail can\'t go out', async () => {
    const ann = await confirmedUser();
    notifications.setPreferences(ann.id, { blocked: { inApp: false, mail: true } });
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 })).toBeNull();
  });

  it('stores a dedupe key once', async () => {
    const ann = await confirmedUser();
    expect(notifications.notify(ann.id, 'expires_soon', { type: 'url', id: 1, dedupeKey: 'expires_soon:url:1' })).not.toBeNull();
    expect(notifications.notify(ann.id, 'expires_soon', { type: 'url', id: 1, dedupeKey: 'expires_soon:url:1' })).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('never throws into the caller', async () => {
    const ann = await confirmedUser();
    const spy = jest.spyOn(Notification, 'create').mockImplementation(() => { throw new Error('disk full'); });
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 })).toBeNull();
    expect(error).toHaveBeenCalled();
    spy.mockRestore();
    error.mockRestore();
  });
});

describe('notifyItemOwner', () => {
  it('notifies the owner with the item named in the payload', async () => {
    const ann = await confirmedUser();
    const url = createTestUrl({ slug: 'abc', creatorId: ann.id });
    notifications.notifyItemOwner('url', url, 'blocked');
    const [row] = rows();
    expect(row).toEqual(expect.objectContaining({ userId: ann.id, targetType: 'url', targetId: url.id }));
    expect(JSON.parse(row.payload).item).toEqual({ type: 'url', noun: 'link', slug: 'abc', address: '/s/abc', path: '/info/abc' });
  });

  it('links types without an info page to their public page; owner column per type', async () => {
    const ann = await confirmedUser();
    const paste = createTestPaste(ann.id, { slug: 'txt' });
    notifications.notifyItemOwner('paste', paste, 'blocked');
    expect(JSON.parse(rows()[0].payload).item.path).toBe('/p-info/txt');
  });

  it('passes extra payload, the actor and a dedupe key', async () => {
    const ann = await confirmedUser();
    const url = createTestUrl({ slug: 'abc', creatorId: ann.id });
    notifications.notifyItemOwner('url', url, 'expires_soon', { payload: { days: 3 }, dedupe: true });
    notifications.notifyItemOwner('url', url, 'expires_soon', { payload: { days: 2 }, dedupe: true });
    notifications.notifyItemOwner('url', url, 'blocked', { actorId: ann.id });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].dedupeKey).toBe(`expires_soon:url:${url.id}`);
    expect(JSON.parse(rows()[0].payload).days).toBe(3);
  });

  it('can leave the item unlinked (deleted items)', async () => {
    const ann = await confirmedUser();
    const url = createTestUrl({ slug: 'abc', creatorId: ann.id });
    notifications.notifyItemOwner('url', url, 'deleted_by_cleanup', { deleted: true });
    expect(JSON.parse(rows()[0].payload).item.path).toBeNull();
  });

  it('does nothing for anonymous items', () => {
    const url = createTestUrl({ slug: 'anon', creatorId: null });
    expect(notifications.notifyItemOwner('url', url, 'blocked')).toBeNull();
    expect(rows()).toEqual([]);
  });
});

describe('preferences', () => {
  it('starts from the defaults for every toggleable event', async () => {
    const ann = await confirmedUser();
    const prefs = notifications.preferences(ann.id);
    expect(prefs.blocked).toEqual({ inApp: true, mail: true });
    expect(prefs.unblocked).toEqual({ inApp: true, mail: false });
    expect(prefs).not.toHaveProperty('account_banned');
  });

  it('stores changes and ignores unknown or fixed events', async () => {
    const ann = await confirmedUser();
    notifications.setPreferences(ann.id, {
      unblocked: { inApp: false, mail: true }, account_banned: { inApp: true, mail: false }, constructor: { mail: true }
    });
    notifications.setPreferences(ann.id, { blocked: { mail: false } });
    const prefs = notifications.preferences(ann.id);
    expect(prefs.unblocked).toEqual({ inApp: false, mail: true });
    expect(prefs.blocked).toEqual({ inApp: true, mail: false });
    expect(db().prepare('SELECT event FROM notification_preferences ORDER BY event').all().map(r => r.event))
      .toEqual(['blocked', 'unblocked']);
  });
});

describe('the in-app list', () => {
  it('lists in-app rows newest first, counts unread, marks read (only the user\'s own)', async () => {
    mailOn();
    const ann = await confirmedUser();
    const bob = await confirmedUser('bob');
    const first = notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    const second = notifications.notify(ann.id, 'unblocked', { type: 'url', id: 1 });
    notifications.notify(ann.id, 'account_banned', {});
    const bobs = notifications.notify(bob.id, 'blocked', { type: 'url', id: 2 });

    expect(Notification.listForUser(ann.id).map(n => n.id)).toEqual([second.id, first.id]);
    expect(Notification.unreadCount(ann.id)).toBe(2);

    Notification.markRead(ann.id, [first.id, bobs.id]);
    expect(Notification.unreadCount(ann.id)).toBe(1);
    expect(Notification.unreadCount(bob.id)).toBe(1);

    Notification.markAllRead(ann.id);
    expect(Notification.unreadCount(ann.id)).toBe(0);
  });

  it('pages the list', async () => {
    const ann = await confirmedUser();
    for (let i = 0; i < 5; i++) notifications.notify(ann.id, 'blocked', { type: 'url', id: i });
    expect(Notification.listForUser(ann.id, { limit: 2, offset: 4 })).toHaveLength(1);
    expect(Notification.countForUser(ann.id)).toBe(5);
  });
});

describe('replacing report notices by the quarantine', () => {
  it('drops the unread, unmailed report_received rows of that item only', async () => {
    mailOn();
    const ann = await confirmedUser();
    const pending = notifications.notify(ann.id, 'report_received', { type: 'url', id: 1 });
    const read = notifications.notify(ann.id, 'report_received', { type: 'url', id: 1 });
    Notification.markRead(ann.id, [read.id]);
    const other = notifications.notify(ann.id, 'report_received', { type: 'url', id: 2 });
    const mailed = notifications.notify(ann.id, 'report_received', { type: 'url', id: 1 });
    db().prepare("UPDATE notifications SET mailState = 'sent' WHERE id = ?").run(mailed.id);

    notifications.dropReportNotices('url', 1);
    expect(rows().map(r => r.id)).toEqual([read.id, other.id, mailed.id]);
    expect(rows().map(r => r.id)).not.toContain(pending.id);
  });
});

describe('sendDue', () => {
  it('sends nothing before the delay', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    await notifications.sendDue();
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(rows()[0].mailState).toBe('pending');
  });

  it('sends one mail per user with every unseen pending row', async () => {
    mailOn();
    const ann = await confirmedUser();
    const bob = await confirmedUser('bob');
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: { item: { noun: 'link', address: '/s/one', path: '/info/one' } } });
    notifications.notify(ann.id, 'quarantined', { type: 'url', id: 2, payload: { item: { noun: 'link', address: '/s/two', path: '/info/two' } } });
    notifications.notify(bob.id, 'blocked', { type: 'url', id: 3, payload: { item: { noun: 'link', address: '/s/three', path: null } } });

    await notifications.sendDue(minutesFromNow(16));
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
    const toAnn = transport.sendMail.mock.calls.map(c => c[0]).find(m => m.to === 'ann@example.com');
    expect(toAnn.text).toContain('/s/one');
    expect(toAnn.text).toContain('/s/two');
    expect(toAnn.text).toContain('https://links.example.com/info/one');
    expect(toAnn.text).toContain('https://links.example.com/notifications');
    expect(rows().every(r => r.mailState === 'sent' && r.mailedAt)).toBe(true);
  });

  it('leaves out rows already seen in the app, and sends nothing when all were seen', async () => {
    mailOn();
    const ann = await confirmedUser();
    const bob = await confirmedUser('bob');
    const seen = notifications.notify(ann.id, 'blocked', { type: 'url', id: 1, payload: { item: { noun: 'link', address: '/s/seen' } } });
    notifications.notify(ann.id, 'quarantined', { type: 'url', id: 2, payload: { item: { noun: 'link', address: '/s/new' } } });
    const bobs = notifications.notify(bob.id, 'blocked', { type: 'url', id: 3 });
    Notification.markRead(ann.id, [seen.id]);
    Notification.markRead(bob.id, [bobs.id]);

    await notifications.sendDue(minutesFromNow(16));
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    const [mail] = transport.sendMail.mock.calls[0];
    expect(mail.to).toBe('ann@example.com');
    expect(mail.text).toContain('/s/new');
    expect(mail.text).not.toContain('/s/seen');
    expect(Notification.findById(seen.id).mailState).toBe('skipped');
    expect(Notification.findById(bobs.id).mailState).toBe('skipped');
  });

  it('sends the ban at once', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'account_banned', {});
    await notifications.sendDue();
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(transport.sendMail.mock.calls[0][0].subject).toMatch(/suspended|banned/i);
  });

  it('takes the not-yet-due rows of a user along with a due one', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    notifications.notify(ann.id, 'account_banned', {});
    await notifications.sendDue();
    expect(transport.sendMail).toHaveBeenCalledTimes(1);
    expect(rows().map(r => r.mailState)).toEqual(['sent', 'sent']);
  });

  it('keeps rows pending when the mail fails, for the next run', async () => {
    mailOn();
    transport.sendMail.mockRejectedValueOnce(new Error('timeout'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    await notifications.sendDue(minutesFromNow(16));
    expect(rows()[0].mailState).toBe('pending');
    await notifications.sendDue(minutesFromNow(17));
    expect(rows()[0].mailState).toBe('sent');
    error.mockRestore();
  });

  it('skips rows whose mail was turned off, or whose address is no longer confirmed, meanwhile', async () => {
    mailOn();
    const ann = await confirmedUser();
    const bob = await confirmedUser('bob');
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    notifications.notify(bob.id, 'blocked', { type: 'url', id: 2 });
    notifications.setPreferences(ann.id, { blocked: { mail: false } });
    db().prepare('UPDATE users SET emailVerifiedAt = NULL WHERE id = ?').run(bob.id);
    await notifications.sendDue(minutesFromNow(16));
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(rows().map(r => r.mailState)).toEqual(['skipped', 'skipped']);
  });

  it('skips the queue when mail or the feature was switched off', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    mailService.configure(null);
    await notifications.sendDue(minutesFromNow(16));
    expect(rows()[0].mailState).toBe('skipped');
  });

  it('adds a one-click unsubscribe header: the event, or every mail when the batch mixes events', async () => {
    mailOn();
    const ann = await confirmedUser();
    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    await notifications.sendDue(minutesFromNow(16));
    let [mail] = transport.sendMail.mock.calls[0];
    expect(mail.headers['List-Unsubscribe']).toMatch(/^<https:\/\/links\.example\.com\/notifications\/unsubscribe\/[A-Za-z0-9_-]+\/blocked>$/);
    expect(mail.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    notifications.notify(ann.id, 'quarantined', { type: 'url', id: 1 });
    await notifications.sendDue(minutesFromNow(16));
    [mail] = transport.sendMail.mock.calls[1];
    expect(mail.headers['List-Unsubscribe']).toMatch(/\/all>$/);
  });
});

describe('unsubscribe', () => {
  it('makes one key per user, stable across links', async () => {
    mailOn();
    const ann = await confirmedUser();
    const a = notifications.unsubscribeUrl(ann.id, 'blocked');
    const b = notifications.unsubscribeUrl(ann.id, 'quarantined');
    expect(a.split('/').at(-2)).toBe(b.split('/').at(-2));
    expect(a.split('/').at(-2).length).toBeGreaterThanOrEqual(32);
  });

  it('turns that event\'s mail off', async () => {
    mailOn();
    const ann = await confirmedUser();
    const key = notifications.unsubscribeUrl(ann.id, 'blocked').split('/').at(-2);
    expect(notifications.findUnsubscribe(key, 'blocked')).toEqual(expect.objectContaining({ userId: ann.id, event: 'blocked' }));
    expect(notifications.unsubscribe(key, 'blocked')).toBe(true);
    expect(notifications.preferences(ann.id).blocked).toEqual({ inApp: true, mail: false });
    expect(notifications.preferences(ann.id).quarantined.mail).toBe(true);
  });

  it('turns every mail off with "all"', async () => {
    mailOn();
    const ann = await confirmedUser();
    const key = notifications.unsubscribeUrl(ann.id, 'all').split('/').at(-2);
    notifications.unsubscribe(key, 'all');
    expect(Object.values(notifications.preferences(ann.id)).every(p => p.mail === false && p.inApp === true)).toBe(true);
  });

  it('refuses unknown keys and events, and the ban mail', async () => {
    mailOn();
    const ann = await confirmedUser();
    const key = notifications.unsubscribeUrl(ann.id, 'blocked').split('/').at(-2);
    expect(notifications.findUnsubscribe('nope', 'blocked')).toBeNull();
    expect(notifications.findUnsubscribe(key, 'constructor')).toBeNull();
    expect(notifications.findUnsubscribe(key, 'account_banned')).toBeNull();
    expect(notifications.unsubscribe('nope', 'blocked')).toBe(false);
  });
});

describe('cleanup', () => {
  it('deletes rows read more than N days ago and finished mail-only rows; keeps unread', async () => {
    mailOn();
    const ann = await confirmedUser();
    const old = notifications.notify(ann.id, 'blocked', { type: 'url', id: 1 });
    const recent = notifications.notify(ann.id, 'blocked', { type: 'url', id: 2 });
    const unread = notifications.notify(ann.id, 'blocked', { type: 'url', id: 3 });
    const banMail = notifications.notify(ann.id, 'account_banned', {});
    const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
    db().prepare('UPDATE notifications SET readAt = ? WHERE id = ?').run(daysAgo(31), old.id);
    db().prepare('UPDATE notifications SET readAt = ? WHERE id = ?').run(daysAgo(5), recent.id);
    db().prepare("UPDATE notifications SET mailState = 'sent', createdAt = ? WHERE id = ?").run(daysAgo(31), banMail.id);
    db().prepare('UPDATE notifications SET createdAt = ? WHERE id = ?').run(daysAgo(400), unread.id);

    expect(notifications.cleanup()).toBe(2);
    expect(rows().map(r => r.id)).toEqual([recent.id, unread.id]);
  });
});
