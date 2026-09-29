const BundleItemAnalytics = require('../../../models/BundleItemAnalytics');
const { createTestBundle, createTestBundleItem } = require('../../setup/testHelpers');

describe('BundleItemAnalytics Model', () => {
  let bundle;
  let item1;
  let item2;

  beforeEach(() => {
    bundle = createTestBundle({ slug: `b${Date.now()}`, title: 'Test Bundle' });
    item1 = createTestBundleItem(bundle.id, { url: 'https://example.com', label: 'Site A', position: 0 });
    item2 = createTestBundleItem(bundle.id, { url: 'https://other.com', label: 'Site B', position: 1 });
  });

  describe('record', () => {
    it('should insert a bundle item analytics row', () => {
      expect(() => {
        BundleItemAnalytics.record(item1.id, bundle.id, 'abc123');
      }).not.toThrow();
    });

    it('should accept null ipHash', () => {
      expect(() => {
        BundleItemAnalytics.record(item1.id, bundle.id, null);
      }).not.toThrow();
    });

    it('should allow multiple records for the same item', () => {
      BundleItemAnalytics.record(item1.id, bundle.id, 'hash1');
      BundleItemAnalytics.record(item1.id, bundle.id, 'hash2');
      expect(BundleItemAnalytics.getTotalClicksForItem(item1.id)).toBe(2);
    });
  });

  describe('getTotalClicksForItem', () => {
    it('should return 0 when no clicks recorded', () => {
      expect(BundleItemAnalytics.getTotalClicksForItem(item1.id)).toBe(0);
    });

    it('should count only clicks for the given item', () => {
      BundleItemAnalytics.record(item1.id, bundle.id, 'h1');
      BundleItemAnalytics.record(item1.id, bundle.id, 'h2');
      BundleItemAnalytics.record(item2.id, bundle.id, 'h3');

      expect(BundleItemAnalytics.getTotalClicksForItem(item1.id)).toBe(2);
      expect(BundleItemAnalytics.getTotalClicksForItem(item2.id)).toBe(1);
    });
  });

  describe('getClicksPerItem', () => {
    it('should return all items in the bundle with click counts', () => {
      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      expect(rows).toHaveLength(2);
    });

    it('should return zero clickCount for items with no clicks', () => {
      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      rows.forEach(row => expect(row.clickCount).toBe(0));
    });

    it('should return correct click counts per item', () => {
      BundleItemAnalytics.record(item1.id, bundle.id, 'h1');
      BundleItemAnalytics.record(item1.id, bundle.id, 'h2');
      BundleItemAnalytics.record(item2.id, bundle.id, 'h3');

      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      const row1 = rows.find(r => r.itemId === item1.id);
      const row2 = rows.find(r => r.itemId === item2.id);

      expect(row1.clickCount).toBe(2);
      expect(row2.clickCount).toBe(1);
    });

    it('should include item metadata', () => {
      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      const row = rows.find(r => r.itemId === item1.id);

      expect(row.itemLabel).toBe('Site A');
      expect(row.itemUrl).toBe('https://example.com');
      expect(row.position).toBe(0);
    });

    it('should order items by position ascending', () => {
      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      expect(rows[0].position).toBeLessThanOrEqual(rows[1].position);
    });

    it('should return empty array for a bundle with no items', () => {
      const emptyBundle = createTestBundle({ slug: `empty${Date.now()}`, title: 'Empty' });
      const rows = BundleItemAnalytics.getClicksPerItem(emptyBundle.id);
      expect(rows).toEqual([]);
    });

    it('should not return items from other bundles', () => {
      const otherBundle = createTestBundle({ slug: `other${Date.now()}`, title: 'Other' });
      createTestBundleItem(otherBundle.id, { url: 'https://other.com', position: 0 });

      const rows = BundleItemAnalytics.getClicksPerItem(bundle.id);
      expect(rows).toHaveLength(2);
    });
  });
});
