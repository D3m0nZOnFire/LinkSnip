const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const File = require('../../../models/File');
const { getTestDatabase } = require('../../setup/testDatabase');
const { createTestUser, createTestFile } = require('../../setup/testHelpers');

const MB = 1024 * 1024;

function setFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
  configService.reload();
}

const uploadsOnDisk = () => (fs.existsSync(paths.UPLOADS_DIR) ? fs.readdirSync(paths.UPLOADS_DIR) : []);
const fileRows = () => getTestDatabase().prepare('SELECT COUNT(*) AS n FROM files').get().n;

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  fs.rmSync(paths.UPLOADS_DIR, { recursive: true, force: true });
  fs.mkdirSync(paths.UPLOADS_DIR, { recursive: true });
  configService.reload();
});

// The x-user header stands in for the session + attachUser.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-user') ? JSON.parse(req.get('x-user')) : null;
    req.user = user;
    req.session = user ? { userId: user.id, isAdmin: !!user.isAdmin } : {};
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.use(require('../../../routes/fileRoutes'));
  app.use((req, res) => res.status(404).json({ notFound: true }));
  return app;
}

let app;
let trusted;
beforeEach(async () => {
  app = makeApp();
  const row = await createTestUser({ username: 'uploader', role: 'trusted' });
  trusted = { id: row.id, username: 'uploader', role: 'trusted', isAdmin: 0 };
});

const upload = (user, bytes, name = 'data.bin') =>
  request(app).post('/api/files/upload').set('x-user', JSON.stringify(user)).attach('file', Buffer.alloc(bytes, 1), name);

describe('upload size cap', () => {
  it("accepts a file within the role's maxFileSizeMB", async () => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { maxFileSizeMB: 1 } } } });
    const res = await upload(trusted, 0.5 * MB);
    expect(res.status).toBe(200);
    expect(fileRows()).toBe(1);
  });

  it('cuts off a file over the role cap while streaming, leaving nothing behind', async () => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { maxFileSizeMB: 1 } } } });

    const res = await upload(trusted, 1.5 * MB);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large.*1 MB/i);
    expect(fileRows()).toBe(0);
    expect(uploadsOnDisk()).toEqual([]);
  });

  it('applies files.globalMaxFileSizeMB on top of the role cap', async () => {
    setFile(paths.SETTINGS_PATH, { files: { globalMaxFileSizeMB: 1 } });
    expect((await upload(trusted, 1.5 * MB)).status).toBe(413);
  });

  it('lets the unlimited role and admins bypass both caps', async () => {
    setFile(paths.SETTINGS_PATH, { files: { globalMaxFileSizeMB: 1 } });
    const unlimitedRow = await createTestUser({ username: 'big', role: 'unlimited' });
    const adminRow = await createTestUser({ username: 'boss', isAdmin: 1 });

    expect((await upload({ id: unlimitedRow.id, role: 'unlimited' }, 1.5 * MB)).status).toBe(200);
    expect((await upload({ id: adminRow.id, isAdmin: 1 }, 1.5 * MB)).status).toBe(200);
  });

  it('refuses uploads when the role allows uploading but its size cap is 0', async () => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { maxFileSizeMB: 0 } } } });
    const res = await upload(trusted, 10);
    expect(res.status).toBe(403);
    expect(fileRows()).toBe(0);
  });
});

describe('storage quota', () => {
  beforeEach(() => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { storageQuotaMB: 2, maxFileSizeMB: 100 } } } });
  });

  it('accepts a file that fits in the remaining quota', async () => {
    createTestFile(trusted.id, { slug: 'old', size: 1 * MB });
    expect((await upload(trusted, 0.5 * MB)).status).toBe(200);
  });

  it('rejects a file that would exceed the quota, leaving nothing behind', async () => {
    createTestFile(trusted.id, { slug: 'old', size: 1.5 * MB });

    const res = await upload(trusted, 1 * MB);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/storage quota/i);
    expect(fileRows()).toBe(1);
    expect(uploadsOnDisk()).toEqual([]);
  });

  it('rejects any upload once the quota is used up', async () => {
    createTestFile(trusted.id, { slug: 'old', size: 2 * MB });

    const res = await upload(trusted, 10);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/storage quota/i);
  });

  it('does not count other users\' files', async () => {
    const other = await createTestUser({ username: 'other' });
    createTestFile(other.id, { slug: 'theirs', size: 50 * MB });
    expect((await upload(trusted, 0.5 * MB)).status).toBe(200);
  });

  it('treats a null quota as unlimited', async () => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { storageQuotaMB: null } } } });
    createTestFile(trusted.id, { slug: 'old', size: 5000 * MB });
    expect((await upload(trusted, 0.5 * MB)).status).toBe(200);
  });
});

describe('upload rate limit', () => {
  it('applies uploadsPerHour from the role', async () => {
    setFile(paths.ROLES_PATH, { roles: { trusted: { limits: { uploadsPerHour: 1 } } } });
    // User IDs restart at 1 in every test, but the limiter's memory store lives for the whole file
    require('../../../middleware/rateLimiter').uploadLimiter.resetKey(`upload_user_${trusted.id}`);
    expect((await upload(trusted, 10)).status).toBe(200);
    expect((await upload(trusted, 10)).status).toBe(429);
  });
});

describe('blocking files', () => {
  let admin;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = JSON.stringify({ id: row.id, isAdmin: 1 });
  });

  function storedFile(overrides = {}) {
    const file = createTestFile(trusted.id, { slug: 'doc', storedName: 'stored.bin', ...overrides });
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'stored.bin'), 'secret bytes');
    return file;
  }

  it('refuses to download a blocked file', async () => {
    storedFile({ isBlocked: 1 });

    const res = await request(app).get('/f/doc/download');

    expect(res.status).toBe(403);
    expect(res.text).not.toContain('secret bytes');
  });

  it('lets admins block and unblock, audit-logged', async () => {
    const file = storedFile();

    expect((await request(app).post(`/api/admin/files/${file.id}/block`).set('x-user', admin)).status).toBe(200);
    expect(File.findById(file.id).isBlocked).toBe(1);
    expect((await request(app).get('/f/doc/download')).status).toBe(403);

    expect((await request(app).post(`/api/admin/files/${file.id}/unblock`).set('x-user', admin)).status).toBe(200);
    expect((await request(app).get('/f/doc/download')).status).toBe(200);

    const actions = getTestDatabase().prepare("SELECT action FROM audit_logs WHERE action LIKE '%BLOCK_FILE'").all().map(r => r.action);
    expect(actions).toEqual(['BLOCK_FILE', 'UNBLOCK_FILE']);
  });

  it('keeps non-admins from blocking', async () => {
    const file = storedFile();
    const res = await request(app).post(`/api/admin/files/${file.id}/block`).set('x-user', JSON.stringify(trusted));
    expect(res.status).toBe(302);
    expect(File.findById(file.id).isBlocked).toBe(0);
  });

  it('404s blocking an unknown file', async () => {
    expect((await request(app).post('/api/admin/files/99999/block').set('x-user', admin)).status).toBe(404);
  });
});

describe('download headers', () => {
  it('serves files as sandboxed, non-sniffable attachments', async () => {
    createTestFile(trusted.id, { slug: 'page', storedName: 'page.html', originalName: 'page.html', mimeType: 'text/html' });
    fs.writeFileSync(path.join(paths.UPLOADS_DIR, 'page.html'), '<script>alert(1)</script>');

    const res = await request(app).get('/f/page/download');

    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  it('sends nosniff on the preview page too', async () => {
    createTestFile(trusted.id, { slug: 'page' });
    const res = await request(app).get('/f/page');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows any file type, .exe and .html included', async () => {
    expect((await upload(trusted, 100, 'setup.exe')).status).toBe(200);
    expect((await upload(trusted, 100, 'index.html')).status).toBe(200);
  });
});
