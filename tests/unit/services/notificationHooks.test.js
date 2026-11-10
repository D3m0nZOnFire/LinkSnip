const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const mailService = require('../../../services/mailService');
const notifications = require('../../../services/notificationService');
const moderation = require('../../../services/moderationService');
const teamService = require('../../../services/teamService');
const ScheduledTasks = require('../../../services/scheduledTasks');
const ReportController = require('../../../controllers/reportController');
const AdminController = require('../../../controllers/adminController');
const adminItems = require('../../../controllers/adminItemController');
const Report = require('../../../models/Report');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Where events come from: reports and moderation, admin actions, usage limits, teams, and the scheduled scans.

const db = () => getTestDatabase();
const events = (userId) => db().prepare('SELECT event, targetType, targetId, payload FROM notifications WHERE userId = ? ORDER BY id')
  .all(userId).map(r => ({ ...r, payload: JSON.parse(r.payload) }));
const names = (userId) => events(userId).map(e => e.event);
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const DAY = 86400000;
const HOUR = 3600000;

function setSettings(data) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(data));
  configService.reload();
}
function mailOn() {
  mailService.configure({
    transport: 'smtp', host: 'h', port: 465, secure: true, user: 'u', pass: 'p', from: 'x@example.com',
    replyTo: null, publicUrl: 'https://l.example'
  }, { transport: { sendMail: jest.fn(async () => ({})) } });
}
async function confirmedUser(username, extra = {}) {
  const user = await createTestUser({ username, email: `${username}@example.com`, ...extra });
  db().prepare("UPDATE users SET emailVerifiedAt = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(user.id);
  return { ...user, isAdmin: user.isAdmin ? 1 : 0 };
}
const adminReq = (admin, extra = {}) => createMockRequest({
  user: admin, session: { userId: admin.id, isAdmin: true }, get: () => undefined, ...extra
});
function report(type, id, ip, user = null) {
  const res = createMockResponse();
  ReportController.submit(createMockRequest({ body: { type, id, reason: 'SPAM' }, ip, user, get: () => undefined }), res);
  return res;
}

let owner, admin;
beforeEach(async () => {
  owner = await confirmedUser('owner');
  admin = await confirmedUser('root', { isAdmin: 1 });
});
afterEach(() => {
  mailService.configure(null);
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('reports and quarantine', () => {
  it('tells the owner about each report', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    report('url', url.id, '203.0.113.1');
    expect(events(owner.id)).toEqual([expect.objectContaining({
      event: 'report_received', targetType: 'url', targetId: url.id,
      payload: expect.objectContaining({ item: expect.objectContaining({ address: '/s/abc' }) })
    })]);
  });

  it('not when owners report their own item', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    report('url', url.id, '203.0.113.1', owner);
    expect(names(owner.id)).toEqual([]);
  });

  it('replaces the unsent report notices by the quarantine', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    report('url', url.id, '203.0.113.1');
    report('url', url.id, '203.0.113.2');
    report('url', url.id, '203.0.113.3');
    expect(names(owner.id)).toEqual(['quarantined']);
  });

  it('tells the owner when an admin lifts the quarantine or blocks the item', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id, isQuarantined: 1 });
    const paste = createTestPaste(owner.id, { slug: 'txt', isQuarantined: 1 });
    moderation.clear('url', url.id, adminReq(admin));
    moderation.block('paste', paste.id, adminReq(admin));
    expect(names(owner.id)).toEqual(['quarantine_cleared', 'blocked']);
  });

  it('tells the owner about blocks and unblocks from a single report', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    const r = Report.create({ targetType: 'url', targetId: url.id, reporterIp: '203.0.113.9', reason: 'SPAM' });
    const found = Report.findById(r.id);
    moderation.setBlockedFromReport(found, true, adminReq(admin));
    moderation.setBlockedFromReport(found, false, adminReq(admin));
    expect(names(owner.id)).toEqual(['blocked', 'unblocked']);
  });

  it('mails the ban (and nothing about the items it blocks)', () => {
    mailOn();
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    createTestPaste(owner.id, { slug: 'txt' });
    const r = Report.create({ targetType: 'url', targetId: url.id, reporterIp: '203.0.113.9', reason: 'SPAM' });
    moderation.banOwnerFromReport(Report.findById(r.id), owner.id, adminReq(admin));
    expect(names(owner.id)).toEqual(['account_banned']);
  });
});

describe('admin actions', () => {
  it('Admin → Users ban (and the edit form) mails the ban; unban says nothing', () => {
    mailOn();
    AdminController.banUser(adminReq(admin, { params: { id: String(owner.id) }, body: { banned: true } }), createMockResponse());
    expect(names(owner.id)).toEqual(['account_banned']);
    AdminController.banUser(adminReq(admin, { params: { id: String(owner.id) }, body: { banned: false } }), createMockResponse());
    expect(names(owner.id)).toEqual(['account_banned']);
  });

  it('Admin → Items block and unblock, single and bulk', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id });
    const bundle = createTestBundle({ slug: 'bun', creatorId: owner.id });
    adminItems.block(adminReq(admin, { params: { type: 'url', id: String(url.id) } }), createMockResponse());
    adminItems.unblock(adminReq(admin, { params: { type: 'url', id: String(url.id) } }), createMockResponse());
    adminItems.bulkBlock(adminReq(admin, { params: { type: 'bundle' }, body: { ids: [bundle.id] } }), createMockResponse());
    expect(events(owner.id).map(e => [e.event, e.targetType])).toEqual([['blocked', 'url'], ['unblocked', 'url'], ['blocked', 'bundle']]);
  });

  it('not when admins block their own item', () => {
    const url = createTestUrl({ slug: 'mine', creatorId: admin.id });
    adminItems.block(adminReq(admin, { params: { type: 'url', id: String(url.id) } }), createMockResponse());
    expect(names(admin.id)).toEqual([]);
  });
});

describe('usage limits', () => {
  it('tells the owner once when an item reaches its limit', () => {
    const url = createTestUrl({ slug: 'abc', creatorId: owner.id, maxUses: 2, clicks: 1 });
    db().prepare('UPDATE urls SET clicks = 2 WHERE id = ?').run(url.id);
    notifications.afterUse('url', url.id);
    db().prepare('UPDATE urls SET clicks = 3 WHERE id = ?').run(url.id);
    notifications.afterUse('url', url.id);
    expect(events(owner.id)).toEqual([expect.objectContaining({
      event: 'limit_reached', payload: expect.objectContaining({ limit: 2, unit: 'clicks' })
    })]);
  });

  it('again after the owner raised the limit and it was reached again', () => {
    const paste = createTestPaste(owner.id, { slug: 'txt', maxViews: 1, views: 1 });
    notifications.afterUse('paste', paste.id);
    db().prepare('UPDATE pastes SET maxViews = 2, views = 2 WHERE id = ?').run(paste.id);
    notifications.afterUse('paste', paste.id);
    expect(names(owner.id)).toEqual(['limit_reached', 'limit_reached']);
  });

  it('nothing below the limit or without one', () => {
    const a = createTestUrl({ slug: 'a', creatorId: owner.id, maxUses: 5, clicks: 2 });
    const b = createTestUrl({ slug: 'b', creatorId: owner.id, clicks: 100 });
    notifications.afterUse('url', a.id);
    notifications.afterUse('url', b.id);
    notifications.afterUse('url', 9999);
    expect(names(owner.id)).toEqual([]);
  });

  it('is called by the public routes after counting', () => {
    const sources = ['urlController', 'bundleController', 'pasteController', 'fileController']
      .map(name => fs.readFileSync(require.resolve(`../../../controllers/${name}`), 'utf8'));
    for (const source of sources) expect(source).toMatch(/notifications\.afterUse\(/);
  });
});

describe('teams', () => {
  let ann, bob, team;
  const asUser = (row) => ({ id: row.id, username: row.username, isAdmin: 0, role: 'trusted' });
  beforeEach(async () => {
    ann = asUser(await confirmedUser('ann', { role: 'trusted' }));
    bob = asUser(await confirmedUser('bob'));
    team = teamService.create(ann, 'Ops');
  });

  it('tells the invitee who invited them, to what and as what', () => {
    teamService.invite(ann, team.id, 'bob', 'member');
    expect(events(bob.id)).toEqual([expect.objectContaining({
      event: 'team_invited', targetType: 'team', targetId: team.id,
      payload: { team: { id: team.id, name: 'Ops' }, role: 'member', by: 'ann' }
    })]);
  });

  it('tells members about a new role, being removed and the team being deleted (not the one who did it)', () => {
    const invite = teamService.invite(ann, team.id, 'bob', 'member');
    teamService.acceptInvite(bob, invite.id);
    teamService.changeRole(ann, team.id, bob.id, 'admin');
    teamService.removeMember(ann, team.id, bob.id);
    expect(names(bob.id)).toEqual(['team_invited', 'team_role_changed', 'team_removed']);

    const again = teamService.invite(ann, team.id, 'bob', 'viewer');
    teamService.acceptInvite(bob, again.id);
    teamService.deleteTeam(ann, team.id, 'Ops');
    expect(names(bob.id).at(-1)).toBe('team_deleted');
    expect(names(ann.id)).toEqual([]);
  });
});

describe('scheduled scans', () => {
  it('warns once before an item expires (notifications.expiryWarningDays)', () => {
    setSettings({ notifications: { expiryWarningDays: 3 } });
    const soon = createTestUrl({ slug: 'soon', creatorId: owner.id, expiresAt: iso(2 * DAY) });
    createTestUrl({ slug: 'later', creatorId: owner.id, expiresAt: iso(5 * DAY) });
    createTestUrl({ slug: 'anon', creatorId: null, expiresAt: iso(DAY) });
    createTestFile(owner.id, { slug: 'doc', deactivateAt: iso(DAY) });
    db().prepare("UPDATE urls SET createdAt = '2026-01-01 00:00:00'").run();
    db().prepare("UPDATE files SET createdAt = '2026-01-01 00:00:00'").run();

    ScheduledTasks.notifyLifecycle();
    ScheduledTasks.notifyLifecycle();
    expect(events(owner.id).map(e => [e.event, e.payload.item.slug, e.payload.days])).toEqual([
      ['expires_soon', 'soon', 2], ['expires_soon', 'doc', 1]
    ]);
    expect(events(owner.id)[0].targetId).toBe(soon.id);
  });

  it('no warning for items made to last less than the warning period', () => {
    createTestUrl({ slug: 'short', creatorId: owner.id, expiresAt: iso(DAY) });
    ScheduledTasks.notifyLifecycle();
    expect(names(owner.id)).toEqual([]);
  });

  it('tells the owner once an item expired, with the days left before deletion', () => {
    setSettings({ retention: { expiredGraceDays: 90 } });
    createTestUrl({ slug: 'gone', creatorId: owner.id, expiresAt: iso(-HOUR) });
    createTestPaste(owner.id, { slug: 'txt', deactivateAt: iso(-2 * HOUR) });
    createTestBundle({ slug: 'bun', creatorId: owner.id, expiresAt: iso(-HOUR) });
    createTestUrl({ slug: 'ancient', creatorId: owner.id, expiresAt: iso(-10 * DAY) });

    ScheduledTasks.notifyLifecycle();
    ScheduledTasks.notifyLifecycle();
    const found = Object.fromEntries(events(owner.id).map(e => [e.payload.item.slug, e]));
    expect(Object.keys(found).sort()).toEqual(['bun', 'gone', 'txt']);
    expect(found.gone.event).toBe('expired');
    expect(found.gone.payload.days).toBe(90);
    expect(found.bun.payload.days).toBeNull(); // registered bundles are not deleted
  });

  it('a file is deleted at the next cleanup: 0 days', () => {
    createTestFile(owner.id, { slug: 'doc', expiresAt: iso(-HOUR) });
    ScheduledTasks.notifyLifecycle();
    expect(events(owner.id)[0].payload.days).toBe(0);
  });

  it('says nothing about blocked items', () => {
    createTestUrl({ slug: 'x', creatorId: owner.id, expiresAt: iso(-HOUR), isBlocked: 1 });
    ScheduledTasks.notifyLifecycle();
    expect(names(owner.id)).toEqual([]);
  });

  it('tells owners about expired items the nightly cleanup deletes', () => {
    setSettings({ retention: { expiredGraceDays: 0 } });
    createTestUrl({ slug: 'old', creatorId: owner.id, expiresAt: iso(-DAY) });
    createTestPaste(owner.id, { slug: 'txt', expiresAt: iso(-DAY) });
    createTestUrl({ slug: 'anon', creatorId: null, expiresAt: iso(-DAY) });
    ScheduledTasks.cleanupInactiveUrls();
    createTestFile(owner.id, { slug: 'doc', expiresAt: iso(-DAY) });
    ScheduledTasks.cleanupExpiredFiles();
    const deleted = events(owner.id).filter(e => e.event === 'deleted_by_cleanup');
    expect(deleted.map(e => e.payload.item.slug).sort()).toEqual(['doc', 'old', 'txt']);
    expect(deleted.every(e => e.payload.item.path === null)).toBe(true);
    expect(db().prepare('SELECT COUNT(*) AS n FROM urls').get().n).toBe(0);
  });
});
