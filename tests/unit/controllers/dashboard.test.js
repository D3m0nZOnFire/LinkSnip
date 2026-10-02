const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const DashboardController = require('../../../controllers/dashboardController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestTag, tagItem,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// The dashboard lists every type in one server-side list (services/itemList.js): search, type, tag, sort and paging
// apply to links, bundles, pastes and files alike.

let alice, bob;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' });
  const b = await createTestUser({ username: 'bob', email: 'b@example.com' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  bob = { id: b.id, username: 'bob', role: null, isAdmin: 0 };
});

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function dashboard(user, query = {}) {
  const res = createMockResponse();
  DashboardController.getUserDashboard(createMockRequest({
    user, session: { userId: user.id, isAdmin: false }, query, protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}
const data = (user, query) => dashboard(user, query)._viewData;
const keys = (viewData) => viewData.result.rows.map(r => `${r.type}:${r.slug}`);

describe('one list for every type', () => {
  beforeEach(() => {
    createTestUrl({ slug: 'link', creatorId: alice.id, clicks: 3 });
    createTestBundle({ slug: 'kit', creatorId: alice.id, title: 'Launch kit', clicks: 20 });
    createTestPaste(alice.id, { slug: 'note', title: 'Report notes', views: 9 });
    createTestFile(alice.id, { slug: 'doc', originalName: 'report.pdf', downloads: 1 });
    createTestUrl({ slug: 'bobs', creatorId: bob.id });
  });

  it('shows the user\'s items of every type', () => {
    expect(keys(data(alice)).sort()).toEqual(['bundle:kit', 'file:doc', 'paste:note', 'url:link']);
  });

  it('search applies to every type', () => {
    expect(keys(data(alice, { search: 'report' })).sort()).toEqual(['file:doc', 'paste:note']);
  });

  it('sort applies to every type', () => {
    expect(keys(data(alice, { sort: 'most-used' }))).toEqual(['bundle:kit', 'paste:note', 'url:link', 'file:doc']);
  });

  it('pages across every type', () => {
    const page = data(alice, { limit: '25' });
    expect(page.result).toMatchObject({ total: 4, totalPages: 1, limit: 25 });
    expect(data(alice, { limit: '9999' }).filters.limit).toBe(50);
  });

  it('filters by type and counts every type for the pills', () => {
    const view = data(alice, { type: 'paste' });
    expect(keys(view)).toEqual(['paste:note']);
    expect(view.filters.type).toBe('paste');
    expect(view.result.counts).toEqual({ url: 1, bundle: 1, paste: 1, file: 1 });
    expect(data(alice, { type: 'nonsense' }).filters.type).toBe('all');
  });

  it('filters by tag and offers the user\'s tags', () => {
    const launch = createTestTag({ name: 'launch', userId: alice.id, color: '#34d399' });
    createTestTag({ name: 'bobs-tag', userId: bob.id });
    const db = getTestDatabase();
    tagItem('bundle', db.prepare("SELECT id FROM bundles WHERE slug = 'kit'").get().id, launch.id);

    const view = data(alice, { tag: 'launch' });
    expect(keys(view)).toEqual(['bundle:kit']);
    expect(view.filters.tag).toBe('launch');
    expect(view.tagOptions.map(t => t.name)).toEqual(['launch']);
  });

  it('a user whose role cannot upload sees no files', () => {
    createTestFile(bob.id, { slug: 'old-upload' });
    const view = data(bob);
    expect(keys(view)).toEqual(['url:bobs']);
    expect(view.types).not.toContain('file');
  });

  it('leaves out switched-off types', () => {
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { bundles: false, pastes: false } }));
    configService.reload();
    const view = data(alice);
    expect(keys(view).sort()).toEqual(['file:doc', 'url:link']);
    expect(view.types).toEqual(['url', 'file']);
  });

  it('rows carry what the row actions need', () => {
    const row = data(alice).result.rows.find(r => r.slug === 'link');
    expect(row).toMatchObject({ canEdit: true, canMoveIn: false, canMoveOut: false, shareCount: 0, path: '/s/link' });
    expect(row.accessStatus).toBe('active');
  });
});

describe('teams', () => {
  it('a team dashboard lists the team\'s items and marks what the user may change', () => {
    const team = teamService.create(alice, 'Acme');
    teamService.acceptInvite(bob, teamService.invite(alice, team.id, 'bob', 'member').id);
    const db = getTestDatabase();
    const toTeam = (table, id) => db.prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(team.id, id);
    toTeam('urls', createTestUrl({ slug: 'alices', creatorId: alice.id }).id);
    toTeam('pastes', createTestPaste(bob.id, { slug: 'bobs-note' }).id);
    createTestUrl({ slug: 'personal', creatorId: bob.id });

    const view = data(bob, { team: String(team.id) });
    expect(keys(view).sort()).toEqual(['paste:bobs-note', 'url:alices']);
    const rows = Object.fromEntries(view.result.rows.map(r => [r.slug, r]));
    expect(rows.alices).toMatchObject({ canEdit: false, ownerUsername: 'alice' });
    expect(rows['bobs-note'].canEdit).toBe(true);
    expect(view.currentTeam).toMatchObject({ id: team.id, name: 'Acme', role: 'member' });
  });

  it('an unknown team is a 404', () => {
    expect(dashboard(alice, { team: '999' }).statusCode).toBe(404);
  });
});

describe('partial responses', () => {
  it('?partial=1 renders only the results (for the live search)', () => {
    createTestUrl({ slug: 'link', creatorId: alice.id });
    const res = dashboard(alice, { partial: '1', search: 'link' });
    expect(res._view).toBe('partials/dashboard-results');
    expect(keys(res._viewData)).toEqual(['url:link']);
    expect(dashboard(alice)._view).toBe('dashboard');
  });
});
