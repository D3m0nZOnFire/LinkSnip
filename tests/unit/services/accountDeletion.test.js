const fs = require('fs');
const path = require('path');
const paths = require('../../../config/paths');
const teamService = require('../../../services/teamService');
const AnalyticsShare = require('../../../models/AnalyticsShare');
const { deleteAccount } = require('../../../services/accountDeletion');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestTag, tagItem
} = require('../../setup/testHelpers');

// Deleting an account deletes the person's personal items (links, bundles, pastes, files with their uploads),
// tags, bio page and share links. Items in teams stay with the team, without a creator.

const db = () => getTestDatabase();
const count = (table, where = '1', ...params) => db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;
const upload = (name) => path.join(paths.UPLOADS_DIR, name);

let alice, bob, team;
beforeEach(async () => {
  const a = await createTestUser({ username: 'alice', role: 'trusted' });
  const b = await createTestUser({ username: 'bob', role: 'trusted' });
  alice = { id: a.id, username: 'alice', role: 'trusted', isAdmin: 0 };
  bob = { id: b.id, username: 'bob', role: 'trusted', isAdmin: 0 };
  team = teamService.create(bob, 'Acme');
  teamService.acceptInvite(alice, teamService.invite(bob, team.id, 'alice', 'member').id);
});

afterEach(() => {
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
});

function seed() {
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
  for (const name of ['mine.bin', 'team.bin', 'bobs.bin']) fs.writeFileSync(upload(name), 'x');
  const url = createTestUrl({ slug: 'mine', creatorId: alice.id });
  createTestBundle({ slug: 'kit', creatorId: alice.id });
  createTestPaste(alice.id, { slug: 'note' });
  createTestFile(alice.id, { slug: 'doc', storedName: 'mine.bin' });
  const teamUrl = createTestUrl({ slug: 'team-link', creatorId: alice.id });
  const teamFile = createTestFile(alice.id, { slug: 'team-doc', storedName: 'team.bin' });
  db().prepare('UPDATE urls SET teamId = ? WHERE id = ?').run(team.id, teamUrl.id);
  db().prepare('UPDATE files SET teamId = ? WHERE id = ?').run(team.id, teamFile.id);
  createTestUrl({ slug: 'bobs', creatorId: bob.id });
  createTestFile(bob.id, { slug: 'bobs-doc', storedName: 'bobs.bin' });
  const tag = createTestTag({ name: 'launch', userId: alice.id });
  tagItem('url', url.id, tag.id);
  AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: alice.id, label: 'Client' });
  db().prepare("INSERT INTO analytics_events (targetType, targetId, timestamp, ipHash) VALUES ('url', ?, datetime('now'), 'h')").run(url.id);
  return { url, teamUrl, teamFile };
}

it('deletes the personal items of every type and says how many', () => {
  seed();
  const result = deleteAccount(alice.id);
  expect(result.items).toEqual({ url: 1, bundle: 1, paste: 1, file: 1 });
  expect(count('urls', "slug = 'mine'")).toBe(0);
  expect(count('bundles', "slug = 'kit'")).toBe(0);
  expect(count('pastes', "slug = 'note'")).toBe(0);
  expect(count('files', "slug = 'doc'")).toBe(0);
  expect(count('users', 'id = ?', alice.id)).toBe(0);
});

it('removes the uploads of the deleted files, and only those', () => {
  seed();
  deleteAccount(alice.id);
  expect(fs.existsSync(upload('mine.bin'))).toBe(false);
  expect(fs.existsSync(upload('team.bin'))).toBe(true);
  expect(fs.existsSync(upload('bobs.bin'))).toBe(true);
});

it('keeps team items in the team, without a creator', () => {
  const { teamUrl, teamFile } = seed();
  deleteAccount(alice.id);
  expect(db().prepare('SELECT creatorId, teamId FROM urls WHERE id = ?').get(teamUrl.id)).toEqual({ creatorId: null, teamId: team.id });
  expect(db().prepare('SELECT userId, teamId FROM files WHERE id = ?').get(teamFile.id)).toEqual({ userId: null, teamId: team.id });
});

it('takes the tags, share links and analytics of the deleted items along', () => {
  seed();
  deleteAccount(alice.id);
  expect(count('tags', 'userId = ?', alice.id)).toBe(0);
  expect(count('taggables')).toBe(0);
  expect(count('analytics_shares')).toBe(0);
  expect(count('analytics_events')).toBe(0);
});

it('leaves other people alone', () => {
  seed();
  deleteAccount(alice.id);
  expect(count('urls', "slug = 'bobs'")).toBe(1);
  expect(count('files', "slug = 'bobs-doc'")).toBe(1);
  expect(count('users', 'id = ?', bob.id)).toBe(1);
});

it('an unknown user is an error', () => {
  expect(() => deleteAccount(99999)).toThrow(/not found/i);
});

describe('both ways to delete an account use it', () => {
  const { createMockRequest, createMockResponse } = require('../../setup/testHelpers');
  const call = async (handler, req) => {
    const res = createMockResponse();
    await handler(createMockRequest({ get: () => '', ...req }), res);
    return res;
  };

  it('your own account (DELETE /api/user/account, with your password)', async () => {
    seed();
    const UserController = require('../../../controllers/userController');
    const res = await call(UserController.deleteAccount, {
      body: { password: 'password123' }, user: alice, session: { userId: alice.id, destroy: jest.fn() }
    });
    expect(res._jsonData).toEqual({ success: true });
    expect(count('urls', "slug = 'mine'")).toBe(0);
    expect(fs.existsSync(upload('mine.bin'))).toBe(false);
  });

  it('Admin → Users → Delete (audit-logged with what went)', async () => {
    seed();
    const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
    const AdminController = require('../../../controllers/adminController');
    const res = await call(AdminController.deleteUser, {
      params: { id: String(alice.id) }, user: { id: admin.id, username: 'boss', isAdmin: 1 }, session: { userId: admin.id, isAdmin: true }
    });
    expect(res._jsonData.success).toBe(true);
    expect(count('pastes', "slug = 'note'")).toBe(0);
    const log = db().prepare("SELECT details FROM audit_logs WHERE action = 'DELETE_USER'").get();
    expect(JSON.parse(log.details)).toMatchObject({ items: { url: 1, bundle: 1, paste: 1, file: 1 } });
  });
});
