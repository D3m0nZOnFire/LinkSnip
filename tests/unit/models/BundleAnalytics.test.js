const BundleAnalytics = require('../../../models/BundleAnalytics');
const { createTestBundle } = require('../../setup/testHelpers');

describe('BundleAnalytics Model', () => {
  let bundle;

  beforeEach(() => {
    bundle = createTestBundle({ slug: `b${Date.now()}`, title: 'Test Bundle' });
  });

  describe('record', () => {
    it('should insert a bundle analytics row', () => {
      expect(() => {
        BundleAnalytics.record({
          bundleId: bundle.id,
          ipHash: 'abc123',
          referrer: 'https://google.com',
          userAgent: 'Mozilla/5.0',
          browser: 'Chrome',
          os: 'Windows',
          device: 'Desktop',
          country: 'CH'
        });
      }).not.toThrow();
    });

    it('should record with null optional fields', () => {
      expect(() => {
        BundleAnalytics.record({
          bundleId: bundle.id,
          ipHash: null,
          referrer: null,
          userAgent: null,
          browser: null,
          os: null,
          device: null,
          country: null
        });
      }).not.toThrow();
    });

    it('should increment total clicks on each record', () => {
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(0);
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'h1', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'h2', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(2);
    });
  });

  describe('getTotalClicks', () => {
    it('should return 0 when no analytics recorded', () => {
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(0);
    });

    it('should return correct count after multiple records', () => {
      for (let i = 0; i < 5; i++) {
        BundleAnalytics.record({ bundleId: bundle.id, ipHash: `h${i}`, referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      }
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(5);
    });

    it('should not count rows from another bundle', () => {
      const other = createTestBundle({ slug: `other${Date.now()}`, title: 'Other' });
      BundleAnalytics.record({ bundleId: other.id, ipHash: 'hx', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(0);
    });
  });

  describe('getReferrerStats', () => {
    it('should return empty array when no data', () => {
      expect(BundleAnalytics.getReferrerStats(bundle.id)).toEqual([]);
    });

    it('should aggregate referrers by count descending', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: 'https://google.com', userAgent: null, browser: null, os: null, device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'b', referrer: 'https://google.com', userAgent: null, browser: null, os: null, device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'c', referrer: 'https://twitter.com', userAgent: null, browser: null, os: null, device: null, country: null });

      const stats = BundleAnalytics.getReferrerStats(bundle.id);
      expect(stats[0].referrer).toBe('https://google.com');
      expect(stats[0].count).toBe(2);
      expect(stats[1].referrer).toBe('https://twitter.com');
      expect(stats[1].count).toBe(1);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        BundleAnalytics.record({ bundleId: bundle.id, ipHash: `h${i}`, referrer: `https://site${i}.com`, userAgent: null, browser: null, os: null, device: null, country: null });
      }
      const stats = BundleAnalytics.getReferrerStats(bundle.id, 3);
      expect(stats.length).toBe(3);
    });
  });

  describe('getBrowserStats', () => {
    it('should return browser counts', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: 'Chrome', os: null, device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'b', referrer: null, userAgent: null, browser: 'Chrome', os: null, device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'c', referrer: null, userAgent: null, browser: 'Firefox', os: null, device: null, country: null });

      const stats = BundleAnalytics.getBrowserStats(bundle.id);
      const chrome = stats.find(s => s.browser === 'Chrome');
      expect(chrome.count).toBe(2);
    });
  });

  describe('getOsStats', () => {
    it('should return OS counts', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: 'Windows', device: null, country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'b', referrer: null, userAgent: null, browser: null, os: 'macOS', device: null, country: null });

      const stats = BundleAnalytics.getOsStats(bundle.id);
      expect(stats.length).toBe(2);
    });
  });

  describe('getDeviceStats', () => {
    it('should return device counts', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: null, device: 'Desktop', country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'b', referrer: null, userAgent: null, browser: null, os: null, device: 'Mobile', country: null });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'c', referrer: null, userAgent: null, browser: null, os: null, device: 'Desktop', country: null });

      const stats = BundleAnalytics.getDeviceStats(bundle.id);
      const desktop = stats.find(s => s.device === 'Desktop');
      expect(desktop.count).toBe(2);
    });
  });

  describe('getCountryStats', () => {
    it('should return country counts', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: null, device: null, country: 'CH' });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'b', referrer: null, userAgent: null, browser: null, os: null, device: null, country: 'CH' });
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'c', referrer: null, userAgent: null, browser: null, os: null, device: null, country: 'FR' });

      const stats = BundleAnalytics.getCountryStats(bundle.id);
      expect(stats[0].country).toBe('CH');
      expect(stats[0].count).toBe(2);
    });
  });

  describe('getClicksByDate', () => {
    it('should return 30 days of zeros when no data', () => {
      const result = BundleAnalytics.getClicksByDate(bundle.id);
      expect(result.data).toHaveLength(30);
      expect(result.period).toBe('Last 30 Days');
      expect(result.data.every(d => d.count === 0)).toBe(true);
    });

    it('should include recorded clicks on the correct date', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });

      const result = BundleAnalytics.getClicksByDate(bundle.id);
      const today = new Date().toISOString().split('T')[0];
      const todayEntry = result.data.find(d => d.date === today);
      expect(todayEntry).toBeDefined();
      expect(todayEntry.count).toBe(1);
    });

    it('should return period label matching data range', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      const result = BundleAnalytics.getClicksByDate(bundle.id);
      expect(result.period).toBe('Last 30 Days');
    });
  });

  describe('getSummary', () => {
    it('should return all summary fields', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: 'https://google.com', userAgent: 'ua', browser: 'Chrome', os: 'Windows', device: 'Desktop', country: 'CH' });

      const summary = BundleAnalytics.getSummary(bundle.id);
      expect(summary).toHaveProperty('totalClicks', 1);
      expect(summary).toHaveProperty('clicksByDate');
      expect(summary).toHaveProperty('clicksByDatePeriod');
      expect(summary).toHaveProperty('referrers');
      expect(summary).toHaveProperty('browsers');
      expect(summary).toHaveProperty('os');
      expect(summary).toHaveProperty('devices');
      expect(summary).toHaveProperty('countries');
    });

    it('should return zero totalClicks for empty bundle', () => {
      const summary = BundleAnalytics.getSummary(bundle.id);
      expect(summary.totalClicks).toBe(0);
      expect(summary.referrers).toEqual([]);
      expect(summary.countries).toEqual([]);
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete records older than given days', () => {
      const db = require('../../../config/database');
      // Insert a record with an old timestamp
      db.prepare(`
        INSERT INTO bundle_analytics (bundleId, timestamp, ipHash)
        VALUES (?, datetime('now', '-100 days'), ?)
      `).run(bundle.id, 'oldhash');

      const deleted = BundleAnalytics.deleteOlderThan(90);
      expect(deleted).toBe(1);
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(0);
    });

    it('should not delete recent records', () => {
      BundleAnalytics.record({ bundleId: bundle.id, ipHash: 'a', referrer: null, userAgent: null, browser: null, os: null, device: null, country: null });
      const deleted = BundleAnalytics.deleteOlderThan(90);
      expect(deleted).toBe(0);
      expect(BundleAnalytics.getTotalClicks(bundle.id)).toBe(1);
    });
  });
});
