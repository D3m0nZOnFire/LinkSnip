const db = require('../config/database');

/**
 * Visits of every content type (analytics_events: targetType + targetId). A bundle
 * item click is an event of its bundle with subTargetId = the item's ID; everything
 * about "the item itself" (totals, charts, breakdowns) counts only events without one.
 */

const MAIN = 'targetType = ? AND targetId = ? AND subTargetId IS NULL';

// Columns a breakdown may group by (the name goes into the SQL)
const BREAKDOWNS = ['referrer', 'browser', 'os', 'device', 'country'];

const isoDate = (date) => date.toISOString().split('T')[0];

class AnalyticsEvent {
  /** @returns {{ id: number }} */
  static record({ targetType, targetId, subTargetId = null, ipHash = null, referrer = null, userAgent = null,
    browser = null, os = null, device = null, country = null }) {
    const result = db.prepare(`
      INSERT INTO analytics_events (targetType, targetId, subTargetId, ipHash, referrer, userAgent, browser, os, device, country)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(targetType, targetId, subTargetId, ipHash, referrer, userAgent, browser, os, device, country);
    return { id: Number(result.lastInsertRowid) };
  }

  static getTotal(type, id) {
    return db.prepare(`SELECT COUNT(*) AS n FROM analytics_events WHERE ${MAIN}`).get(type, id).n;
  }

  static getUniqueVisitors(type, id) {
    return db.prepare(`SELECT COUNT(DISTINCT ipHash) AS n FROM analytics_events WHERE ${MAIN}`).get(type, id).n;
  }

  /**
   * Events grouped by one column, most first.
   * @returns {Array<object>} e.g. [{ referrer: 'Direct', count: 3 }]
   */
  static getBreakdown(type, id, column, limit = null) {
    if (!BREAKDOWNS.includes(column)) throw new Error(`Unknown analytics breakdown: ${column}`);
    return db.prepare(`
      SELECT ${column}, COUNT(*) AS count FROM analytics_events WHERE ${MAIN}
      GROUP BY ${column} ORDER BY count DESC ${limit ? 'LIMIT ?' : ''}
    `).all(type, id, ...(limit ? [limit] : []));
  }

  /**
   * Events per day, every day of the range included (0 when none). Without `days` the
   * range fits the data: the last 30 days, the last 90, or everything since the first event.
   * @returns {{ data: Array<{ date, count }>, period: string }}
   */
  static getByDate(type, id, days = null) {
    const rows = db.prepare(`
      SELECT DATE(timestamp) AS date, COUNT(*) AS count FROM analytics_events WHERE ${MAIN}
      GROUP BY DATE(timestamp) ORDER BY date ASC
    `).all(type, id);
    const counts = new Map(rows.map(r => [r.date, r.count]));

    const now = new Date();
    const daysBack = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d; };
    let start;
    let period;
    if (days !== null) {
      start = daysBack(days - 1);
      period = `Last ${days} Days`;
    } else {
      const first = rows.length ? new Date(rows[0].date) : now;
      const age = Math.ceil((now - first) / 86400000);
      if (age <= 30) { start = daysBack(29); period = 'Last 30 Days'; }
      else if (age <= 90) { start = daysBack(89); period = 'Last 90 Days'; }
      else { start = first; period = 'All Time'; }
    }

    const data = [];
    for (const d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      data.push({ date: isoDate(d), count: counts.get(isoDate(d)) || 0 });
    }
    return { data, period };
  }

  /** Everything an analytics page shows about one item, with the same fields for every type. */
  static getSummary(type, id) {
    const byDate = this.getByDate(type, id);
    return {
      total: this.getTotal(type, id),
      uniqueVisitors: this.getUniqueVisitors(type, id),
      byDate: byDate.data,
      byDatePeriod: byDate.period,
      referrers: this.getBreakdown(type, id, 'referrer', 10),
      browsers: this.getBreakdown(type, id, 'browser'),
      os: this.getBreakdown(type, id, 'os'),
      devices: this.getBreakdown(type, id, 'device'),
      countries: this.getBreakdown(type, id, 'country', 10)
    };
  }

  /** A bundle's items in position order, each with its number of clicks. */
  static getItemClicks(bundleId) {
    return db.prepare(`
      SELECT i.id, i.url, i.label, i.position,
             (SELECT COUNT(*) FROM analytics_events e
              WHERE e.targetType = 'bundle' AND e.targetId = i.bundleId AND e.subTargetId = i.id) AS clickCount
      FROM bundle_items i
      WHERE i.bundleId = ?
      ORDER BY i.position ASC, i.id ASC
    `).all(bundleId);
  }

  /**
   * Links ranked by clicks (Admin → Analytics), optionally only the last `days` days.
   * @returns {Array<{ urlId, slug, longUrl, clicks }>}
   */
  static getTopUrls(limit = 10, days = null) {
    return db.prepare(`
      SELECT u.id AS urlId, u.slug, u.longUrl, COUNT(e.id) AS clicks
      FROM urls u
      LEFT JOIN analytics_events e ON e.targetType = 'url' AND e.targetId = u.id AND e.subTargetId IS NULL
        ${days ? "AND e.timestamp >= datetime('now', '-' || ? || ' days')" : ''}
      GROUP BY u.id
      ORDER BY clicks DESC
      LIMIT ?
    `).all(...(days ? [days] : []), limit);
  }

  /** Events per day summed over several items of one type, the last `days` days (days without events left out). */
  static getDailyCounts(type, ids, days = 30) {
    if (!ids.length) return [];
    return db.prepare(`
      SELECT DATE(timestamp) AS date, COUNT(*) AS count FROM analytics_events
      WHERE targetType = ? AND subTargetId IS NULL AND targetId IN (${ids.map(() => '?').join(',')})
        AND timestamp >= datetime('now', '-' || ? || ' days')
      GROUP BY DATE(timestamp) ORDER BY date ASC
    `).all(type, ...ids, days);
  }

  static countAll(type) {
    return db.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE targetType = ? AND subTargetId IS NULL').get(type).n;
  }
}

module.exports = AnalyticsEvent;
