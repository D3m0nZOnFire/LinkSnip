const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const adminOverview = require('../../../services/adminOverview');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestReport
} = require('../../setup/testHelpers');

const db = () => getTestDatabase();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().replace('T', ' ').slice(0, 19);

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  fs.rmSync(paths.BACKUPS_DIR, { recursive: true, force: true });
  configService.reload();
});

let alice;
beforeEach(async () => {
  alice = await createTestUser({ username: 'alice' });
});

describe('items', () => {
  it('counts each type, how many are live and how many are new this week', () => {
    createTestUrl({ slug: 'a', creatorId: alice.id });
    createTestUrl({ slug: 'b', creatorId: alice.id, isBlocked: 1 });
    const old = createTestUrl({ slug: 'c', creatorId: alice.id });
    db().prepare('UPDATE urls SET createdAt = ? WHERE id = ?').run(daysAgo(30), old.id);
    createTestBundle({ slug: 'kit', creatorId: alice.id });
    createTestPaste(alice.id, { slug: 'notes' });
    createTestFile(alice.id, { slug: 'doc' });

    const { items } = adminOverview.summary();
    expect(items.find(i => i.type === 'url')).toEqual({ type: 'url', label: 'Links', total: 3, live: 2, newThisWeek: 2 });
    expect(items.map(i => i.type)).toEqual(['url', 'bundle', 'paste', 'file']);
  });

  it('leaves out the types whose feature is off', () => {
    configService.updateSettings({ 'features.files': false, 'features.bundles': false });
    expect(adminOverview.summary().items.map(i => i.type)).toEqual(['url', 'paste']);
  });
});

describe('people', () => {
  it('counts accounts, admins, banned, new and active this week', async () => {
    await createTestUser({ username: 'boss', isAdmin: 1 });
    await createTestUser({ username: 'spam', isBanned: 1 });
    db().prepare("UPDATE users SET createdAt = ?, lastActive = ? WHERE username = 'spam'").run(daysAgo(40), daysAgo(40));
    db().prepare("UPDATE users SET lastActive = ? WHERE username IN ('alice', 'boss')").run(daysAgo(1));

    expect(adminOverview.summary().users).toEqual({ total: 3, admins: 1, banned: 1, newThisWeek: 2, activeThisWeek: 2 });
  });

  it('counts teams while the feature is on', () => {
    db().prepare("INSERT INTO teams (name, createdBy) VALUES ('Crew', ?)").run(alice.id);
    expect(adminOverview.summary().teams).toBe(1);
    configService.updateSettings({ 'features.teams': false });
    expect(adminOverview.summary().teams).toBeNull();
  });
});

describe('storage and visits', () => {
  it('adds up the size of all uploads', () => {
    createTestFile(alice.id, { slug: 'a', size: 1000 });
    createTestFile(alice.id, { slug: 'b', size: 2500 });
    expect(adminOverview.summary().storage).toEqual({ files: 2, bytes: 3500 });
  });

  it('counts visits of the last 7 days against the 7 before (bundle item clicks left out)', () => {
    const insert = db().prepare("INSERT INTO analytics_events (targetType, targetId, subTargetId, timestamp, ipHash) VALUES ('url', 1, ?, ?, 'h')");
    insert.run(null, daysAgo(1));
    insert.run(null, daysAgo(2));
    insert.run(5, daysAgo(2));
    insert.run(null, daysAgo(10));
    insert.run(null, daysAgo(30));
    expect(adminOverview.summary().visits).toEqual({ lastWeek: 2, weekBefore: 1 });
  });
});

describe('needs attention', () => {
  it('has the pending reports and the quarantined items', () => {
    const flagged = createTestUrl({ slug: 'flagged', creatorId: alice.id, isQuarantined: 1 });
    createTestReport({ urlId: flagged.id });
    createTestReport({ urlId: flagged.id, status: 'dismissed' });

    const { moderation } = adminOverview.summary();
    expect(moderation.pendingReports).toBe(1);
    expect(moderation.quarantined).toEqual([expect.objectContaining({ type: 'url', slug: 'flagged', pendingReports: 1 })]);
  });

  it('shows at most 5 quarantined items, and how many there are', () => {
    for (let i = 0; i < 7; i++) createTestUrl({ slug: `q${i}`, creatorId: alice.id, isQuarantined: 1 });
    const { moderation } = adminOverview.summary();
    expect(moderation.quarantined).toHaveLength(5);
    expect(moderation.quarantinedTotal).toBe(7);
  });

  it('leaves reports out while the feature is off', () => {
    configService.updateSettings({ 'features.reports': false });
    expect(adminOverview.summary().moderation).toBeNull();
  });
});

describe('recent activity', () => {
  it('lists the 8 newest audit entries, newest first', () => {
    const insert = db().prepare("INSERT INTO audit_logs (action, category, username, createdAt) VALUES (?, 'AUTH', 'alice', ?)");
    for (let i = 0; i < 10; i++) insert.run(`ACTION_${i}`, daysAgo(10 - i));
    const { recentActivity } = adminOverview.summary();
    expect(recentActivity).toHaveLength(8);
    expect(recentActivity[0].action).toBe('ACTION_9');
  });
});

describe('system', () => {
  it('has the version, and the newest nightly backup', () => {
    fs.mkdirSync(paths.BACKUPS_DIR, { recursive: true });
    fs.writeFileSync(path.join(paths.BACKUPS_DIR, 'database-backup-2026-09-30T03-00-00-000Z.sqlite'), 'x');
    fs.writeFileSync(path.join(paths.BACKUPS_DIR, 'database-backup-2026-10-01T03-00-00-000Z.sqlite'), 'xy');
    fs.writeFileSync(path.join(paths.BACKUPS_DIR, 'notes.txt'), 'ignored');

    const { system } = adminOverview.summary();
    expect(system.version).toBe(require('../../../package.json').version);
    expect(system.lastBackup).toEqual({ file: 'database-backup-2026-10-01T03-00-00-000Z.sqlite', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), bytes: 2 });
    expect(system.backups).toBe(2);
  });

  it('says when there is no backup yet', () => {
    expect(adminOverview.summary().system).toMatchObject({ lastBackup: null, backups: 0 });
  });
});
