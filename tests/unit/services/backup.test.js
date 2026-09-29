const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const paths = require('../../../config/paths');
const ScheduledTasks = require('../../../services/scheduledTasks');
const { createTestUser } = require('../../setup/testHelpers');

const backups = () => (fs.existsSync(paths.BACKUPS_DIR) ? fs.readdirSync(paths.BACKUPS_DIR) : []);

afterEach(() => fs.rmSync(paths.BACKUPS_DIR, { recursive: true, force: true }));

describe('database backups', () => {
  it('writes a consistent online copy of the live database with db.backup()', async () => {
    await createTestUser({ username: 'kept' });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const backupPath = await ScheduledTasks.backupDatabase();

    expect(path.dirname(backupPath)).toBe(paths.BACKUPS_DIR);
    expect(path.basename(backupPath)).toMatch(/^database-backup-.*\.sqlite$/);
    const copy = new Database(backupPath, { readonly: true });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(copy.prepare('SELECT username FROM users').all()).toEqual([{ username: 'kept' }]);
    copy.close();
  });

  it('manualBackup waits for the backup to finish', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await ScheduledTasks.manualBackup();
    expect(backups()).toHaveLength(1);
  });

  it('rejects when the backup fails, so the admin sees the error', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = require('../../../config/database');
    jest.spyOn(db, 'backup').mockRejectedValueOnce(new Error('disk full'));

    await expect(ScheduledTasks.manualBackup()).rejects.toThrow('disk full');
  });

  it('removes backups older than the retention period only', () => {
    fs.mkdirSync(paths.BACKUPS_DIR, { recursive: true });
    const old = path.join(paths.BACKUPS_DIR, 'database-backup-old.sqlite');
    const fresh = path.join(paths.BACKUPS_DIR, 'database-backup-new.sqlite');
    const other = path.join(paths.BACKUPS_DIR, 'notes.txt');
    for (const f of [old, fresh, other]) fs.writeFileSync(f, 'x');
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old, longAgo, longAgo);
    fs.utimesSync(other, longAgo, longAgo);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    ScheduledTasks.cleanupOldBackups(paths.BACKUPS_DIR, 30);

    expect(backups().sort()).toEqual(['database-backup-new.sqlite', 'notes.txt']);
  });
});
