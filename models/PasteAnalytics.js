const db = require('../config/database');

/**
 * PasteAnalytics — per-view tracking for pastes.
 * Mirrors BundleAnalytics: one row per view of /p/:slug.
 */
class PasteAnalytics {
  static record({ pasteId, ipHash, referrer, userAgent, browser, os, device, country }) {
    const stmt = db.prepare(`
      INSERT INTO paste_analytics (pasteId, ipHash, referrer, userAgent, browser, os, device, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(pasteId, ipHash, referrer, userAgent, browser, os, device, country);
  }

  static getViewsByDate(pasteId, days = null) {
    const allData = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM paste_analytics
      WHERE pasteId = ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all(pasteId);

    if (allData.length === 0) {
      const result = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        result.push({ date: date.toISOString().split('T')[0], count: 0 });
      }
      return { data: result, period: 'Last 30 Days' };
    }

    const dataMap = new Map(allData.map(d => [d.date, d.count]));
    const now = new Date();
    const firstDate = new Date(allData[0].date);
    const daysSinceFirst = Math.ceil((now - firstDate) / (1000 * 60 * 60 * 24));

    let startDate, period;
    if (days !== null) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - days + 1);
      period = `Last ${days} Days`;
    } else if (daysSinceFirst <= 30) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      period = 'Last 30 Days';
    } else if (daysSinceFirst <= 90) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 89);
      period = 'Last 90 Days';
    } else {
      startDate = firstDate;
      period = 'All Time';
    }

    const result = [];
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
      const dateStr = currentDate.toISOString().split('T')[0];
      result.push({ date: dateStr, count: dataMap.get(dateStr) || 0 });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { data: result, period };
  }

  static getReferrerStats(pasteId, limit = 10) {
    return db.prepare(`
      SELECT referrer, COUNT(*) as count
      FROM paste_analytics WHERE pasteId = ?
      GROUP BY referrer ORDER BY count DESC LIMIT ?
    `).all(pasteId, limit);
  }

  static getBrowserStats(pasteId) {
    return db.prepare(`
      SELECT browser, COUNT(*) as count
      FROM paste_analytics WHERE pasteId = ?
      GROUP BY browser ORDER BY count DESC
    `).all(pasteId);
  }

  static getOsStats(pasteId) {
    return db.prepare(`
      SELECT os, COUNT(*) as count
      FROM paste_analytics WHERE pasteId = ?
      GROUP BY os ORDER BY count DESC
    `).all(pasteId);
  }

  static getDeviceStats(pasteId) {
    return db.prepare(`
      SELECT device, COUNT(*) as count
      FROM paste_analytics WHERE pasteId = ?
      GROUP BY device ORDER BY count DESC
    `).all(pasteId);
  }

  static getCountryStats(pasteId, limit = 10) {
    return db.prepare(`
      SELECT country, COUNT(*) as count
      FROM paste_analytics WHERE pasteId = ?
      GROUP BY country ORDER BY count DESC LIMIT ?
    `).all(pasteId, limit);
  }

  static getUniqueVisitors(pasteId) {
    const result = db.prepare(
      'SELECT COUNT(DISTINCT ipHash) as count FROM paste_analytics WHERE pasteId = ?'
    ).get(pasteId);
    return result ? result.count : 0;
  }

  static getTotalViews(pasteId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM paste_analytics WHERE pasteId = ?').get(pasteId);
    return result ? result.count : 0;
  }

  static getSummary(pasteId) {
    const viewsByDateResult = this.getViewsByDate(pasteId);
    return {
      totalViews: this.getTotalViews(pasteId),
      uniqueVisitors: this.getUniqueVisitors(pasteId),
      viewsByDate: viewsByDateResult.data,
      viewsByDatePeriod: viewsByDateResult.period,
      referrers: this.getReferrerStats(pasteId, 10),
      browsers: this.getBrowserStats(pasteId),
      os: this.getOsStats(pasteId),
      devices: this.getDeviceStats(pasteId),
      countries: this.getCountryStats(pasteId, 10)
    };
  }

  static deleteOlderThan(days) {
    const result = db.prepare(`
      DELETE FROM paste_analytics
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `).run(days);
    return result.changes;
  }
}

module.exports = PasteAnalytics;
