const db = require('../config/database');

class BundleAnalytics {
  static record({ bundleId, ipHash, referrer, userAgent, browser, os, device, country }) {
    const stmt = db.prepare(`
      INSERT INTO bundle_analytics (bundleId, ipHash, referrer, userAgent, browser, os, device, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(bundleId, ipHash, referrer, userAgent, browser, os, device, country);
  }

  static getClicksByDate(bundleId, days = null) {
    const allDataStmt = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM bundle_analytics
      WHERE bundleId = ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `);
    const allData = allDataStmt.all(bundleId);

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
    const firstClickDate = new Date(allData[0].date);
    const daysSinceFirstClick = Math.ceil((now - firstClickDate) / (1000 * 60 * 60 * 24));

    let startDate, period;
    if (days !== null) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - days + 1);
      period = `Last ${days} Days`;
    } else if (daysSinceFirstClick <= 30) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      period = 'Last 30 Days';
    } else if (daysSinceFirstClick <= 90) {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 89);
      period = 'Last 90 Days';
    } else {
      startDate = firstClickDate;
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

  static getReferrerStats(bundleId, limit = 10) {
    return db.prepare(`
      SELECT referrer, COUNT(*) as count
      FROM bundle_analytics WHERE bundleId = ?
      GROUP BY referrer ORDER BY count DESC LIMIT ?
    `).all(bundleId, limit);
  }

  static getBrowserStats(bundleId) {
    return db.prepare(`
      SELECT browser, COUNT(*) as count
      FROM bundle_analytics WHERE bundleId = ?
      GROUP BY browser ORDER BY count DESC
    `).all(bundleId);
  }

  static getOsStats(bundleId) {
    return db.prepare(`
      SELECT os, COUNT(*) as count
      FROM bundle_analytics WHERE bundleId = ?
      GROUP BY os ORDER BY count DESC
    `).all(bundleId);
  }

  static getDeviceStats(bundleId) {
    return db.prepare(`
      SELECT device, COUNT(*) as count
      FROM bundle_analytics WHERE bundleId = ?
      GROUP BY device ORDER BY count DESC
    `).all(bundleId);
  }

  static getCountryStats(bundleId, limit = 10) {
    return db.prepare(`
      SELECT country, COUNT(*) as count
      FROM bundle_analytics WHERE bundleId = ?
      GROUP BY country ORDER BY count DESC LIMIT ?
    `).all(bundleId, limit);
  }

  static getTotalClicks(bundleId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM bundle_analytics WHERE bundleId = ?').get(bundleId);
    return result ? result.count : 0;
  }

  static getSummary(bundleId) {
    const clicksByDateResult = this.getClicksByDate(bundleId);
    return {
      totalClicks: this.getTotalClicks(bundleId),
      clicksByDate: clicksByDateResult.data,
      clicksByDatePeriod: clicksByDateResult.period,
      referrers: this.getReferrerStats(bundleId, 10),
      browsers: this.getBrowserStats(bundleId),
      os: this.getOsStats(bundleId),
      devices: this.getDeviceStats(bundleId),
      countries: this.getCountryStats(bundleId, 10)
    };
  }

  static deleteOlderThan(days) {
    const result = db.prepare(`
      DELETE FROM bundle_analytics
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `).run(days);
    return result.changes;
  }
}

module.exports = BundleAnalytics;
