const ImportExportController = require('../../../controllers/importExportController');
const ImportExportService = require('../../../services/importExportService');
const Url = require('../../../models/Url');
const { createTestUser, createTestUrl, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// Bulk import and export carry the private flag (isPrivate): the sixth CSV/text column, a JSON field. A value that
// is neither yes nor no refuses the file, so a typo never leaves a link public.

let user;
beforeEach(async () => {
  const u = await createTestUser({ username: 'importer', role: 'trusted' });
  user = { id: u.id, username: 'importer', isAdmin: 0, role: 'trusted' };
});

async function importFile(content, originalname) {
  const res = createMockResponse();
  await ImportExportController.importUrls(createMockRequest({
    user,
    file: { buffer: Buffer.from(content), originalname },
    protocol: 'http',
    get: () => 'localhost'
  }), res);
  return res;
}

function exportAs(format) {
  const res = createMockResponse();
  res.setHeader = jest.fn();
  ImportExportController.exportUrls(createMockRequest({ user, query: { format }, get: () => 'localhost' }), res);
  return res._sentData;
}

it('the CSV isPrivate column makes links private (yes, 1, true, private) or public (empty, no, 0)', async () => {
  const res = await importFile([
    'longUrl,slug,tags,expirationDays,maxUses,isPrivate',
    'https://a.example,a1,,,,yes',
    'https://b.example,b1,,,,1',
    'https://c.example,c1,,,,TRUE',
    'https://d.example,d1,,,,private',
    'https://e.example,e1,,,,',
    'https://f.example,f1,,,,no',
    'https://g.example,g1,,,,0',
    'https://h.example,h1'
  ].join('\n'), 'links.csv');

  expect(res._jsonData.results.success).toBe(8);
  const flag = slug => Url.findBySlug(slug).isPrivate;
  expect(['a1', 'b1', 'c1', 'd1'].map(flag)).toEqual([1, 1, 1, 1]);
  expect(['e1', 'f1', 'g1', 'h1'].map(flag)).toEqual([0, 0, 0, 0]);
});

it('JSON takes isPrivate as a boolean or the same words', async () => {
  const res = await importFile(JSON.stringify([
    { longUrl: 'https://a.example', slug: 'a1', isPrivate: true },
    { longUrl: 'https://b.example', slug: 'b1', isPrivate: 'yes' },
    { longUrl: 'https://c.example', slug: 'c1', isPrivate: false },
    { longUrl: 'https://d.example', slug: 'd1' }
  ]), 'links.json');

  expect(res._jsonData.results.success).toBe(4);
  expect(['a1', 'b1', 'c1', 'd1'].map(slug => Url.findBySlug(slug).isPrivate)).toEqual([1, 1, 0, 0]);
});

it('plain text lines with commas read the sixth part as isPrivate', async () => {
  const res = await importFile('https://a.example,a1,,,,yes\nhttps://b.example\n', 'links.txt');
  expect(res._jsonData.results.success).toBe(2);
  expect(Url.findBySlug('a1').isPrivate).toBe(1);
});

it('an unreadable isPrivate value refuses the file and names the line', async () => {
  const res = await importFile('longUrl,slug,tags,expirationDays,maxUses,isPrivate\nhttps://a.example,a1,,,,maybe\n',
    'links.csv');
  expect(res.statusCode).toBe(400);
  expect(res._jsonData.details.join(' ')).toMatch(/Line 2: .*isPrivate.*maybe/);
  expect(Url.findBySlug('a1')).toBeUndefined();

  const json = await importFile(JSON.stringify([{ longUrl: 'https://b.example', slug: 'b1', isPrivate: 'perhaps' }]),
    'links.json');
  expect(json.statusCode).toBe(400);
  expect(Url.findBySlug('b1')).toBeUndefined();
});

it('the CSV export has a Private column and the JSON export isPrivate', () => {
  createTestUrl({ slug: 'secret', creatorId: user.id, isPrivate: 1 });
  createTestUrl({ slug: 'open', creatorId: user.id });

  const csv = exportAs('csv').trim().split('\n');
  expect(csv[0].split(',')).toContain('Private');
  const column = csv[0].split(',').indexOf('Private');
  const row = slug => csv.find(line => line.startsWith(`${slug},`)).split(',')[column];
  expect(row('secret')).toBe('Yes');
  expect(row('open')).toBe('No');

  const json = JSON.parse(exportAs('json'));
  expect(json.find(u => u.slug === 'secret').isPrivate).toBe(true);
  expect(json.find(u => u.slug === 'open').isPrivate).toBe(false);
});

it('the import template has the isPrivate column', () => {
  const header = ImportExportService.generateImportTemplate().split('\n')[0].trim();
  expect(header).toBe('longUrl,slug,tags,expirationDays,maxUses,isPrivate');
});
