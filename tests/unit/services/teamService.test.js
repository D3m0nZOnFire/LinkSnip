const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const teamService = require('../../../services/teamService');
const { TeamError } = teamService;
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile } = require('../../setup/testHelpers');

// Team membership rules. Roles: owner (everything), admin (members and all items), member, viewer.
// Site admins act as owners. Non-members don't see a team at all (404).

let alice, bob, carol, dave, root;
const asUser = (row, extra = {}) => ({ id: row.id, username: row.username, isAdmin: row.isAdmin ? 1 : 0, role: row.role, ...extra });

beforeEach(async () => {
  alice = asUser(await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' }));
  bob = asUser(await createTestUser({ username: 'bob', email: 'b@example.com', role: 'trusted' }));
  carol = asUser(await createTestUser({ username: 'carol', email: 'c@example.com' }));
  dave = asUser(await createTestUser({ username: 'dave', email: 'd@example.com' }));
  root = asUser(await createTestUser({ username: 'root', email: 'r@example.com', isAdmin: 1 }));
});

afterEach(() => {
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
});

function expectTeamError(fn, status, pattern) {
  let error;
  try { fn(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(TeamError);
  expect(error.status).toBe(status);
  if (pattern) expect(error.message).toMatch(pattern);
  return error;
}

const db = () => getTestDatabase();
const roleOf = (teamId, userId) => teamService.memberRole(userId, teamId);

// alice owns a team; bob is admin, carol member, dave viewer
function fullTeam(name = 'Acme') {
  const team = teamService.create(alice, name);
  for (const [user, role] of [[bob, 'admin'], [carol, 'member'], [dave, 'viewer']]) {
    const invite = teamService.invite(alice, team.id, user.username, role);
    teamService.acceptInvite(user, invite.id);
  }
  return team;
}

describe('create', () => {
  it('makes the creator its owner', () => {
    const team = teamService.create(alice, '  Acme  ');
    expect(team).toEqual(expect.objectContaining({ id: expect.any(Number), name: 'Acme' }));
    expect(roleOf(team.id, alice.id)).toBe('owner');
  });

  it('needs the createTeams permission (admins always have it)', () => {
    expectTeamError(() => teamService.create(carol, 'Nope'), 403);
    expect(teamService.create(root, 'Ops').name).toBe('Ops');
  });

  it.each(['', '   ', 'x'.repeat(61), 42, null])('rejects the name %j', (name) => {
    expectTeamError(() => teamService.create(alice, name), 400);
  });
});

describe('get', () => {
  it('shows members, invites, item counts and the viewer\'s role', () => {
    const team = fullTeam();
    const invite = teamService.invite(alice, team.id, 'root', 'member');
    db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, createTestUrl({ slug: 't1', creatorId: alice.id }).id);

    const page = teamService.get(alice, team.id);

    expect(page.team.name).toBe('Acme');
    expect(page.myRole).toBe('owner');
    expect(teamService.get(carol, team.id).myRole).toBe('member');
    expect(page.members.map(m => [m.username, m.role])).toEqual([
      ['alice', 'owner'], ['bob', 'admin'], ['carol', 'member'], ['dave', 'viewer']
    ]);
    expect(page.invites).toEqual([expect.objectContaining({ id: invite.id, username: 'root', role: 'member', invitedBy: 'alice' })]);
    expect(page.counts).toEqual({ url: 1, bundle: 0, paste: 0, file: 0 });
  });

  it('shows pending invites to owners and admins only', () => {
    const team = fullTeam();
    teamService.invite(alice, team.id, 'root', 'member');
    expect(teamService.get(bob, team.id).invites).toHaveLength(1);
    expect(teamService.get(carol, team.id).invites).toEqual([]);
    expect(teamService.get(dave, team.id).invites).toEqual([]);
  });

  it('is a 404 for people outside the team, but site admins see it as owners', () => {
    const team = teamService.create(alice, 'Acme');
    expectTeamError(() => teamService.get(bob, team.id), 404);
    expectTeamError(() => teamService.get(bob, 999), 404);
    expect(teamService.get(root, team.id).myRole).toBe('owner');
  });
});

describe('invites', () => {
  it('owners and admins invite by username; the invitee accepts and joins with that role', () => {
    const team = teamService.create(alice, 'Acme');
    const invite = teamService.invite(alice, team.id, 'BOB', 'admin');
    expect(invite).toEqual(expect.objectContaining({ userId: bob.id, username: 'bob', role: 'admin' }));
    expect(teamService.invitesForUser(bob)).toEqual([expect.objectContaining({ id: invite.id, teamName: 'Acme', role: 'admin', invitedBy: 'alice' })]);

    expect(teamService.acceptInvite(bob, invite.id)).toEqual({ teamId: team.id, teamName: 'Acme', role: 'admin' });
    expect(roleOf(team.id, bob.id)).toBe('admin');
    expect(teamService.invitesForUser(bob)).toEqual([]);

    // bob (admin) can invite too
    expect(teamService.invite(bob, team.id, 'carol', 'member').role).toBe('member');
  });

  it('declining removes the invite without joining', () => {
    const team = teamService.create(alice, 'Acme');
    const invite = teamService.invite(alice, team.id, 'bob', 'member');
    teamService.declineInvite(bob, invite.id);
    expect(roleOf(team.id, bob.id)).toBeNull();
    expect(teamService.get(alice, team.id).invites).toEqual([]);
  });

  it('only the invitee can answer an invite', () => {
    const team = teamService.create(alice, 'Acme');
    const invite = teamService.invite(alice, team.id, 'bob', 'member');
    expectTeamError(() => teamService.acceptInvite(carol, invite.id), 404);
    expectTeamError(() => teamService.declineInvite(carol, invite.id), 404);
  });

  it('members and viewers can\'t invite; admins can\'t invite owners', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.invite(carol, team.id, 'root', 'viewer'), 403);
    expectTeamError(() => teamService.invite(dave, team.id, 'root', 'viewer'), 403);
    expectTeamError(() => teamService.invite(bob, team.id, 'root', 'owner'), 400);
    expectTeamError(() => teamService.invite(alice, team.id, 'root', 'owner'), 400, /owner/);
  });

  it('rejects unknown people, members, a second invite and unknown roles', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.invite(alice, team.id, 'nobody', 'member'), 404, /nobody/);
    expectTeamError(() => teamService.invite(alice, team.id, 'carol', 'member'), 409, /already/);
    expectTeamError(() => teamService.invite(alice, team.id, 'alice', 'member'), 409, /already/);
    teamService.invite(alice, team.id, 'root', 'member');
    expectTeamError(() => teamService.invite(alice, team.id, 'root', 'viewer'), 409, /invited/);
    expectTeamError(() => teamService.invite(alice, team.id, 'root', 'boss'), 400);
  });

  it('owners and admins can revoke a pending invite', () => {
    const team = fullTeam();
    const invite = teamService.invite(alice, team.id, 'root', 'member');
    expectTeamError(() => teamService.revokeInvite(carol, invite.id), 403);
    expect(teamService.revokeInvite(bob, invite.id).username).toBe('root');
    expectTeamError(() => teamService.acceptInvite(root, invite.id), 404);
  });

  it('outsiders can\'t see or touch a team\'s invites', () => {
    const team = teamService.create(alice, 'Acme');
    const invite = teamService.invite(alice, team.id, 'bob', 'member');
    expectTeamError(() => teamService.invite(carol, team.id, 'dave', 'member'), 404);
    expectTeamError(() => teamService.revokeInvite(carol, invite.id), 404);
  });
});

describe('roles', () => {
  it('owners can give any role, including owner', () => {
    const team = fullTeam();
    expect(teamService.changeRole(alice, team.id, dave.id, 'owner')).toEqual({ username: 'dave', from: 'viewer', to: 'owner' });
    expect(roleOf(team.id, dave.id)).toBe('owner');
    teamService.changeRole(alice, team.id, bob.id, 'viewer');
    expect(roleOf(team.id, bob.id)).toBe('viewer');
  });

  it('admins manage members and viewers, up to admin, but not owners or other admins', () => {
    const team = fullTeam();
    teamService.changeRole(bob, team.id, carol.id, 'admin');
    expect(roleOf(team.id, carol.id)).toBe('admin');
    expectTeamError(() => teamService.changeRole(bob, team.id, dave.id, 'owner'), 403);
    expectTeamError(() => teamService.changeRole(bob, team.id, carol.id, 'member'), 403);
    expectTeamError(() => teamService.changeRole(bob, team.id, alice.id, 'member'), 403);
  });

  it('members and viewers can\'t change roles', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.changeRole(carol, team.id, dave.id, 'member'), 403);
  });

  it('the last owner can\'t be demoted; with a second owner they can', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.changeRole(alice, team.id, alice.id, 'admin'), 409, /owner/);
    teamService.changeRole(alice, team.id, bob.id, 'owner');
    teamService.changeRole(alice, team.id, alice.id, 'admin');
    expect(roleOf(team.id, alice.id)).toBe('admin');
  });

  it('rejects unknown roles and people outside the team', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.changeRole(alice, team.id, carol.id, 'boss'), 400);
    expectTeamError(() => teamService.changeRole(alice, team.id, root.id, 'member'), 404);
  });
});

describe('removing and leaving', () => {
  it('owners remove anyone but the last owner; admins only members and viewers', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.removeMember(bob, team.id, alice.id), 403);
    expect(teamService.removeMember(bob, team.id, dave.id)).toEqual({ username: 'dave', role: 'viewer' });
    expect(roleOf(team.id, dave.id)).toBeNull();
    teamService.removeMember(alice, team.id, bob.id);
    expect(roleOf(team.id, bob.id)).toBeNull();
    expectTeamError(() => teamService.removeMember(carol, team.id, alice.id), 403);
  });

  it('removing yourself goes through leave', () => {
    const team = fullTeam();
    expectTeamError(() => teamService.removeMember(bob, team.id, bob.id), 400, /leave/i);
  });

  it('anyone can leave, except the last owner', () => {
    const team = fullTeam();
    expect(teamService.leave(dave, team.id)).toEqual({ role: 'viewer' });
    expectTeamError(() => teamService.leave(alice, team.id), 409, /owner/);
    teamService.changeRole(alice, team.id, bob.id, 'owner');
    teamService.leave(alice, team.id);
    expect(roleOf(team.id, alice.id)).toBeNull();
    expectTeamError(() => teamService.leave(alice, team.id), 404);
  });

  it('items stay in the team when their creator leaves', () => {
    const team = fullTeam();
    const url = createTestUrl({ slug: 'c1', creatorId: carol.id });
    db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, url.id);
    teamService.leave(carol, team.id);
    expect(db().prepare('SELECT teamId, creatorId FROM urls WHERE id = ?').get(url.id)).toEqual({ teamId: team.id, creatorId: carol.id });
  });
});

describe('rename', () => {
  it('owners and admins rename', () => {
    const team = fullTeam();
    expect(teamService.rename(bob, team.id, ' Acme Corp ')).toEqual({ from: 'Acme', to: 'Acme Corp' });
    expectTeamError(() => teamService.rename(carol, team.id, 'X'), 403);
    expectTeamError(() => teamService.rename(alice, team.id, ''), 400);
  });
});

describe('deleteTeam', () => {
  function teamWithItems() {
    const team = fullTeam();
    const set = (table, id) => db().prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(team.id, id);
    set('urls', createTestUrl({ slug: 't1', creatorId: carol.id }).id);
    set('bundles', createTestBundle({ slug: 't2', creatorId: alice.id }).id);
    set('pastes', createTestPaste(alice.id, { slug: 't3' }).id);
    const file = createTestFile(alice.id, { slug: 't4', storedName: 'team-file.bin' });
    set('files', file.id);
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'team-file.bin'), 'x');
    const personal = createTestUrl({ slug: 'mine', creatorId: alice.id });
    return { team, personal };
  }

  it('deletes the team with its items and their uploads, after the name is typed', () => {
    const { team, personal } = teamWithItems();
    const urlId = db().prepare("SELECT id FROM urls WHERE slug = 't1'").get().id;
    db().prepare("INSERT INTO analytics_events (targetType, targetId, timestamp) VALUES ('url', ?, CURRENT_TIMESTAMP)").run(urlId);

    const result = teamService.deleteTeam(alice, team.id, 'Acme');

    expect(result).toEqual({ name: 'Acme', items: { url: 1, bundle: 1, paste: 1, file: 1 } });
    for (const slug of ['t1', 't2', 't3', 't4']) {
      for (const table of ['urls', 'bundles', 'pastes', 'files']) {
        expect(db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE slug = ?`).get(slug).n).toBe(0);
      }
    }
    expect(fs.existsSync(path.join(paths.UPLOADS_DIR, 'team-file.bin'))).toBe(false);
    expect(db().prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE targetType = 'url' AND targetId = ?").get(urlId).n).toBe(0);
    expect(db().prepare('SELECT COUNT(*) AS n FROM urls WHERE id = ?').get(personal.id).n).toBe(1);
    expectTeamError(() => teamService.get(alice, team.id), 404);
  });

  it('needs the exact name', () => {
    const { team } = teamWithItems();
    expectTeamError(() => teamService.deleteTeam(alice, team.id, 'acme'), 400, /name/);
    expectTeamError(() => teamService.deleteTeam(alice, team.id, undefined), 400);
    expect(teamService.get(alice, team.id).team.name).toBe('Acme');
  });

  it('only owners and site admins can delete', () => {
    const { team } = teamWithItems();
    expectTeamError(() => teamService.deleteTeam(bob, team.id, 'Acme'), 403);
    expectTeamError(() => teamService.deleteTeam(asUser({ id: 999, username: 'x' }), team.id, 'Acme'), 404);
    expect(teamService.deleteTeam(root, team.id, 'Acme').name).toBe('Acme');
  });
});

describe('listing', () => {
  it('listForUser: the user\'s teams with their role and member count', () => {
    const team = fullTeam();
    teamService.create(bob, 'Solo');
    expect(teamService.listForUser(carol)).toEqual([{ id: team.id, name: 'Acme', role: 'member', members: 4 }]);
    expect(teamService.listForUser(bob).map(t => [t.name, t.role])).toEqual([['Acme', 'admin'], ['Solo', 'owner']]);
  });

  it('listAll: every team with owners, member and item counts (Admin → Teams)', () => {
    const team = fullTeam();
    db().prepare('UPDATE pastes SET teamId = ? WHERE id = ?').run(team.id, createTestPaste(alice.id, { slug: 'p' }).id);
    expect(teamService.listAll()).toEqual([expect.objectContaining({
      id: team.id, name: 'Acme', owners: ['alice'], members: 4, items: { url: 0, bundle: 0, paste: 1, file: 0 }
    })]);
  });
});
