const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const adminItems = require('../../../services/itemList');
const { recordStatus } = require('../../../services/accessService');
const { contentType } = require('../../../services/contentTypes');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestReport
} = require('../../setup/testHelpers');

/**
 * Admin → Items: one list for links, bundles, pastes and files, with the search syntax of the old links list
 * (services/itemList.js). Everything here runs against real rows.
 */
const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';
const db = () => getTestDatabase();
const setCreated = (table, id, date) => db().prepare(`UPDATE ${table} SET createdAt = ? WHERE id = ?`).run(date, id);

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

let alice, bob;
beforeEach(async () => {
  alice = await createTestUser({ username: 'alice' });
  bob = await createTestUser({ username: 'bob' });
});

const list = (options) => adminItems.list(options);
const keys = (result) => result.rows.map(r => `${r.type}:${r.slug}`).sort();

describe('rows', () => {
  it('lists every type in one list, newest first, with the same fields', () => {
    const url = createTestUrl({ slug: 'link', creatorId: alice.id, longUrl: 'https://example.com/a', clicks: 4, maxUses: 10 });
    const bundle = createTestBundle({ slug: 'kit', creatorId: alice.id, title: 'Starter kit' });
    const paste = createTestPaste(bob.id, { slug: 'notes', title: 'Notes', views: 2 });
    const file = createTestFile(bob.id, { slug: 'doc', originalName: 'report.pdf', size: 2048, downloads: 1 });
    setCreated('urls', url.id, '2026-01-01 10:00:00');
    setCreated('bundles', bundle.id, '2026-01-02 10:00:00');
    setCreated('pastes', paste.id, '2026-01-03 10:00:00');
    setCreated('files', file.id, '2026-01-04 10:00:00');

    const { rows, total } = list({});
    expect(total).toBe(4);
    expect(rows.map(r => r.type)).toEqual(['file', 'paste', 'bundle', 'url']);
    expect(rows.find(r => r.type === 'url')).toMatchObject({
      id: url.id, slug: 'link', label: 'https://example.com/a', path: '/s/link', infoPath: '/info/link',
      ownerId: alice.id, ownerUsername: 'alice', uses: 4, usageLimit: 10, hasPassword: 0, accessStatus: 'active', reportCount: 0
    });
    expect(rows.find(r => r.type === 'bundle')).toMatchObject({ label: 'Starter kit', path: '/b/kit', infoPath: null });
    expect(rows.find(r => r.type === 'paste')).toMatchObject({ label: 'Notes', path: '/p/notes', infoPath: '/p-info/notes', uses: 2 });
    expect(rows.find(r => r.type === 'file')).toMatchObject({ label: 'report.pdf', path: '/f/doc', size: 2048, uses: 1 });
  });

  it('labels a paste without a title', () => {
    createTestPaste(alice.id, { slug: 'untitled', title: '' });
    expect(list({}).rows[0].label).toBe('Untitled paste');
  });

  it('has the same access status as the visitor gets', () => {
    createTestUrl({ slug: 'used', clicks: 3, maxUses: 3 });
    createTestBundle({ slug: 'later', activateAt: FUTURE });
    createTestPaste(alice.id, { slug: 'gone', expiresAt: PAST });
    createTestFile(alice.id, { slug: 'flagged', isQuarantined: 1 });
    for (const row of list({}).rows) {
      const record = db().prepare(`SELECT * FROM ${contentType(row.type).table} WHERE id = ?`).get(row.id);
      expect(row.accessStatus).toBe(recordStatus(row.type, record));
    }
  });

  it('says when an expired item of a registered user will be deleted', () => {
    const expiredDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
    createTestPaste(alice.id, { slug: 'old', expiresAt: expiredDaysAgo(85) });
    createTestUrl({ slug: 'anon', expiresAt: expiredDaysAgo(85) });
    const { rows } = list({});
    expect(rows.find(r => r.slug === 'old').deletesInDays).toBe(5);
    expect(rows.find(r => r.slug === 'anon').deletesInDays).toBeNull();
  });

  it('counts pending reports only', () => {
    const url = createTestUrl({ slug: 'it' });
    createTestReport({ urlId: url.id });
    createTestReport({ urlId: url.id, status: 'dismissed' });
    expect(list({}).rows[0].reportCount).toBe(1);
  });

  it('carries the tags', () => {
    const url = createTestUrl({ slug: 'tagged', creatorId: alice.id });
    const tag = db().prepare("INSERT INTO tags (name, color, userId) VALUES ('launch', '#123456', ?)").run(alice.id);
    db().prepare("INSERT INTO taggables (tagId, targetType, targetId) VALUES (?, 'url', ?)").run(tag.lastInsertRowid, url.id);
    expect(list({}).rows[0].tags.map(t => t.name)).toEqual(['launch']);
  });
});

describe('type', () => {
  beforeEach(() => {
    createTestUrl({ slug: 'u' });
    createTestBundle({ slug: 'b' });
    createTestPaste(null, { slug: 'p' });
    createTestFile(alice.id, { slug: 'f' });
  });

  it('narrows the list to one type', () => {
    expect(keys(list({ type: 'paste' }))).toEqual(['paste:p']);
    expect(list({ type: 'file' }).total).toBe(1);
  });

  it('leaves out switched-off types, also when asked for one', () => {
    configService.updateSettings({ 'features.files': false, 'features.bundles': false });
    expect(keys(list({}))).toEqual(['paste:p', 'url:u']);
    expect(list({ type: 'file' })).toMatchObject({ rows: [], total: 0 });
  });

  it('knows which types it can show', () => {
    configService.updateSettings({ 'features.pastes': false });
    expect(adminItems.types()).toEqual(['url', 'bundle', 'file']);
  });
});

describe('search', () => {
  beforeEach(() => {
    createTestUrl({ slug: 'press', longUrl: 'https://example.com/press-kit', creatorId: alice.id, clicks: 12, password: 'hash' });
    createTestUrl({ slug: 'anon-link', longUrl: 'https://other.org', clicks: 0 });
    createTestBundle({ slug: 'kit', title: 'Press bundle', creatorId: bob.id, clicks: 5 });
    createTestPaste(bob.id, { slug: 'notes', title: 'Meeting notes', views: 3 });
    createTestFile(alice.id, { slug: 'doc', originalName: 'press-release.pdf', downloads: 7 });
  });

  it('finds text in the slug, the destination or title or file name, and the owner', () => {
    expect(keys(list({ search: 'press' }))).toEqual(['bundle:kit', 'file:doc', 'url:press']);
    expect(keys(list({ search: 'meeting' }))).toEqual(['paste:notes']);
    expect(keys(list({ search: 'bob' }))).toEqual(['bundle:kit', 'paste:notes']);
  });

  it('@user: owner names, several with a comma; @user:! leaves owners out', () => {
    expect(keys(list({ search: '@user:alice' }))).toEqual(['file:doc', 'url:press']);
    expect(keys(list({ search: '@user:alice,bob' }))).toHaveLength(4);
    expect(keys(list({ search: '@user:!alice' }))).toEqual(['bundle:kit', 'paste:notes', 'url:anon-link']);
  });

  it('@anon and @user:anon: items without an owner, also together with names', () => {
    expect(keys(list({ search: '@anon' }))).toEqual(['url:anon-link']);
    expect(keys(list({ search: '@user:bob,anon' }))).toEqual(['bundle:kit', 'paste:notes', 'url:anon-link']);
  });

  it('@protected: password-protected items', () => {
    expect(keys(list({ search: '@protected' }))).toEqual(['url:press']);
  });

  it('@uses: (and @clicks:) compare clicks, views or downloads', () => {
    expect(keys(list({ search: '@uses:>5' }))).toEqual(['file:doc', 'url:press']);
    expect(keys(list({ search: '@clicks:<3' }))).toEqual(['url:anon-link']);
    expect(keys(list({ search: '@uses:3' }))).toEqual(['paste:notes']);
  });

  it('| separates alternatives', () => {
    expect(keys(list({ search: '@anon | meeting' }))).toEqual(['paste:notes', 'url:anon-link']);
  });

  it('counts what it lists', () => {
    for (const search of ['press', '@user:alice', '@anon | meeting', '@uses:>5']) {
      expect(list({ search }).total).toBe(list({ search }).rows.length);
    }
  });
});

describe('status', () => {
  beforeEach(() => {
    createTestUrl({ slug: 'live' });
    createTestUrl({ slug: 'locked', password: 'hash' });
    createTestUrl({ slug: 'used-up', clicks: 3, maxUses: 3 });
    createTestUrl({ slug: 'expired', expiresAt: PAST });
    createTestUrl({ slug: 'deactivated', deactivateAt: PAST });
    createTestUrl({ slug: 'later', activateAt: FUTURE });
    createTestUrl({ slug: 'blocked', isBlocked: 1 });
    createTestUrl({ slug: 'reported', isQuarantined: 1 });
    createTestPaste(alice.id, { slug: 'paste-blocked', isBlocked: 1 });
    createTestFile(alice.id, { slug: 'file-used', downloads: 1, maxDownloads: 1 });
    createTestBundle({ slug: 'bundle-later', activateAt: FUTURE, creatorId: alice.id });
  });

  const byStatus = (status) => keys(list({ status }));

  it('uses the shared access statuses, for every type', () => {
    expect(byStatus('active')).toEqual(['url:live', 'url:locked']);
    expect(byStatus('blocked')).toEqual(['paste:paste-blocked', 'url:blocked']);
    expect(byStatus('expired')).toEqual(['url:deactivated', 'url:expired']);
    expect(byStatus('scheduled')).toEqual(['bundle:bundle-later', 'url:later']);
    expect(byStatus('max-uses')).toEqual(['file:file-used', 'url:used-up']);
    expect(byStatus('quarantined')).toEqual(['url:reported']);
  });

  it('also filters anonymous and password-protected items', () => {
    expect(byStatus('password-protected')).toEqual(['url:locked']);
    expect(byStatus('anonymous')).toHaveLength(8);
  });

  it('@status: in the search does the same, and wins over the dropdown', () => {
    expect(keys(list({ search: '@status:max-uses' }))).toEqual(['file:file-used', 'url:used-up']);
    expect(keys(list({ search: '@status:quarantined', status: 'active' }))).toEqual(['url:reported']);
  });

  it('counts match the lists', () => {
    for (const status of ['active', 'expired', 'max-uses', 'quarantined', 'anonymous']) {
      expect(list({ status }).total).toBe(byStatus(status).length);
    }
  });
});

describe('reports, dates, sorting, pages', () => {
  it('filters on pending reports', () => {
    const reported = createTestUrl({ slug: 'reported' });
    const paste = createTestPaste(null, { slug: 'paste-reported' });
    createTestUrl({ slug: 'clean' });
    createTestReport({ urlId: reported.id });
    createTestReport({ targetType: 'paste', targetId: paste.id });
    expect(keys(list({ hasReports: 'yes' }))).toEqual(['paste:paste-reported', 'url:reported']);
    expect(keys(list({ hasReports: 'no' }))).toEqual(['url:clean']);
  });

  it('filters on the creation date (inclusive)', () => {
    setCreated('urls', createTestUrl({ slug: 'jan' }).id, '2026-01-15 12:00:00');
    setCreated('pastes', createTestPaste(null, { slug: 'feb' }).id, '2026-02-15 12:00:00');
    setCreated('urls', createTestUrl({ slug: 'mar' }).id, '2026-03-15 12:00:00');
    expect(keys(list({ dateFrom: '2026-02-01', dateTo: '2026-03-15' }))).toEqual(['paste:feb', 'url:mar']);
  });

  it('sorts by date, uses and reports', () => {
    const a = createTestUrl({ slug: 'a', clicks: 5 });
    const b = createTestPaste(null, { slug: 'b', views: 9 });
    const c = createTestFile(alice.id, { slug: 'c', downloads: 1 });
    setCreated('urls', a.id, '2026-01-01 00:00:00');
    setCreated('pastes', b.id, '2026-01-02 00:00:00');
    setCreated('files', c.id, '2026-01-03 00:00:00');
    createTestReport({ urlId: a.id });
    const order = (sort) => list({ sort }).rows.map(r => r.slug);
    expect(order('newest')).toEqual(['c', 'b', 'a']);
    expect(order('oldest')).toEqual(['a', 'b', 'c']);
    expect(order('most-used')).toEqual(['b', 'a', 'c']);
    expect(order('least-used')).toEqual(['c', 'a', 'b']);
    expect(order('most-reports')[0]).toBe('a');
    // the old links list's names still work
    expect(order('most-clicks')).toEqual(order('most-used'));
  });

  it('pages through the list', () => {
    for (let i = 0; i < 7; i++) createTestUrl({ slug: `u${i}` });
    const first = list({ limit: 3, page: 1 });
    const third = list({ limit: 3, page: 3 });
    expect(first).toMatchObject({ total: 7, totalPages: 3, page: 1, limit: 3 });
    expect(first.rows).toHaveLength(3);
    expect(third.rows).toHaveLength(1);
    expect(list({ limit: null }).rows).toHaveLength(7);
  });

  it('keeps a page number in range', () => {
    createTestUrl({ slug: 'only' });
    expect(list({ limit: 50, page: 9 })).toMatchObject({ page: 1, totalPages: 1 });
    expect(list({ limit: 50, page: 9 }).rows).toHaveLength(1);
  });
});

describe('dashboard lists (scope, tags, counts)', () => {
  const teamService = require('../../../services/teamService');
  const { createTestTag, tagItem } = require('../../setup/testHelpers');
  const toTeam = (table, id, teamId) => db().prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(teamId, id);

  it('a user scope lists only their personal items, of every type', () => {
    createTestUrl({ slug: 'a-link', creatorId: alice.id });
    createTestBundle({ slug: 'a-kit', creatorId: alice.id });
    createTestPaste(alice.id, { slug: 'a-note' });
    createTestFile(alice.id, { slug: 'a-doc' });
    createTestUrl({ slug: 'b-link', creatorId: bob.id });
    createTestUrl({ slug: 'anon' });

    expect(keys(list({ scope: alice.id }))).toEqual(['bundle:a-kit', 'file:a-doc', 'paste:a-note', 'url:a-link']);
    expect(keys(list({ scope: { userId: bob.id } }))).toEqual(['url:b-link']);
  });

  it('a team scope lists the team\'s items, and personal lists leave them out', () => {
    const owner = { id: alice.id, username: 'alice', isAdmin: 0, role: 'trusted' };
    db().prepare("UPDATE users SET role = 'trusted' WHERE id = ?").run(alice.id);
    const team = teamService.create(owner, 'Acme');
    toTeam('urls', createTestUrl({ slug: 't-link', creatorId: alice.id }).id, team.id);
    toTeam('pastes', createTestPaste(bob.id, { slug: 't-note' }).id, team.id);
    createTestUrl({ slug: 'mine', creatorId: alice.id });

    expect(keys(list({ scope: { teamId: team.id } }))).toEqual(['paste:t-note', 'url:t-link']);
    expect(keys(list({ scope: alice.id }))).toEqual(['url:mine']);
  });

  it('filters by tag name (any of the given names), for every type', () => {
    const launch = createTestTag({ name: 'launch', userId: alice.id });
    const docs = createTestTag({ name: 'docs', userId: alice.id });
    const url = createTestUrl({ slug: 'tagged', creatorId: alice.id });
    const paste = createTestPaste(alice.id, { slug: 'notes' });
    const bundle = createTestBundle({ slug: 'kit', creatorId: alice.id });
    createTestUrl({ slug: 'plain', creatorId: alice.id });
    tagItem('url', url.id, launch.id);
    tagItem('paste', paste.id, launch.id);
    tagItem('bundle', bundle.id, docs.id);

    expect(keys(list({ scope: alice.id, tags: ['launch'] }))).toEqual(['paste:notes', 'url:tagged']);
    expect(keys(list({ scope: alice.id, tags: ['launch', 'docs'] }))).toEqual(['bundle:kit', 'paste:notes', 'url:tagged']);
    expect(keys(list({ scope: alice.id, tags: [] }))).toHaveLength(4);
  });

  it('counts the matches per type, whatever type is shown', () => {
    createTestUrl({ slug: 'one', creatorId: alice.id, longUrl: 'https://example.com/report' });
    createTestUrl({ slug: 'two', creatorId: alice.id });
    createTestPaste(alice.id, { slug: 'p', title: 'report notes' });
    createTestFile(alice.id, { slug: 'f' });

    expect(list({ scope: alice.id, type: 'paste' }).counts).toEqual({ url: 2, bundle: 0, paste: 1, file: 1 });
    expect(list({ scope: alice.id, search: 'report' }).counts).toEqual({ url: 1, bundle: 0, paste: 1, file: 0 });
  });

  it('can be limited to some types (and counts only those)', () => {
    createTestUrl({ slug: 'l', creatorId: alice.id });
    createTestFile(alice.id, { slug: 'f' });
    const result = list({ scope: alice.id, types: ['url', 'paste'] });
    expect(keys(result)).toEqual(['url:l']);
    expect(result.counts).toEqual({ url: 1, paste: 0 });
    expect(keys(list({ scope: alice.id, types: ['url'], type: 'file' }))).toEqual([]);
  });

  it('sorts and pages across every type (not just links)', () => {
    createTestUrl({ slug: 'few', creatorId: alice.id, clicks: 2 });
    createTestPaste(alice.id, { slug: 'many', views: 50 });
    createTestBundle({ slug: 'some', creatorId: alice.id, clicks: 10 });

    expect(list({ scope: alice.id, sort: 'most-used' }).rows.map(r => r.slug)).toEqual(['many', 'some', 'few']);
    expect(list({ scope: alice.id, sort: 'most-used', limit: 2, page: 2 }).rows.map(r => r.slug)).toEqual(['few']);
  });
});
