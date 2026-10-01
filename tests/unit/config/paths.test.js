const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function loadPathsWith(dataDir) {
  const original = process.env.DATA_DIR;
  if (dataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = dataDir;

  let paths;
  jest.isolateModules(() => {
    paths = require('../../../config/paths');
  });

  process.env.DATA_DIR = original;
  return paths;
}

describe('config/paths', () => {
  it('defaults DATA_DIR to the project root', () => {
    const paths = loadPathsWith(undefined);
    expect(paths.DATA_DIR).toBe(PROJECT_ROOT);
  });

  it('uses the DATA_DIR env var when set', () => {
    const paths = loadPathsWith('/srv/linksnip-data');
    expect(paths.DATA_DIR).toBe('/srv/linksnip-data');
  });

  it('resolves a relative DATA_DIR against the project root', () => {
    const paths = loadPathsWith('data');
    expect(paths.DATA_DIR).toBe(path.join(PROJECT_ROOT, 'data'));
  });

  it('puts every data file under DATA_DIR', () => {
    const paths = loadPathsWith('/data');
    expect(paths.DB_PATH).toBe('/data/database.db');
    expect(paths.UPLOADS_DIR).toBe('/data/uploads');
    expect(paths.BACKUPS_DIR).toBe('/data/backups');
    expect(paths.SETTINGS_PATH).toBe('/data/settings.json');
    expect(paths.ROLES_PATH).toBe('/data/roles.json');
    expect(paths.BRANDING_DIR).toBe('/data/branding');
  });
});

describe('ensureDataDir', () => {
  const fs = require('fs');
  const os = require('os');
  const { ensureDataDir } = require('../../../config/paths');
  let base;

  beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-datadir-')); });
  afterEach(() => {
    fs.chmodSync(base, 0o700);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('creates a missing data directory', () => {
    const dir = path.join(base, 'data');
    ensureDataDir(dir);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });

  it('explains how to fix a data directory the app cannot write to', () => {
    const dir = path.join(base, 'data');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o500);

    expect(() => ensureDataDir(dir)).toThrow(/not writable/);
    expect(() => ensureDataDir(dir)).toThrow(/chown -R 1000:1000/);
  });
});
