const db = require('../config/database');

class Analytics {
  /**
   * Record a click event
   * @param {object} data - Analytics data
   * @returns {object} Created analytics record
   */
  static record({ urlId, ipHash, referrer, userAgent, browser, os, device, country }) {
    const stmt = db.prepare(`
      INSERT INTO analytics (urlId, ipHash, referrer, userAgent, browser, os, device, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(urlId, ipHash, referrer, userAgent, browser, os, device, country);
    return this.findById(result.lastInsertRowid);
  }

  /**
   * Find analytics record by ID
   * @param {number} id
   * @returns {object|null}
   */
  static findById(id) {
    const stmt = db.prepare('SELECT * FROM analytics WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * Get all analytics for a specific URL
   * @param {number} urlId
   * @param {object} options - { limit, offset, startDate, endDate }
   * @returns {array}
   */
  static findByUrlId(urlId, options = {}) {
    const { limit = 100, offset = 0, startDate, endDate } = options;

    let query = 'SELECT * FROM analytics WHERE urlId = ?';
    const params = [urlId];

    if (startDate) {
      query += ' AND timestamp >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND timestamp <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get click count by date for a URL
   * Auto-detects the appropriate time range based on when clicks occurred
   * @param {number} urlId
   * @param {number} days - Number of days to look back (null = auto-detect based on data)
   * @returns {object} { data: Array of { date, count }, period: string description }
   */
  static getClicksByDate(urlId, days = null) {
    // First, get all analytics data for this URL to determine date range
    const allDataStmt = db.prepare(`
      SELECT
        DATE(timestamp) as date,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `);
    const allData = allDataStmt.all(urlId);

    // If no data at all, return empty last 30 days
    if (allData.length === 0) {
      const result = [];
      const now = new Date();
      for (let i = 29; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        result.push({ date: dateStr, count: 0 });
      }
      return { data: result, period: 'Last 30 Days' };
    }

    // Create a map of existing data for quick lookup
    const dataMap = new Map(allData.map(d => [d.date, d.count]));

    // Determine the date range
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const firstClickDate = new Date(allData[0].date);
    const lastClickDate = new Date(allData[allData.length - 1].date);

    // Calculate days since first click
    const daysSinceFirstClick = Math.ceil((now - firstClickDate) / (1000 * 60 * 60 * 24));

    // Determine appropriate range and period label
    let startDate;
    let period;

    if (days !== null) {
      // Explicit days parameter - use it
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - days + 1);
      period = `Last ${days} Days`;
    } else if (daysSinceFirstClick <= 30) {
      // Data is within last 30 days - show last 30 days
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 29);
      period = 'Last 30 Days';
    } else if (daysSinceFirstClick <= 90) {
      // Data is within last 90 days - show last 90 days
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 89);
      period = 'Last 90 Days';
    } else {
      // Data is older - show all time from first click
      startDate = firstClickDate;
      period = 'All Time';
    }

    // Generate all dates in range and fill zeros for missing days
    const result = [];
    const currentDate = new Date(startDate);

    while (currentDate <= now) {
      const dateStr = currentDate.toISOString().split('T')[0];
      result.push({
        date: dateStr,
        count: dataMap.get(dateStr) || 0
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { data: result, period };
  }

  /**
   * Get referrer breakdown for a URL
   * @param {number} urlId
   * @param {number} limit
   * @returns {array} Array of { referrer, count }
   */
  static getReferrerStats(urlId, limit = 10) {
    const stmt = db.prepare(`
      SELECT
        referrer,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT ?
    `);

    return stmt.all(urlId, limit);
  }

  /**
   * Get browser breakdown for a URL
   * @param {number} urlId
   * @returns {array} Array of { browser, count }
   */
  static getBrowserStats(urlId) {
    const stmt = db.prepare(`
      SELECT
        browser,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY browser
      ORDER BY count DESC
    `);

    return stmt.all(urlId);
  }

  /**
   * Get OS breakdown for a URL
   * @param {number} urlId
   * @returns {array} Array of { os, count }
   */
  static getOsStats(urlId) {
    const stmt = db.prepare(`
      SELECT
        os,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY os
      ORDER BY count DESC
    `);

    return stmt.all(urlId);
  }

  /**
   * Get device breakdown for a URL
   * @param {number} urlId
   * @returns {array} Array of { device, count }
   */
  static getDeviceStats(urlId) {
    const stmt = db.prepare(`
      SELECT
        device,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY device
      ORDER BY count DESC
    `);

    return stmt.all(urlId);
  }

  /**
   * Get country breakdown for a URL
   * @param {number} urlId
   * @param {number} limit
   * @returns {array} Array of { country, count }
   */
  static getCountryStats(urlId, limit = 10) {
    const stmt = db.prepare(`
      SELECT
        country,
        COUNT(*) as count
      FROM analytics
      WHERE urlId = ?
      GROUP BY country
      ORDER BY count DESC
      LIMIT ?
    `);

    return stmt.all(urlId, limit);
  }

  /**
   * Get total clicks for a URL
   * @param {number} urlId
   * @returns {number}
   */
  static getTotalClicks(urlId) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM analytics WHERE urlId = ?');
    const result = stmt.get(urlId);
    return result ? result.count : 0;
  }

  /**
   * Get analytics summary for a URL
   * @param {number} urlId
   * @returns {object} Complete analytics summary
   */
  static getSummary(urlId) {
    const clicksByDateResult = this.getClicksByDate(urlId);
    return {
      totalClicks: this.getTotalClicks(urlId),
      clicksByDate: clicksByDateResult.data,
      clicksByDatePeriod: clicksByDateResult.period,
      referrers: this.getReferrerStats(urlId, 10),
      browsers: this.getBrowserStats(urlId),
      os: this.getOsStats(urlId),
      devices: this.getDeviceStats(urlId),
      countries: this.getCountryStats(urlId, 10)
    };
  }

  /**
   * Get top URLs by clicks (for admin)
   * @param {number} limit
   * @param {number} days - Number of days to look back (null = all time)
   * @returns {array} Array of { urlId, slug, longUrl, clicks }
   */
  static getTopUrls(limit = 10, days = null) {
    let query = `
      SELECT
        u.id as urlId,
        u.slug,
        u.longUrl,
        COUNT(a.id) as clicks
      FROM urls u
      LEFT JOIN analytics a ON u.id = a.urlId
    `;

    const params = [];

    if (days) {
      query += ` WHERE a.timestamp >= datetime('now', '-' || ? || ' days')`;
      params.push(days);
    }

    query += `
      GROUP BY u.id
      ORDER BY clicks DESC
      LIMIT ?
    `;
    params.push(limit);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Delete analytics older than specified days
   * @param {number} days
   * @returns {number} Number of deleted records
   */
  static deleteOlderThan(days) {
    const stmt = db.prepare(`
      DELETE FROM analytics
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `);
    const result = stmt.run(days);
    return result.changes;
  }
}

module.exports = Analytics;
