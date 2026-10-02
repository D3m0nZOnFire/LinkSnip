#!/usr/bin/env node
/**
 * Demo instance for trying LinkSnip out:
 *
 *   npm run seed:demo                  fills ./demo-data
 *   npm run seed:demo -- <folder>      another folder
 *   npm run seed:demo -- --reset       start over in a folder that already has a database
 *
 * Then: DATA_DIR=./demo-data npm run dev. The folder is always the argument, never DATA_DIR from .env, and never
 * the project folder (a development database lives there). What gets created: scripts/demoData.js.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ quiet: true }); // IP_HASH_SECRET as the app uses it

const PROJECT_ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const reset = args.includes('--reset');
const folder = path.resolve(args.find(a => !a.startsWith('--')) || 'demo-data');

function fail(message) {
  console.error(`seed:demo: ${message}`);
  process.exit(1);
}

if (folder === PROJECT_ROOT) {
  fail(`${folder} is the project folder (your development database lives there). Pick another folder, e.g. ./demo-data`);
}
if (fs.existsSync(path.join(folder, 'database.db'))) {
  if (!reset) fail(`${folder} already has a database. Run again with --reset to replace it with fresh demo data.`);
  for (const name of ['database.db', 'database.db-wal', 'database.db-shm', 'settings.json', 'roles.json', 'uploads', 'backups', 'branding', 'palettes']) {
    fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

process.env.DATA_DIR = folder;
process.env.NODE_ENV = 'production'; // no SQL query log (thousands of inserts)
if (!process.env.IP_HASH_SECRET || process.env.IP_HASH_SECRET.length < 32) {
  process.env.IP_HASH_SECRET = 'demo-only-ip-hash-secret-'.padEnd(64, '0');
  console.log('No IP_HASH_SECRET found: using a demo one (start the app with the same .env as this run).');
}

async function main() {
  require('../config/paths').ensureDataDir(folder);
  const paths = require('../config/paths');
  const db = require('../config/database');
  const bcrypt = require('bcrypt');
  const { seedDemo, DEMO_PASSWORD } = require('./demoData');

  const summary = await seedDemo({ passwordHash: bcrypt.hashSync(DEMO_PASSWORD, 10) });

  // Last night's backup (the most recent 3:00 UTC, when the app makes one), so Admin → Overview has one
  const lastNight = new Date();
  lastNight.setUTCHours(3, 0, 0, 0);
  if (lastNight > new Date()) lastNight.setUTCDate(lastNight.getUTCDate() - 1);
  fs.mkdirSync(paths.BACKUPS_DIR, { recursive: true });
  const backup = path.join(paths.BACKUPS_DIR, `database-backup-${lastNight.toISOString().replace(/[:.]/g, '-')}.sqlite`);
  await db.backup(backup);
  fs.utimesSync(backup, lastNight, lastNight);
  db.close();

  const relative = path.relative(process.cwd(), folder) || '.';
  const shown = relative.startsWith('..') ? folder : `./${relative}`;
  console.log(`
Demo data is in ${folder}
  ${summary.counts.urls} links, ${summary.counts.bundles} bundles, ${summary.counts.pastes} pastes, ${summary.counts.files} files, ${summary.counts.visits} visits

Start it:
  DATA_DIR=${shown} npm run dev        (with mise: DATA_DIR=${shown} mise exec node@22 -- npm run dev)

Accounts (password for all, and for password-protected items: ${DEMO_PASSWORD}):
${summary.accounts.map(a => `  ${a.username.padEnd(7)} ${a.note}`).join('\n')}

A read-only analytics share link: http://localhost:8081${summary.shareLink}
`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
