const Url = require('../../../models/Url');
const Bundle = require('../../../models/Bundle');
const Paste = require('../../../models/Paste');
const File = require('../../../models/File');
const teamService = require('../../../services/teamService');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile } = require('../../setup/testHelpers');

// Lists by owner take a scope: a user ID (or { userId }) lists their personal items, { teamId } a team's items.
// A user's personal lists leave out what they created in a team.

let alice, bob, team;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' });
  const b = await createTestUser({ username: 'bob', email: 'b@example.com' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  bob = { id: b.id, username: 'bob', isAdmin: 0 };
  team = teamService.create(alice, 'Acme');
  teamService.acceptInvite(bob, teamService.invite(alice, team.id, 'bob', 'member').id);
});

const toTeam = (table, id) => getTestDatabase().prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(team.id, id);
const slugs = (rows) => rows.map(r => r.slug).sort();

it('links', () => {
  createTestUrl({ slug: 'mine', creatorId: alice.id });
  toTeam('urls', createTestUrl({ slug: 'a-team', creatorId: alice.id }).id);
  toTeam('urls', createTestUrl({ slug: 'b-team', creatorId: bob.id }).id);

  expect(slugs(Url.findByCreatorId(alice.id))).toEqual(['mine']);
  expect(slugs(Url.findByCreatorId({ userId: alice.id }))).toEqual(['mine']);
  expect(slugs(Url.findByCreatorId({ teamId: team.id }))).toEqual(['a-team', 'b-team']);
  expect(slugs(Url.findByCreatorIdWithFilters(alice.id))).toEqual(['mine']);
  expect(slugs(Url.findByCreatorIdWithFilters({ teamId: team.id }, { search: 'b-' }))).toEqual(['b-team']);
  expect(Url.countByCreatorIdWithFilters(alice.id)).toBe(1);
  expect(Url.countByCreatorIdWithFilters({ teamId: team.id })).toBe(2);
});

it('bundles', () => {
  createTestBundle({ slug: 'mine', creatorId: alice.id });
  toTeam('bundles', createTestBundle({ slug: 'b-team', creatorId: bob.id }).id);
  expect(slugs(Bundle.findByCreatorId(alice.id))).toEqual(['mine']);
  expect(slugs(Bundle.findByCreatorId({ teamId: team.id }))).toEqual(['b-team']);
});

it('pastes', () => {
  createTestPaste(alice.id, { slug: 'mine' });
  toTeam('pastes', createTestPaste(bob.id, { slug: 'b-team' }).id);
  expect(slugs(Paste.findByUserId(alice.id))).toEqual(['mine']);
  expect(slugs(Paste.findByUserId(bob.id))).toEqual([]);
  expect(slugs(Paste.findByUserId({ teamId: team.id }))).toEqual(['b-team']);
});

it('files', () => {
  createTestFile(alice.id, { slug: 'mine', storedName: 'a.bin' });
  toTeam('files', createTestFile(bob.id, { slug: 'b-team', storedName: 'b.bin' }).id);
  expect(slugs(File.findByUserId(alice.id))).toEqual(['mine']);
  expect(slugs(File.findByUserId({ teamId: team.id }))).toEqual(['b-team']);
});

it('team files still count toward their creator\'s storage quota', () => {
  toTeam('files', createTestFile(bob.id, { slug: 'b-team', storedName: 'b.bin', size: 5000 }).id);
  expect(File.totalSizeByUserId(bob.id)).toBe(5000);
});
