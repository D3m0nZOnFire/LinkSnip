const fs = require('fs');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const { featureRoutes } = require('../../../middleware/requireFeature');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser } = require('../../setup/testHelpers');

// The team pages and API (routes/teamRoutes.js, controllers/teamController.js).

let alice, bob, carol, root;
const asUser = (row) => ({ id: row.id, username: row.username, isAdmin: row.isAdmin ? 1 : 0, role: row.role });

beforeEach(async () => {
  alice = asUser(await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' }));
  bob = asUser(await createTestUser({ username: 'bob', email: 'b@example.com', role: 'trusted' }));
  carol = asUser(await createTestUser({ username: 'carol', email: 'c@example.com' }));
  root = asUser(await createTestUser({ username: 'root', email: 'r@example.com', isAdmin: 1 }));
});

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

function appAs(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, data });
    next();
  });
  app.use('/', featureRoutes('teams', require('../../../routes/teamRoutes')));
  return app;
}

const audit = (action) => getTestDatabase()
  .prepare('SELECT * FROM audit_logs WHERE action = ? ORDER BY id').all(action)
  .map(row => ({ ...row, details: row.details ? JSON.parse(row.details) : null }));

function teamOf(owner, name = 'Acme', members = []) {
  const team = teamService.create(owner, name);
  for (const [user, role] of members) {
    teamService.acceptInvite(user, teamService.invite(owner, team.id, user.username, role).id);
  }
  return team;
}

describe('GET /teams', () => {
  it('lists the user\'s teams and invites, and whether they can create one', async () => {
    const team = teamOf(alice);
    const invite = teamService.invite(alice, team.id, 'bob', 'member');
    teamOf(bob, 'Bobs');

    const res = await request(appAs(bob)).get('/teams');

    expect(res.body.view).toBe('teams');
    expect(res.body.data.teams.map(t => t.name)).toEqual(['Bobs']);
    expect(res.body.data.invites).toEqual([expect.objectContaining({ id: invite.id, teamName: 'Acme' })]);
    expect(res.body.data.canCreate).toBe(true);
    expect((await request(appAs(carol)).get('/teams')).body.data.canCreate).toBe(false);
  });

  it('sends visitors to the login page', async () => {
    const res = await request(appAs(null)).get('/teams');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('doesn\'t exist when features.teams is off', async () => {
    fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ features: { teams: false } }));
    configService.reload();
    expect((await request(appAs(alice)).get('/teams')).status).toBe(404);
    expect((await request(appAs(alice)).post('/api/teams').send({ name: 'X' })).status).toBe(404);
  });
});

describe('POST /api/teams', () => {
  it('creates the team and logs CREATE_TEAM', async () => {
    const res = await request(appAs(alice)).post('/api/teams').send({ name: 'Acme' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, team: expect.objectContaining({ name: 'Acme' }) });
    expect(teamService.memberRole(alice.id, res.body.team.id)).toBe('owner');
    expect(audit('CREATE_TEAM')).toEqual([expect.objectContaining({
      userId: alice.id, targetType: 'team', targetId: res.body.team.id, targetDescription: 'Acme'
    })]);
  });

  it('answers the service\'s errors as JSON with their status', async () => {
    expect((await request(appAs(carol)).post('/api/teams').send({ name: 'Acme' })).status).toBe(403);
    const bad = await request(appAs(alice)).post('/api/teams').send({ name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ success: false, error: expect.stringMatching(/name/) });
  });
});

describe('GET /teams/:id', () => {
  it('shows the team to its members', async () => {
    const team = teamOf(alice, 'Acme', [[bob, 'member']]);
    const res = await request(appAs(bob)).get(`/teams/${team.id}`);

    expect(res.body.view).toBe('team');
    expect(res.body.data.team.name).toBe('Acme');
    expect(res.body.data.myRole).toBe('member');
    expect(res.body.data.members).toHaveLength(2);
  });

  it('is a 404 page for others', async () => {
    const team = teamOf(alice);
    const res = await request(appAs(bob)).get(`/teams/${team.id}`);
    expect(res.status).toBe(404);
    expect(res.body.view).toBe('error');
  });
});

describe('team changes', () => {
  it('renames (RENAME_TEAM)', async () => {
    const team = teamOf(alice);
    const res = await request(appAs(alice)).patch(`/api/teams/${team.id}`).send({ name: 'Acme Corp' });
    expect(res.body).toEqual({ success: true, name: 'Acme Corp' });
    expect(audit('RENAME_TEAM')[0].details).toEqual({ from: 'Acme', to: 'Acme Corp' });
  });

  it('invites, and the invitee accepts (INVITE_TEAM_MEMBER, ACCEPT_TEAM_INVITE)', async () => {
    const team = teamOf(alice);
    const invited = await request(appAs(alice)).post(`/api/teams/${team.id}/invites`).send({ username: 'bob', role: 'admin' });
    expect(invited.status).toBe(201);
    expect(invited.body.invite).toEqual(expect.objectContaining({ username: 'bob', role: 'admin' }));

    const accepted = await request(appAs(bob)).post(`/api/team-invites/${invited.body.invite.id}/accept`);
    expect(accepted.body).toEqual({ success: true, teamId: team.id, teamName: 'Acme', role: 'admin' });
    expect(teamService.memberRole(bob.id, team.id)).toBe('admin');

    expect(audit('INVITE_TEAM_MEMBER')[0].details).toEqual({ username: 'bob', role: 'admin' });
    expect(audit('ACCEPT_TEAM_INVITE')[0]).toEqual(expect.objectContaining({ userId: bob.id, targetId: team.id }));
  });

  it('declines and revokes invites (DECLINE_TEAM_INVITE, REVOKE_TEAM_INVITE)', async () => {
    const team = teamOf(alice);
    const first = teamService.invite(alice, team.id, 'bob', 'member');
    expect((await request(appAs(bob)).post(`/api/team-invites/${first.id}/decline`)).body.success).toBe(true);
    const second = teamService.invite(alice, team.id, 'bob', 'member');
    expect((await request(appAs(alice)).delete(`/api/team-invites/${second.id}`)).body.success).toBe(true);
    expect(audit('DECLINE_TEAM_INVITE')).toHaveLength(1);
    expect(audit('REVOKE_TEAM_INVITE')[0].details).toEqual({ username: 'bob', role: 'member' });
  });

  it('changes roles, removes members, and members leave', async () => {
    const team = teamOf(alice, 'Acme', [[bob, 'member'], [carol, 'viewer']]);
    const app = appAs(alice);

    const changed = await request(app).patch(`/api/teams/${team.id}/members/${bob.id}`).send({ role: 'admin' });
    expect(changed.body).toEqual({ success: true, username: 'bob', from: 'member', to: 'admin' });
    expect(audit('CHANGE_TEAM_ROLE')[0].details).toEqual({ username: 'bob', from: 'member', to: 'admin' });

    expect((await request(app).delete(`/api/teams/${team.id}/members/${carol.id}`)).body.success).toBe(true);
    expect(audit('REMOVE_TEAM_MEMBER')[0].details).toEqual({ username: 'carol', role: 'viewer' });

    expect((await request(appAs(bob)).post(`/api/teams/${team.id}/leave`)).body.success).toBe(true);
    expect(audit('LEAVE_TEAM')[0]).toEqual(expect.objectContaining({ userId: bob.id, targetId: team.id }));

    const last = await request(app).post(`/api/teams/${team.id}/leave`);
    expect(last.status).toBe(409);
  });

  it('deletes with the name typed (DELETE_TEAM, with what was deleted)', async () => {
    const team = teamOf(alice);
    const wrong = await request(appAs(alice)).delete(`/api/teams/${team.id}`).send({ confirmName: 'nope' });
    expect(wrong.status).toBe(400);

    const res = await request(appAs(alice)).delete(`/api/teams/${team.id}`).send({ confirmName: 'Acme' });
    expect(res.body).toEqual({ success: true, items: { url: 0, bundle: 0, paste: 0, file: 0 } });
    expect(audit('DELETE_TEAM')[0]).toEqual(expect.objectContaining({
      category: 'ACCOUNT_CHANGE', targetId: team.id, targetDescription: 'Acme'
    }));
  });

  it('a site admin outside the team is logged as an admin action', async () => {
    const team = teamOf(alice);
    await request(appAs(root)).delete(`/api/teams/${team.id}`).send({ confirmName: 'Acme' });
    expect(audit('DELETE_TEAM')[0]).toEqual(expect.objectContaining({ category: 'ADMIN_ACTION', userId: root.id }));
  });

  it('outsiders get 404 from every team API', async () => {
    const team = teamOf(alice, 'Acme', [[bob, 'member']]);
    const app = appAs(carol);
    expect((await request(app).patch(`/api/teams/${team.id}`).send({ name: 'X' })).status).toBe(404);
    expect((await request(app).post(`/api/teams/${team.id}/invites`).send({ username: 'root', role: 'member' })).status).toBe(404);
    expect((await request(app).patch(`/api/teams/${team.id}/members/${bob.id}`).send({ role: 'viewer' })).status).toBe(404);
    expect((await request(app).delete(`/api/teams/${team.id}`).send({ confirmName: 'Acme' })).status).toBe(404);
  });
});

describe('GET /admin/teams', () => {
  it('lists every team for site admins', async () => {
    teamOf(alice);
    const res = await request(appAs(root)).get('/admin/teams');
    expect(res.body.view).toBe('admin-teams');
    expect(res.body.data.teams).toEqual([expect.objectContaining({ name: 'Acme', owners: ['alice'], members: 1 })]);
  });

  it('keeps others out', async () => {
    expect((await request(appAs(alice)).get('/admin/teams')).status).toBe(302);
  });
});
