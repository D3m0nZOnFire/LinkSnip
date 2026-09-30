const Tag = require('../../../models/Tag');
const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile, createTestTag, tagItem
} = require('../../setup/testHelpers');
const { getTestDatabase } = require('../../setup/testDatabase');

let owner;
let other;

beforeEach(async () => {
  owner = await createTestUser({ username: 'owner', email: 'owner@example.com' });
  other = await createTestUser({ username: 'other', email: 'other@example.com' });
});

const MAKE = {
  url: (userId = owner.id, slug = 'it') => createTestUrl({ slug, creatorId: userId }),
  bundle: (userId = owner.id, slug = 'it') => createTestBundle({ slug, creatorId: userId }),
  paste: (userId = owner.id, slug = 'it') => createTestPaste(userId, { slug }),
  file: (userId = owner.id, slug = 'it') => createTestFile(userId, { slug })
};
const TYPES = Object.keys(MAKE);
const names = (tags) => tags.map(t => t.name);
const visit = (type, id, subTargetId = null) =>
  AnalyticsEvent.record({ targetType: type, targetId: id, subTargetId, ipHash: 'h' });

describe('Tag.create', () => {
  it('lets two users have a tag with the same name', () => {
    const mine = Tag.create('Work', owner.id);
    const theirs = Tag.create('work', other.id);

    expect(theirs.id).not.toBe(mine.id);
    expect(theirs).toEqual(expect.objectContaining({ name: 'work', userId: other.id }));
  });

  it("returns the user's existing tag instead of a second one", () => {
    const first = Tag.create('work', owner.id);
    expect(Tag.create(' WORK ', owner.id).id).toBe(first.id);
  });
});

describe.each(TYPES)('tags on a %s', (type) => {
  it('setForItem creates the owner’s tags and forItem lists them by name', () => {
    const item = MAKE[type]();

    Tag.setForItem(type, item.id, ['zeta', 'Alpha', ' alpha ', '']);

    const tags = Tag.forItem(type, item.id);
    expect(names(tags)).toEqual(['alpha', 'zeta']);
    for (const tag of tags) expect(tag.userId).toBe(owner.id);
  });

  it('setForItem replaces the tags, and an empty list removes them all', () => {
    const item = MAKE[type]();
    Tag.setForItem(type, item.id, ['one', 'two']);

    Tag.setForItem(type, item.id, ['two', 'three']);
    expect(names(Tag.forItem(type, item.id))).toEqual(['three', 'two']);

    Tag.setForItem(type, item.id, []);
    expect(Tag.forItem(type, item.id)).toEqual([]);
  });

  it('uses the item owner’s tags, whoever edits it', () => {
    const item = MAKE[type](other.id);
    Tag.create('work', owner.id);

    Tag.setForItem(type, item.id, ['work']);

    expect(Tag.forItem(type, item.id)).toEqual([expect.objectContaining({ name: 'work', userId: other.id })]);
  });

  it('only touches that item', () => {
    const item = MAKE[type](owner.id, 'one');
    const sibling = MAKE[type](owner.id, 'two');
    Tag.setForItem(type, sibling.id, ['keep']);

    Tag.setForItem(type, item.id, ['new']);
    Tag.setForItem(type, item.id, []);

    expect(names(Tag.forItem(type, sibling.id))).toEqual(['keep']);
  });
});

it('keeps types apart: the same ID of another type has its own tags', () => {
  const url = MAKE.url();
  const paste = MAKE.paste();
  expect(url.id).toBe(paste.id);

  Tag.setForItem('url', url.id, ['link']);

  expect(Tag.forItem('paste', paste.id)).toEqual([]);
});

it('does not tag an item without an owner', () => {
  const paste = createTestPaste(null, { slug: 'anon' });

  Tag.setForItem('paste', paste.id, ['work']);

  expect(Tag.forItem('paste', paste.id)).toEqual([]);
  expect(getTestDatabase().prepare('SELECT COUNT(*) AS n FROM tags').get().n).toBe(0);
});

it('rejects an unknown type', () => {
  expect(() => Tag.forItem('nope', 1)).toThrow(/Unknown content type/);
  expect(() => Tag.setForItem('nope', 1, ['x'])).toThrow(/Unknown content type/);
});

describe('Tag.getAllWithStats', () => {
  it('counts the tagged items of every type and their visits', () => {
    const tag = createTestTag({ name: 'work', userId: owner.id });
    createTestTag({ name: 'empty', userId: owner.id });
    for (const type of TYPES) {
      const item = MAKE[type]();
      tagItem(type, item.id, tag.id);
      visit(type, item.id);
    }
    const bundleId = getTestDatabase().prepare("SELECT targetId FROM taggables WHERE targetType = 'bundle'").get().targetId;
    visit('bundle', bundleId, 99); // a bundle item click is not a visit of the bundle

    const stats = Tag.getAllWithStats(owner.id);

    expect(stats.map(t => t.name)).toEqual(['empty', 'work']);
    expect(stats[0]).toEqual(expect.objectContaining({ itemCount: 0, visits: 0 }));
    expect(stats[1]).toEqual(expect.objectContaining({
      itemCount: 4, visits: 4, counts: { url: 1, bundle: 1, paste: 1, file: 1 }
    }));
  });

  it('leaves out the types it is not given (a switched-off feature)', () => {
    const tag = createTestTag({ name: 'work', userId: owner.id });
    const url = MAKE.url();
    const paste = MAKE.paste();
    tagItem('url', url.id, tag.id);
    tagItem('paste', paste.id, tag.id);
    visit('paste', paste.id);

    const [stats] = Tag.getAllWithStats(owner.id, ['url']);

    expect(stats).toEqual(expect.objectContaining({ itemCount: 1, visits: 0, counts: { url: 1 } }));
  });

  it("lists only the user's own tags", () => {
    createTestTag({ name: 'mine', userId: owner.id });
    createTestTag({ name: 'theirs', userId: other.id });
    expect(Tag.getAllWithStats(owner.id).map(t => t.name)).toEqual(['mine']);
  });
});

describe('Tag.itemsFor', () => {
  it('lists the tagged items of every type with their name and visits, newest first', () => {
    const tag = createTestTag({ name: 'work', userId: owner.id });
    const db = getTestDatabase();
    const made = {};
    TYPES.forEach((type, i) => {
      made[type] = MAKE[type]();
      tagItem(type, made[type].id, tag.id);
      db.prepare(`UPDATE ${{ url: 'urls', bundle: 'bundles', paste: 'pastes', file: 'files' }[type]} SET createdAt = ? WHERE id = ?`)
        .run(`2026-01-0${i + 1} 00:00:00`, made[type].id);
    });
    visit('file', made.file.id);
    visit('file', made.file.id);
    MAKE.url(owner.id, 'untagged');

    const items = Tag.itemsFor(tag.id);

    expect(items.map(i => i.type)).toEqual(['file', 'paste', 'bundle', 'url']);
    expect(items[0]).toEqual(expect.objectContaining({ id: made.file.id, slug: 'it', visits: 2 }));
    expect(items.find(i => i.type === 'url').name).toBe(made.url.longUrl);
    expect(items.find(i => i.type === 'file').name).toBe(made.file.originalName);
  });

  it('leaves out the types it is not given', () => {
    const tag = createTestTag({ name: 'work', userId: owner.id });
    tagItem('url', MAKE.url().id, tag.id);
    tagItem('paste', MAKE.paste().id, tag.id);

    expect(Tag.itemsFor(tag.id, ['paste']).map(i => i.type)).toEqual(['paste']);
  });
});

describe('Tag.dailyVisits', () => {
  it('sums the visits of every tagged item per day over recent days', () => {
    const tag = createTestTag({ name: 'work', userId: owner.id });
    const url = MAKE.url();
    const paste = MAKE.paste();
    tagItem('url', url.id, tag.id);
    tagItem('paste', paste.id, tag.id);
    visit('url', url.id);
    visit('paste', paste.id);
    visit('paste', paste.id);
    visit('file', MAKE.file().id);
    const old = visit('url', url.id);
    getTestDatabase().prepare("UPDATE analytics_events SET timestamp = '2000-01-01 00:00:00' WHERE id = ?").run(old.id);

    const today = new Date().toISOString().split('T')[0];
    expect(Tag.dailyVisits(tag.id, TYPES, 30)).toEqual([{ date: today, count: 3 }]);
    expect(Tag.dailyVisits(tag.id, ['url'], 30)).toEqual([{ date: today, count: 1 }]);
  });
});

it('deleting a tag removes it from every item', () => {
  const url = MAKE.url();
  const file = MAKE.file();
  Tag.setForItem('url', url.id, ['work']);
  Tag.setForItem('file', file.id, ['work', 'docs']);

  Tag.delete(Tag.findByName('work', owner.id).id);

  expect(Tag.forItem('url', url.id)).toEqual([]);
  expect(names(Tag.forItem('file', file.id))).toEqual(['docs']);
});
