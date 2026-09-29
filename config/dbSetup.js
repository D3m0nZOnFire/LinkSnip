/**
 * Connection settings applied to the SQLite database on startup.
 * - WAL: readers don't block the writer, and db.backup() can copy it while live.
 * - busy_timeout: wait up to 5s for a lock instead of failing (e.g. `npm run admin`
 *   writing while the app runs).
 */
function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

module.exports = { configureDatabase };
