const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const ImportExportController = require('../../../controllers/importExportController');
const Url = require('../../../models/Url');
const { createTestUser, createTestUrl, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// Bulk import uses the same slug rules as the create form: a chosen slug needs customSlugs and is unique
// among links, ignoring case.

let user;
beforeEach(async () => {
  const u = await createTestUser({ username: 'importer', role: 'trusted' });
  user = { id: u.id, username: 'importer', isAdmin: 0, role: 'trusted' };
});

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

async function importCsv(csv) {
  const res = createMockResponse();
  await ImportExportController.importUrls(createMockRequest({
    user,
    file: { buffer: Buffer.from(csv), originalname: 'links.csv' },
    protocol: 'http',
    get: () => 'localhost'
  }), res);
  return res;
}

it('creates links with their slugs', async () => {
  const res = await importCsv('longUrl,slug\nhttps://a.example,first\nhttps://b.example,\n');
  expect(res._jsonData.results.success).toBe(2);
  expect(Url.findBySlug('first').longUrl).toBe('https://a.example');
});

it('a slug taken in any case fails that line only', async () => {
  createTestUrl({ slug: 'Taken' });
  const res = await importCsv('longUrl,slug\nhttps://a.example,taken\nhttps://b.example,free\n');
  expect(res._jsonData.results).toEqual(expect.objectContaining({ success: 1, failed: 1 }));
  expect(res._jsonData.results.errors[0].error).toMatch(/already taken/);
});

it('without customSlugs a file with slugs is refused (403); one without slugs imports', async () => {
  fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { trusted: { permissions: { customSlugs: false } } } }));
  configService.reload();

  const refused = await importCsv('longUrl,slug\nhttps://a.example,first\n');
  expect(refused.statusCode).toBe(403);
  expect(refused._jsonData).toEqual(expect.objectContaining({ error: 'permission_denied', permission: 'customSlugs' }));
  expect(Url.findBySlug('first')).toBeUndefined();

  const res = await importCsv('longUrl,slug\nhttps://a.example,\n');
  expect(res._jsonData.results.success).toBe(1);
});
