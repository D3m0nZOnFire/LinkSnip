const PasteAnalytics = require('../../../models/PasteAnalytics');
const { createTestPaste } = require('../../setup/testHelpers');

describe('PasteAnalytics Model', () => {
  let paste;

  beforeEach(() => {
    paste = createTestPaste(null, { slug: `p${Date.now()}${Math.floor(Math.random() * 1000)}` });
  });

  const row = (over = {}) => ({
    pasteId: paste.id, ipHash: null, referrer: null, userAgent: null,
    browser: null, os: null, device: null, country: null, ...over
  });

  describe('record', () => {
    it('should insert a row', () => {
      expect(() => PasteAnalytics.record(row({ ipHash: 'abc', referrer: 'https://x.com', browser: 'Chrome', os: 'Windows', device: 'Desktop', country: 'CH' }))).not.toThrow();
    });

    it('should accept null optional fields', () => {
      expect(() => PasteAnalytics.record(row())).not.toThrow();
    });

    it('should increment total views on each record', () => {
      expect(PasteAnalytics.getTotalViews(paste.id)).toBe(0);
      PasteAnalytics.record(row({ ipHash: 'h1' }));
      PasteAnalytics.record(row({ ipHash: 'h2' }));
      expect(PasteAnalytics.getTotalViews(paste.id)).toBe(2);
    });
  });

  describe('getUniqueVisitors', () => {
    it('should count distinct ipHash values', () => {
      PasteAnalytics.record(row({ ipHash: 'h1' }));
      PasteAnalytics.record(row({ ipHash: 'h1' }));
      PasteAnalytics.record(row({ ipHash: 'h2' }));
      expect(PasteAnalytics.getTotalViews(paste.id)).toBe(3);
      expect(PasteAnalytics.getUniqueVisitors(paste.id)).toBe(2);
    });
  });

  describe('getReferrerStats', () => {
    it('should aggregate by count descending and respect the limit', () => {
      PasteAnalytics.record(row({ ipHash: 'a', referrer: 'https://google.com' }));
      PasteAnalytics.record(row({ ipHash: 'b', referrer: 'https://google.com' }));
      PasteAnalytics.record(row({ ipHash: 'c', referrer: 'https://twitter.com' }));

      const stats = PasteAnalytics.getReferrerStats(paste.id);
      expect(stats[0]).toMatchObject({ referrer: 'https://google.com', count: 2 });
      expect(PasteAnalytics.getReferrerStats(paste.id, 1)).toHaveLength(1);
    });
  });

  describe('scoping', () => {
    it('should not count rows from another paste', () => {
      const other = createTestPaste(null, { slug: `other${Date.now()}` });
      PasteAnalytics.record(row({ pasteId: other.id, ipHash: 'x' }));
      expect(PasteAnalytics.getTotalViews(paste.id)).toBe(0);
    });
  });

  describe('getViewsByDate', () => {
    it('should return 30 days of zeros when no data', () => {
      const result = PasteAnalytics.getViewsByDate(paste.id);
      expect(result.data).toHaveLength(30);
      expect(result.period).toBe('Last 30 Days');
      expect(result.data.every(d => d.count === 0)).toBe(true);
    });

    it('should include a recorded view on today', () => {
      PasteAnalytics.record(row({ ipHash: 'a' }));
      const today = new Date().toISOString().split('T')[0];
      const result = PasteAnalytics.getViewsByDate(paste.id);
      expect(result.data.find(d => d.date === today).count).toBe(1);
    });
  });

  describe('getSummary', () => {
    it('should return all summary fields', () => {
      PasteAnalytics.record(row({ ipHash: 'a', referrer: 'https://google.com', userAgent: 'ua', browser: 'Chrome', os: 'Windows', device: 'Desktop', country: 'CH' }));
      const summary = PasteAnalytics.getSummary(paste.id);
      expect(summary).toMatchObject({ totalViews: 1, uniqueVisitors: 1 });
      ['viewsByDate', 'viewsByDatePeriod', 'referrers', 'browsers', 'os', 'devices', 'countries'].forEach(k => {
        expect(summary).toHaveProperty(k);
      });
    });

    it('should be empty for an untouched paste', () => {
      const summary = PasteAnalytics.getSummary(paste.id);
      expect(summary.totalViews).toBe(0);
      expect(summary.referrers).toEqual([]);
      expect(summary.countries).toEqual([]);
    });
  });

  describe('deleteOlderThan', () => {
    it('should delete old rows but keep recent ones', () => {
      const db = require('../../../config/database');
      db.prepare(`INSERT INTO paste_analytics (pasteId, timestamp, ipHash) VALUES (?, datetime('now', '-100 days'), ?)`).run(paste.id, 'old');
      PasteAnalytics.record(row({ ipHash: 'fresh' }));

      expect(PasteAnalytics.deleteOlderThan(90)).toBe(1);
      expect(PasteAnalytics.getTotalViews(paste.id)).toBe(1);
    });
  });
});
