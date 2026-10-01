const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '../../../views');
const render = (view, locals) => ejs.renderFile(path.join(VIEWS, view), locals);

const user = { id: 1, username: 'alice', isAdmin: 0 };
const hostile = '<img src=x onerror=alert(1)>';

const teamLocals = (myRole, extra = {}) => ({
  user,
  team: { id: 5, name: 'Acme', createdAt: '2026-10-01 10:00:00' },
  myRole,
  roles: ['owner', 'admin', 'member', 'viewer'],
  members: [
    { userId: 1, username: 'alice', role: 'owner', joinedAt: '2026-10-01' },
    { userId: 2, username: 'bob', role: 'member', joinedAt: '2026-10-01' }
  ],
  invites: [],
  counts: { url: 3, bundle: 0, paste: 1, file: 0 },
  features: { teams: true },
  can: {},
  ...extra
});

describe('views/teams.ejs', () => {
  const locals = (extra) => ({
    user, teams: [{ id: 5, name: 'Acme', role: 'owner', members: 2 }], invites: [], canCreate: true,
    features: { teams: true }, can: {}, ...extra
  });

  it('lists the teams with a link, the role and the member count', async () => {
    const html = await render('teams.ejs', locals());
    expect(html).toContain('href="/teams/5"');
    expect(html).toContain('Acme');
    expect(html).toMatch(/owner/i);
  });

  it('shows the create form only to those who may create teams', async () => {
    expect(await render('teams.ejs', locals())).toContain('id="createTeamForm"');
    expect(await render('teams.ejs', locals({ canCreate: false }))).not.toContain('id="createTeamForm"');
  });

  it('shows pending invites', async () => {
    const html = await render('teams.ejs', locals({ invites: [{ id: 9, teamName: 'Beta', role: 'viewer', invitedBy: 'carol' }] }));
    expect(html).toContain('Beta');
    expect(html).toContain('data-invite-id="9"');
  });

  it('escapes team names', async () => {
    const html = await render('teams.ejs', locals({ teams: [{ id: 5, name: hostile, role: 'owner', members: 1 }] }));
    expect(html).not.toContain(hostile);
  });
});

describe('views/team.ejs', () => {
  it('owners get the invite form, role controls and the danger zone', async () => {
    const html = await render('team.ejs', teamLocals('owner'));
    expect(html).toContain('id="inviteForm"');
    expect(html).toContain('data-member-id="2"');
    expect(html).toContain('id="deleteTeamBtn"');
    expect(html).toContain('3 links');
    expect(html).toContain('href="/dashboard?team=5"');
  });

  it('members see the team and can leave, but manage nothing', async () => {
    const html = await render('team.ejs', teamLocals('member'));
    expect(html).toContain('bob');
    expect(html).toContain('id="leaveTeamBtn"');
    expect(html).not.toContain('id="inviteForm"');
    expect(html).not.toContain('id="deleteTeamBtn"');
    expect(html).not.toContain('class="member-role-select');
  });

  it('admins manage but can\'t delete the team', async () => {
    const html = await render('team.ejs', teamLocals('admin'));
    expect(html).toContain('id="inviteForm"');
    expect(html).not.toContain('id="deleteTeamBtn"');
  });

  it('lists pending invites for managers', async () => {
    const html = await render('team.ejs', teamLocals('owner', {
      invites: [{ id: 4, username: 'dave', role: 'viewer', invitedBy: 'alice', createdAt: '2026-10-01' }]
    }));
    expect(html).toContain('dave');
    expect(html).toContain('data-invite-id="4"');
  });

  it('escapes the team name and usernames, also in the data for scripts', async () => {
    const html = await render('team.ejs', teamLocals('owner', {
      team: { id: 5, name: hostile }, members: [{ userId: 1, username: hostile, role: 'owner' }]
    }));
    expect(html).not.toContain(hostile);
    expect(html).not.toMatch(/<\/script><script/);
  });
});

describe('views/admin-teams.ejs', () => {
  it('lists every team with owners, members and items', async () => {
    const html = await render('admin-teams.ejs', {
      user: { ...user, isAdmin: 1 }, features: { teams: true }, can: {},
      teams: [{ id: 5, name: 'Acme', createdAt: '2026-10-01', createdBy: 'alice', owners: ['alice'], members: 3,
        items: { url: 2, bundle: 1, paste: 0, file: 4 } }]
    });
    expect(html).toContain('Acme');
    expect(html).toContain('alice');
    expect(html).toContain('href="/teams/5"');
    expect(html).toContain('data-team-id="5"');
  });
});

describe('partials/team-invites.ejs (dashboard banner)', () => {
  it('shows each invite with accept and decline', async () => {
    const html = await render('partials/team-invites.ejs', { teamInvites: [{ id: 9, teamName: 'Beta', role: 'member', invitedBy: 'carol' }] });
    expect(html).toContain('Beta');
    expect(html).toContain('carol');
    expect(html).toMatch(/data-invite-id="9"[^>]*data-action="accept"|data-action="accept"[^>]*data-invite-id="9"/);
  });

  it('renders nothing without invites', async () => {
    expect((await render('partials/team-invites.ejs', { teamInvites: [] })).trim()).toBe('');
  });
});

// The app's navigation is the sidebar (partials/sidebar)
describe('sidebar', () => {
  const sidebar = (locals) => render('partials/sidebar.ejs', { currentPage: 'home', ...locals });

  it('links to Teams when the feature is on', async () => {
    expect(await sidebar({ user, features: { teams: true } })).toContain('href="/teams"');
    expect(await sidebar({ user, features: { teams: false } })).not.toContain('href="/teams"');
  });

  it('lists Admin → Teams for admins', async () => {
    expect(await sidebar({ user: { ...user, isAdmin: 1 }, features: { teams: true } })).toContain('href="/admin/teams"');
  });
});
