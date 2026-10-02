const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const { evaluate } = require('../../../services/accessService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const pasteController = require('../../../controllers/pasteController');
const DashboardController = require('../../../controllers/dashboardController');
const Url = require('../../../models/Url');
const Bundle = require('../../../models/Bundle');
const Paste = require('../../../models/Paste');
const File = require('../../../models/File');
const Tag = require('../../../models/Tag');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestFile, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

// Items in a team: created there, moved in and out, listed on the team's dashboard.

let people, team;
beforeEach(async () => {
  people = {};
  for (const [name, extra] of [['owner', { role: 'trusted' }], ['admin', {}], ['member', { role: 'trusted' }], ['viewer', {}], ['outsider', { role: 'trusted' }]]) {
    const row = await createTestUser({ username: name, email: `${name}@example.com`, ...extra });
    people[name] = { id: row.id, username: name, isAdmin: 0, role: row.role };
  }
  team = teamService.create(people.owner, 'Acme');
  for (const [name, role] of [['admin', 'admin'], ['member', 'member'], ['viewer', 'viewer']]) {
    teamService.acceptInvite(people[name], teamService.invite(people.owner, team.id, name, role).id);
  }
});

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
});

const db = () => getTestDatabase();
const audit = (action) => db().prepare('SELECT * FROM audit_logs WHERE action = ? ORDER BY id').all(action)
  .map(row => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));

function teamsOff() {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { teams: false } }));
  configService.reload();
}

async function call(handler, user, { params = {}, body = {}, query = {} } = {}) {
  const res = createMockResponse();
  await handler(createMockRequest({
    params, body, query, user, session: { userId: user.id, isAdmin: !!user.isAdmin },
    protocol: 'http', get: () => 'localhost'
  }), res);
  return res;
}

function appAs(user, router) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    req.session = { userId: user.id, isAdmin: !!user.isAdmin };
    res.render = (view, data) => res.json({ view, data });
    next();
  });
  app.use('/', router);
  return app;
}

const ITEMS = [{ url: 'https://a.example' }, { url: 'https://b.example' }];

// Per type: create with a body as a user, then find the result by slug
const CREATE = {
  url: (user, extra) => call(UrlController.createShortUrl, user, { body: { longUrl: 'https://example.com', customSlug: 'made', ...extra } }),
  bundle: (user, extra) => call(BundleController.createBundle, user, { body: { title: 'B', items: ITEMS, customSlug: 'made', ...extra } }),
  paste: (user, extra) => call(pasteController.create, user, { body: { content: 'hi', customSlug: 'made', ...extra } })
};
const FIND = { url: () => Url.findBySlug('made'), bundle: () => Bundle.findBySlug('made'), paste: () => Paste.findBySlug('made') };

describe.each(Object.keys(CREATE))('creating a %s in a team', (type) => {
  it('members and above can; the item keeps its creator', async () => {
    await CREATE[type](people.member, { teamId: String(team.id) });
    const item = FIND[type]();
    expect(item.teamId).toBe(team.id);
    expect(item[type === 'paste' ? 'userId' : 'creatorId']).toBe(people.member.id);
  });

  it('viewers and outsiders can\'t', async () => {
    for (const user of [people.viewer, people.outsider]) {
      const res = await CREATE[type](user, { teamId: team.id });
      expect(res.statusCode).toBe(403);
      expect(FIND[type]()).toBeFalsy();
    }
  });

  it('an empty teamId creates a personal item', async () => {
    await CREATE[type](people.member, { teamId: '' });
    expect(FIND[type]().teamId).toBeNull();
  });

  it('tags go to the team', async () => {
    await CREATE[type](people.member, { teamId: team.id, tags: 'launch' });
    expect(Tag.forItem(type, FIND[type]().id)).toEqual([expect.objectContaining({ name: 'launch', teamId: team.id })]);
  });

  it('is refused while features.teams is off', async () => {
    teamsOff();
    const res = await CREATE[type](people.member, { teamId: team.id });
    expect(res.statusCode).toBe(400);
    expect(FIND[type]()).toBeFalsy();
  });
});

describe('uploading a file into a team', () => {
  function fileApp(user) {
    const app = express();
    app.use((req, res, next) => { req.user = user; req.session = { userId: user.id }; next(); });
    app.use(require('../../../routes/fileRoutes'));
    return app;
  }

  it('members with upload rights can', async () => {
    const res = await request(fileApp(people.member)).post('/api/files/upload')
      .field('teamId', String(team.id)).attach('file', Buffer.from('hello'), 'hello.txt');
    expect(res.body.success).toBe(true);
    expect(File.findBySlug(res.body.slug).teamId).toBe(team.id);
  });

  it('others can\'t, and the upload is discarded', async () => {
    const before = fs.readdirSync(paths.UPLOADS_DIR).length;
    const res = await request(fileApp(people.outsider)).post('/api/files/upload')
      .field('teamId', String(team.id)).attach('file', Buffer.from('hello'), 'hello.txt');
    expect(res.status).toBe(403);
    expect(fs.readdirSync(paths.UPLOADS_DIR)).toHaveLength(before);
  });
});

describe('moving items (POST /api/items/:type/:id/team)', () => {
  const app = (user) => appAs(user, featureRoutes('teams', require('../../../routes/teamRoutes')));
  const move = (user, type, id, teamId) => request(app(user)).post(`/api/items/${type}/${id}/team`).send({ teamId });

  it('into a team: your own item, with its tags moving to the team', async () => {
    const url = createTestUrl({ slug: 'mine', creatorId: people.member.id });
    Tag.setForItem('url', url.id, ['launch']);

    const res = await move(people.member, 'url', url.id, team.id);

    expect(res.body).toEqual({ success: true, teamId: team.id });
    expect(Url.findById(url.id).teamId).toBe(team.id);
    expect(Tag.forItem('url', url.id)).toEqual([expect.objectContaining({ name: 'launch', teamId: team.id })]);
    expect(audit('MOVE_ITEM_TO_TEAM')).toEqual([expect.objectContaining({
      userId: people.member.id, targetType: 'url', targetId: url.id,
      details: expect.objectContaining({ teamId: team.id, teamName: 'Acme' })
    })]);
  });

  it('viewers can\'t move into the team; nobody moves someone else\'s item', async () => {
    const viewers = createTestUrl({ slug: 'v', creatorId: people.viewer.id });
    expect((await move(people.viewer, 'url', viewers.id, team.id)).status).toBe(403);
    const others = createTestUrl({ slug: 'o', creatorId: people.owner.id });
    expect((await move(people.member, 'url', others.id, team.id)).status).toBe(404);
    expect(Url.findById(others.id).teamId).toBeNull();
  });

  it('out of a team: owners and admins, back to the creator\'s personal items', async () => {
    const url = createTestUrl({ slug: 'ours', creatorId: people.member.id });
    db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, url.id);
    Tag.setForItem('url', url.id, ['launch']);

    expect((await move(people.member, 'url', url.id, null)).status).toBe(403);
    const res = await move(people.admin, 'url', url.id, null);

    expect(res.body).toEqual({ success: true, teamId: null });
    expect(Url.findById(url.id)).toEqual(expect.objectContaining({ teamId: null, creatorId: people.member.id }));
    expect(Tag.forItem('url', url.id)).toEqual([expect.objectContaining({ name: 'launch', userId: people.member.id, teamId: null })]);
    expect(audit('MOVE_ITEM_FROM_TEAM')[0].details).toEqual(expect.objectContaining({ teamId: team.id, teamName: 'Acme' }));
  });

  it('works for every type', async () => {
    const file = createTestFile(people.member.id, { slug: 'f', storedName: 'f.bin' });
    expect((await move(people.member, 'file', file.id, team.id)).body.success).toBe(true);
    expect(File.findById(file.id).teamId).toBe(team.id);
  });

  it('rejects an unknown type or a missing item with 404', async () => {
    expect((await move(people.member, 'gizmo', 1, team.id)).status).toBe(404);
    expect((await move(people.member, 'url', 999, team.id)).status).toBe(404);
  });
});

describe('team dashboard (/dashboard?team=:id)', () => {
  function seed() {
    const ours = createTestUrl({ slug: 'ours', creatorId: people.member.id });
    const theirs = createTestUrl({ slug: 'theirs', creatorId: people.owner.id });
    const mine = createTestUrl({ slug: 'mine', creatorId: people.member.id });
    for (const id of [ours.id, theirs.id]) db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, id);
    return { ours, theirs, mine };
  }
  const dashboard = (user, query = {}) => call(DashboardController.getUserDashboard, user, { query });
  const bySlug = (rows) => Object.fromEntries(rows.map(r => [r.slug, r]));
  const links = (data) => data.result.rows.filter(r => r.type === 'url');

  it('lists the team\'s items with what the user may do to each', async () => {
    seed();
    const data = (await dashboard(people.member, { team: String(team.id) }))._viewData;

    expect(data.currentTeam).toEqual({ id: team.id, name: 'Acme', role: 'member' });
    const rows = bySlug(links(data));
    expect(Object.keys(rows).sort()).toEqual(['ours', 'theirs']);
    expect(rows.ours).toEqual(expect.objectContaining({ canEdit: true, canMoveOut: false, ownerUsername: 'member' }));
    expect(rows.theirs.canEdit).toBe(false);
  });

  it('team owners may edit and move out everything; viewers nothing', async () => {
    seed();
    const asOwner = bySlug(links((await dashboard(people.owner, { team: team.id }))._viewData));
    expect(asOwner.ours).toEqual(expect.objectContaining({ canEdit: true, canMoveOut: true }));
    const asViewer = bySlug(links((await dashboard(people.viewer, { team: team.id }))._viewData));
    expect(asViewer.ours.canEdit).toBe(false);
  });

  it('the personal dashboard leaves team items out, and offers the user\'s teams', async () => {
    seed();
    const data = (await dashboard(people.member))._viewData;
    expect(links(data).map(u => u.slug)).toEqual(['mine']);
    expect(data.currentTeam).toBeNull();
    expect(data.dashboardTeams).toEqual([expect.objectContaining({ id: team.id, name: 'Acme', role: 'member' })]);
    expect(links(data)[0]).toEqual(expect.objectContaining({ canEdit: true, canMoveIn: true }));
  });

  it('a team the user isn\'t in is a 404', async () => {
    seed();
    const res = await dashboard(people.outsider, { team: team.id });
    expect(res.statusCode).toBe(404);
    expect(res._view).toBe('error');
  });

  it('?team is ignored while features.teams is off', async () => {
    seed();
    teamsOff();
    const data = (await dashboard(people.member, { team: team.id }))._viewData;
    expect(links(data).map(u => u.slug)).toEqual(['mine']);
    expect(data.currentTeam).toBeNull();
    expect(data.dashboardTeams).toEqual([]);
  });
});

describe('restricted team files', () => {
  it('every team member may open them, like the owner', () => {
    const file = createTestFile(people.owner.id, { slug: 'secret', storedName: 's.bin', sharingMode: 'restricted', allowedUsers: '[]' });
    db().prepare('UPDATE files SET teamId = ? WHERE id = ?').run(team.id, file.id);
    const record = File.findById(file.id);

    expect(evaluate('file', record, { user: people.viewer }).status).toBe('active');
    expect(evaluate('file', record, { user: people.outsider }).status).toBe('forbidden');
  });
});

describe('the bio page lists personal links only', () => {
  it('a team link can\'t be added to a bio page', async () => {
    const BioController = require('../../../controllers/bioPageController');
    const url = createTestUrl({ slug: 'ours', creatorId: people.member.id });
    db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, url.id);
    const res = await call(BioController.toggleUrlOnBioPage, people.member, { params: { urlId: String(url.id) } });
    expect(res.statusCode).toBe(403);
  });
});
