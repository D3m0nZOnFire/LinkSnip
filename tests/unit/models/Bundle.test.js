const Bundle = require('../../../models/Bundle');
const AnalyticsEvent = require('../../../models/AnalyticsEvent');
const { createTestBundle, createTestUser, createTestTag, tagItem } = require('../../setup/testHelpers');

// Editing a bundle calls replaceItems with the new list (URL + label, in order).
// Items that stay keep their ID, so their click history survives the edit.
describe('Bundle.replaceItems', () => {
  let bundle;
  beforeEach(() => { bundle = createTestBundle({ slug: 'bb' }); });

  const items = () => Bundle.getItems(bundle.id).map(i => ({ id: i.id, url: i.url, label: i.label, position: i.position }));
  const click = (itemId) => AnalyticsEvent.record({ targetType: 'bundle', targetId: bundle.id, subTargetId: itemId });
  const clicks = () => Object.fromEntries(AnalyticsEvent.getItemClicks(bundle.id).map(i => [i.url, i.clickCount]));

  it('creates the items of a new bundle in order', () => {
    Bundle.replaceItems(bundle.id, [{ url: 'https://a.example', label: 'A' }, { url: 'https://b.example' }]);
    expect(items()).toEqual([
      { id: expect.any(Number), url: 'https://a.example', label: 'A', position: 0 },
      { id: expect.any(Number), url: 'https://b.example', label: null, position: 1 }
    ]);
  });

  it('keeps the IDs and click history of items that stay, with new labels and order', () => {
    Bundle.replaceItems(bundle.id, [{ url: 'https://a.example', label: 'A' }, { url: 'https://b.example', label: 'B' }]);
    const [a, b] = items();
    click(a.id); click(a.id); click(b.id);

    Bundle.replaceItems(bundle.id, [{ url: 'https://b.example', label: 'Bee' }, { url: 'https://a.example', label: 'A' }]);

    expect(items()).toEqual([
      { id: b.id, url: 'https://b.example', label: 'Bee', position: 0 },
      { id: a.id, url: 'https://a.example', label: 'A', position: 1 }
    ]);
    expect(clicks()).toEqual({ 'https://a.example': 2, 'https://b.example': 1 });
  });

  it('adds new items and removes dropped ones (with their clicks)', () => {
    Bundle.replaceItems(bundle.id, [{ url: 'https://a.example' }, { url: 'https://gone.example' }]);
    const [a, gone] = items();
    click(a.id); click(gone.id);

    Bundle.replaceItems(bundle.id, [{ url: 'https://a.example' }, { url: 'https://new.example' }]);

    const after = items();
    expect(after.map(i => i.url)).toEqual(['https://a.example', 'https://new.example']);
    expect(after[0].id).toBe(a.id);
    expect(after.map(i => i.id)).not.toContain(gone.id);
    expect(clicks()).toEqual({ 'https://a.example': 1, 'https://new.example': 0 });
    expect(AnalyticsEvent.getTotal('bundle', bundle.id)).toBe(0); // item clicks were never bundle opens
  });

  it('matches repeated URLs one to one', () => {
    Bundle.replaceItems(bundle.id, [{ url: 'https://same.example' }, { url: 'https://same.example' }]);
    const [first, second] = items();

    Bundle.replaceItems(bundle.id, [{ url: 'https://same.example' }]);

    expect(items()).toEqual([expect.objectContaining({ id: first.id, position: 0 })]);
    expect(items().map(i => i.id)).not.toContain(second.id);
  });

  it('does not touch other bundles', () => {
    const other = createTestBundle({ slug: 'other' });
    Bundle.replaceItems(other.id, [{ url: 'https://a.example' }]);
    Bundle.replaceItems(bundle.id, [{ url: 'https://a.example' }]);
    Bundle.replaceItems(bundle.id, []);
    expect(Bundle.getItems(other.id)).toHaveLength(1);
  });
});

describe('bundle tags', () => {
  it('every way of reading a bundle includes its tags', async () => {
    const user = await createTestUser();
    const bundle = createTestBundle({ slug: 'tagged', creatorId: user.id });
    tagItem('bundle', bundle.id, createTestTag({ name: 'work', userId: user.id }).id);

    const reads = [
      Bundle.findById(bundle.id),
      Bundle.findBySlug('tagged'),
      Bundle.findByIdWithItems(bundle.id),
      Bundle.findByCreatorId(user.id)[0],
      Bundle.findAll()[0]
    ];
    for (const read of reads) expect(read.tags.map(t => t.name)).toEqual(['work']);
  });

  it('an untagged bundle has an empty list', () => {
    const bundle = createTestBundle({ slug: 'plain' });
    expect(Bundle.findById(bundle.id).tags).toEqual([]);
  });
});
