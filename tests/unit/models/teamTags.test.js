const Tag = require('../../../models/Tag');
const teamService = require('../../../services/teamService');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestUrl, createTestPaste } = require('../../setup/testHelpers');

// Team items get the team's tags; personal items keep their owner's. The same name can exist in both.

let alice, team;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', email: 'a@example.com', role: 'trusted' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  team = teamService.create(alice, 'Acme');
});

const db = () => getTestDatabase();
const toTeam = (table, id) => db().prepare(`UPDATE ${table} SET teamId = ? WHERE id = ?`).run(team.id, id);

it('tags a team item with team tags, separate from the creator\'s personal tags', () => {
  const personal = createTestUrl({ slug: 'mine', creatorId: alice.id });
  const shared = createTestUrl({ slug: 'ours', creatorId: alice.id });
  toTeam('urls', shared.id);

  Tag.setForItem('url', personal.id, ['launch']);
  Tag.setForItem('url', shared.id, ['launch', 'q4']);

  const personalTag = Tag.forItem('url', personal.id)[0];
  const teamTags = Tag.forItem('url', shared.id);
  expect(personalTag).toEqual(expect.objectContaining({ name: 'launch', userId: alice.id, teamId: null }));
  expect(teamTags.map(t => [t.name, t.userId, t.teamId])).toEqual([['launch', null, team.id], ['q4', null, team.id]]);
  expect(Tag.findByUserId(alice.id).map(t => t.name)).toEqual(['launch']);
});

it('reuses the team\'s tag for every team item', () => {
  const p = createTestPaste(alice.id, { slug: 'p' });
  const u = createTestUrl({ slug: 'u', creatorId: alice.id });
  toTeam('pastes', p.id);
  toTeam('urls', u.id);
  Tag.setForItem('paste', p.id, ['launch']);
  Tag.setForItem('url', u.id, ['launch']);
  expect(Tag.forItem('paste', p.id)[0].id).toBe(Tag.forItem('url', u.id)[0].id);
  expect(Tag.forTeam(team.id).map(t => t.name)).toEqual(['launch']);
});

it('system-wide lookups leave team tags alone', () => {
  const u = createTestUrl({ slug: 'u', creatorId: alice.id });
  toTeam('urls', u.id);
  Tag.setForItem('url', u.id, ['launch']);
  expect(Tag.findAll()).toEqual([]);
  expect(Tag.findByName('launch', null)).toBeUndefined();
});
