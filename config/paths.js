const fs = require('fs');
const path = require('path');

/**
 * Every file LinkSnip writes lives under DATA_DIR (default: the project root),
 * so a Docker volume or a single backup covers all of it.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || '.');

/**
 * Create DATA_DIR if needed and make sure the app can write to it.
 * @throws {Error} With the fix, e.g. for a root-owned Docker bind mount
 */
function ensureDataDir(dir = DATA_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (_) {
    throw new Error([
      `The data directory ${dir} is not writable by this process.`,
      'In Docker the app runs as the "node" user (uid 1000). Give it the folder:',
      '',
      '  sudo chown -R 1000:1000 ./data'
    ].join('\n'));
  }
}

module.exports = {
  PROJECT_ROOT,
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'database.db'),
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
  BACKUPS_DIR: path.join(DATA_DIR, 'backups'),
  SETTINGS_PATH: path.join(DATA_DIR, 'settings.json'),
  ROLES_PATH: path.join(DATA_DIR, 'roles.json'),
  ensureDataDir
};
