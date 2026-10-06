const UrlInfoController = require('../../../controllers/infoController');
const BundleController = require('../../../controllers/bundleController');
const BioPageController = require('../../../controllers/bioPageController');
const pasteController = require('../../../controllers/pasteController');
const fileController = require('../../../controllers/fileController');
const BioPage = require('../../../models/BioPage');
const {
  createTestUser, createTestUrl, createTestBundle, createTestBundleItem, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

/**
 * What a chat app shows for a shared page (`share` → og:description / og:url in partials/head): what the item is,
 * never its content, and nothing for an item that is locked or unavailable.
 */
const visit = (params) => createMockRequest({
  params, session: {}, originalUrl: '/x', protocol: 'https',
  get: (name) => (name.toLowerCase() === 'host' ? 'lnksnp.ch' : undefined),
  headers: { 'user-agent': 'WhatsApp/2.23.20.0 A' }
});

async function shareOf(handler, params) {
  const res = createMockResponse();
  res.set = jest.fn();
  await handler(visit(params), res);
  return res._viewData && res._viewData.share;
}

let owner;
beforeEach(async () => { owner = await createTestUser({ username: 'owner' }); });

describe('a paste (/p/:slug, /p-info/:slug)', () => {
  const content = 'resistor 10k\ncapacitor 100nF\nled red';

  it('says it is a paste, how long and in what language, not what it says', async () => {
    createTestPaste(owner.id, { slug: 'parts', title: 'Parts list', content, language: 'markdown' });
    const share = await shareOf(pasteController.view, { slug: 'parts' });
    expect(share).toEqual({ description: 'Paste · 3 lines · markdown', url: 'https://lnksnp.ch/p/parts' });
  });

  it('one line, no language', async () => {
    createTestPaste(owner.id, { slug: 'parts', content: 'just one', language: null });
    expect((await shareOf(pasteController.view, { slug: 'parts' })).description).toBe('Paste · 1 line');
  });

  it('the info page: the same, at its own address', async () => {
    createTestPaste(owner.id, { slug: 'parts', content, language: 'markdown' });
    expect(await shareOf(pasteController.showInfoPage, { slug: 'parts' }))
      .toEqual({ description: 'Paste · 3 lines · markdown', url: 'https://lnksnp.ch/p-info/parts' });
  });

  it('the info page of a password-protected paste: nothing', async () => {
    createTestPaste(owner.id, { slug: 'parts', content, password: 'hash' });
    expect(await shareOf(pasteController.showInfoPage, { slug: 'parts' })).toBeNull();
  });
});

describe('a file (/f/:slug)', () => {
  it('says it is a file and how big', async () => {
    createTestFile(owner.id, { slug: 'doc', originalName: 'report.pdf', size: 2.5 * 1024 * 1024 });
    expect(await shareOf(fileController.preview, { slug: 'doc' }))
      .toEqual({ description: 'File · 2.5 MB', url: 'https://lnksnp.ch/f/doc' });
  });
});

describe('a bundle (/b/:slug)', () => {
  it('says how many links it has, then its description', async () => {
    const bundle = createTestBundle({ slug: 'kit', title: 'Starter kit', description: 'Everything to begin' });
    createTestBundleItem(bundle.id, { url: 'https://a.example' });
    createTestBundleItem(bundle.id, { url: 'https://b.example', position: 1 });
    expect(await shareOf(BundleController.launchBundle, { slug: 'kit' }))
      .toEqual({ description: 'Bundle · 2 links · Everything to begin', url: 'https://lnksnp.ch/b/kit' });
  });
});

describe('a link info page (/info/:slug)', () => {
  it("names the destination's domain (the page shows it too)", async () => {
    createTestUrl({ slug: 'go', longUrl: 'https://www.example.com/a/long/path?q=1' });
    expect(await shareOf(UrlInfoController.getUrlInfo, { slug: 'go' }))
      .toEqual({ description: 'Short link to www.example.com', url: 'https://lnksnp.ch/info/go' });
  });

  it('a password-protected link: nothing', async () => {
    createTestUrl({ slug: 'go', password: 'hash' });
    expect(await shareOf(UrlInfoController.getUrlInfo, { slug: 'go' })).toBeNull();
  });
});

describe('a bio page (/bio/:username)', () => {
  it('shows the bio', async () => {
    BioPage.create(owner.id, 'Owner', 'Maker of things');
    expect(await shareOf(BioPageController.getBioPage, { username: 'owner' }))
      .toEqual({ description: 'Maker of things', url: 'https://lnksnp.ch/bio/owner' });
  });

  it('without a bio: whose links these are', async () => {
    BioPage.create(owner.id, 'Owner');
    expect((await shareOf(BioPageController.getBioPage, { username: 'owner' })).description).toBe('Links by Owner');
  });
});
