const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * config/database.js on a brand-new DATA_DIR, in its own process (the rest of the suite uses an in-memory copy).
 * A fresh install has to come out the same as one that has been upgraded over the years.
 */
const ROOT = path.join(__dirname, '../../..');

// Runs `query` (SQL) on a brand-new database and returns its rows
function queryFreshDatabase(query) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-fresh-'));
  try {
    const r = spawnSync(process.execPath, ['-e', `
      const db = require(${JSON.stringify(path.join(ROOT, 'config/database'))});
      process.stdout.write('\\n@@' + JSON.stringify(db.prepare(${JSON.stringify(query)}).all()));
    `], {
      encoding: 'utf8',
      timeout: 30000,
      env: { PATH: process.env.PATH, DATA_DIR: dir, NODE_ENV: 'production', IP_HASH_SECRET: process.env.IP_HASH_SECRET }
    });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout.split('@@').pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const columnsOfFreshDatabase = (table) => queryFreshDatabase(`PRAGMA table_info(${table})`).map(c => c.name);

describe('a fresh database', () => {
  // Was added only on the second start: a new instance couldn't create a bio page until it restarted
  it('has the bio page gradient columns from the first start', () => {
    expect(columnsOfFreshDatabase('bio_pages')).toEqual(expect.arrayContaining(['gradientStart', 'gradientEnd']));
  });

  it('has the bio link label column', () => {
    expect(columnsOfFreshDatabase('bio_page_urls')).toEqual(expect.arrayContaining(['label']));
  });

  it('has the case-insensitive slug index on every content table', () => {
    const indexes = queryFreshDatabase("SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_slug_nocase'")
      .map(r => r.tbl_name);
    expect(indexes.sort()).toEqual(['bundles', 'files', 'pastes', 'urls']);
  });
});
