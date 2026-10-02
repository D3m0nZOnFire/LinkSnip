const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const { UPLOADS_DIR } = require('../config/paths');
const { CONTENT_TYPES } = require('./contentTypes');
const { scopeCondition } = require('./itemScope');

/**
 * Deletes an account and everything personal in it: links, bundles, pastes and files (their uploads too). The
 * database takes the rest along: tags and the bio page (ON DELETE CASCADE), the deleted items' analytics, share
 * links, reports and tag assignments (delete triggers). Items in teams stay with the team; their creator becomes
 * NULL (ON DELETE SET NULL). Used by "Delete account" in Settings and by Admin → Users → Delete.
 * @returns {{ items: { url: number, bundle: number, paste: number, file: number } }} What was deleted, per type
 */
function deleteAccount(userId) {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

  const items = {};
  let uploads = [];
  db.transaction(() => {
    for (const [type, { table }] of Object.entries(CONTENT_TYPES)) {
      const personal = scopeCondition(type, userId);
      if (type === 'file') {
        uploads = db.prepare(`SELECT storedName FROM ${table} WHERE ${personal.sql}`).all(...personal.params).map(r => r.storedName);
      }
      items[type] = db.prepare(`DELETE FROM ${table} WHERE ${personal.sql}`).run(...personal.params).changes;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  })();

  // Only after the rows are gone: a failed transaction keeps the uploads
  for (const storedName of uploads) {
    try {
      fs.rmSync(path.join(UPLOADS_DIR, path.basename(storedName)), { force: true });
    } catch (_) { /* a missing upload is fine */ }
  }
  return { items };
}

module.exports = { deleteAccount };
