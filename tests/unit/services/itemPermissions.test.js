const { canView, canEdit, actor } = require('../../../services/itemPermissions');

// Who may see and change an item. Teams will add to these rules; everything that checks ownership goes through here.

const owner = { id: 7, isAdmin: 0 };
const stranger = { id: 8, isAdmin: 0 };
const admin = { id: 9, isAdmin: 1 };

const ITEMS = {
  url: { id: 1, creatorId: 7 },
  bundle: { id: 1, creatorId: 7 },
  paste: { id: 1, userId: 7 },
  file: { id: 1, userId: 7 }
};

describe.each(Object.entries(ITEMS))('%s', (type, item) => {
  it.each([['canView', canView], ['canEdit', canEdit]])('%s: the owner and admins yes, others no', (name, check) => {
    expect(check(owner, type, item)).toBe(true);
    expect(check(admin, type, item)).toBe(true);
    expect(check(stranger, type, item)).toBe(false);
    expect(check(null, type, item)).toBe(false);
  });

  it('an item without an owner (anonymous) belongs to nobody but admins', () => {
    const anonymous = { id: 2, creatorId: null, userId: null };
    expect(canEdit(stranger, type, anonymous)).toBe(false);
    expect(canEdit({ id: null }, type, anonymous)).toBe(false);
    expect(canEdit(admin, type, anonymous)).toBe(true);
  });
});

it('reads the owner column of the type, not the other one', () => {
  expect(canEdit(owner, 'paste', { id: 1, creatorId: 7, userId: 8 })).toBe(false);
  expect(canEdit(owner, 'url', { id: 1, creatorId: 8, userId: 7 })).toBe(false);
});

it('throws on an unknown type (programmer error)', () => {
  expect(() => canEdit(owner, 'gizmo', {})).toThrow(/Unknown content type/);
});

describe('actor', () => {
  it('is req.user when set (fresh from the database)', () => {
    const user = { id: 3, isAdmin: 0 };
    expect(actor({ user, session: { userId: 3, isAdmin: true } })).toBe(user);
  });

  it('falls back to the session', () => {
    expect(actor({ session: { userId: 3, isAdmin: true } })).toEqual({ id: 3, isAdmin: true });
  });

  it('is null for visitors', () => {
    expect(actor({ session: {} })).toBeNull();
    expect(actor({})).toBeNull();
  });
});

describe('team items', () => {
  const { canMoveToTeam, canMoveFromTeam } = require('../../../services/itemPermissions');
  const teamService = require('../../../services/teamService');
  const { createTestUser } = require('../../setup/testHelpers');

  let people, team;
  beforeEach(async () => {
    people = {};
    for (const [name, extra] of [['owner', { role: 'trusted' }], ['admin', {}], ['member', {}], ['other', {}], ['viewer', {}], ['outsider', {}], ['root', { isAdmin: 1 }]]) {
      const row = await createTestUser({ username: name, email: `${name}@example.com`, ...extra });
      people[name] = { id: row.id, username: name, isAdmin: row.isAdmin ? 1 : 0, role: row.role };
    }
    team = teamService.create(people.owner, 'Acme');
    for (const [name, role] of [['admin', 'admin'], ['member', 'member'], ['other', 'member'], ['viewer', 'viewer']]) {
      teamService.acceptInvite(people[name], teamService.invite(people.owner, team.id, name, role).id);
    }
  });

  // Each type, created by "member" in the team
  const teamItem = (type) => ({ ...ITEMS[type], [type === 'url' || type === 'bundle' ? 'creatorId' : 'userId']: people.member.id, teamId: team.id });

  describe.each(Object.keys(ITEMS))('%s', (type) => {
    it('every member sees it; outsiders don\'t', () => {
      for (const name of ['owner', 'admin', 'member', 'other', 'viewer', 'root']) expect(canView(people[name], type, teamItem(type))).toBe(true);
      expect(canView(people.outsider, type, teamItem(type))).toBe(false);
      expect(canView(null, type, teamItem(type))).toBe(false);
    });

    it('owners and admins edit every team item, members their own, viewers none', () => {
      const item = teamItem(type);
      expect(canEdit(people.owner, type, item)).toBe(true);
      expect(canEdit(people.admin, type, item)).toBe(true);
      expect(canEdit(people.member, type, item)).toBe(true);
      expect(canEdit(people.other, type, item)).toBe(false);
      expect(canEdit(people.viewer, type, item)).toBe(false);
      expect(canEdit(people.outsider, type, item)).toBe(false);
      expect(canEdit(people.root, type, item)).toBe(true);
    });

    it('a creator who left the team loses access to what they made there', () => {
      teamService.leave(people.member, team.id);
      expect(canView(people.member, type, teamItem(type))).toBe(false);
      expect(canEdit(people.member, type, teamItem(type))).toBe(false);
    });
  });

  describe('moving', () => {
    const personal = (user) => ({ id: 1, creatorId: user.id, teamId: null });

    it('into a team: your own personal item, into a team where you are member or above', () => {
      expect(canMoveToTeam(people.member, 'url', personal(people.member), team.id)).toBe(true);
      expect(canMoveToTeam(people.owner, 'url', personal(people.owner), team.id)).toBe(true);
      expect(canMoveToTeam(people.viewer, 'url', personal(people.viewer), team.id)).toBe(false);
      expect(canMoveToTeam(people.outsider, 'url', personal(people.outsider), team.id)).toBe(false);
      expect(canMoveToTeam(people.member, 'url', personal(people.other), team.id)).toBe(false);
      expect(canMoveToTeam(people.member, 'url', teamItem('url'), team.id)).toBe(false);
    });

    it('out of a team: team owners and admins (and site admins), back to the creator', () => {
      expect(canMoveFromTeam(people.owner, 'url', teamItem('url'))).toBe(true);
      expect(canMoveFromTeam(people.admin, 'url', teamItem('url'))).toBe(true);
      expect(canMoveFromTeam(people.root, 'url', teamItem('url'))).toBe(true);
      expect(canMoveFromTeam(people.member, 'url', teamItem('url'))).toBe(false);
      expect(canMoveFromTeam(people.owner, 'url', personal(people.owner))).toBe(false);
      expect(canMoveFromTeam(people.owner, 'url', { ...teamItem('url'), creatorId: null })).toBe(false);
    });
  });
});
