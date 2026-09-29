const db = require('../config/database');

class BundleItemAnalytics {
  static record(bundleItemId, bundleId, ipHash) {
    db.prepare(`
      INSERT INTO bundle_item_analytics (bundleItemId, bundleId, ipHash)
      VALUES (?, ?, ?)
    `).run(bundleItemId, bundleId, ipHash || null);
  }

  static getClicksPerItem(bundleId) {
    return db.prepare(`
      SELECT
        bi.id as itemId,
        bi.label as itemLabel,
        bi.url as itemUrl,
        bi.position,
        COUNT(bia.id) as clickCount
      FROM bundle_items bi
      LEFT JOIN bundle_item_analytics bia ON bi.id = bia.bundleItemId
      WHERE bi.bundleId = ?
      GROUP BY bi.id
      ORDER BY bi.position ASC
    `).all(bundleId);
  }

  static getTotalClicksForItem(bundleItemId) {
    const result = db.prepare('SELECT COUNT(*) as count FROM bundle_item_analytics WHERE bundleItemId = ?').get(bundleItemId);
    return result ? result.count : 0;
  }
}

module.exports = BundleItemAnalytics;
