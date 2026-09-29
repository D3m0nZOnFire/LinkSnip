const UrlController = require('../../../controllers/urlController');
const BundleController = require('../../../controllers/bundleController');
const { createTestUrl, createTestBundle, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

function visit(slug, query = {}) {
  return createMockRequest({ params: { slug }, query, session: {}, get: () => undefined });
}

describe('quarantined links (visitor side)', () => {
  it('shows a warning page instead of redirecting', async () => {
    createTestUrl({ slug: 'sus', longUrl: 'https://evil.example', isQuarantined: 1 });
    const res = createMockResponse();

    await UrlController.redirect(visit('sus'), res);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(res._view).toBe('quarantine');
    expect(res._viewData).toEqual(expect.objectContaining({
      continueUrl: '/s/sus?confirmed=1',
      destination: 'https://evil.example'
    }));
  });

  it('redirects after the visitor chose to continue', async () => {
    createTestUrl({ slug: 'sus', longUrl: 'https://evil.example', isQuarantined: 1 });
    const res = createMockResponse();

    await UrlController.redirect(visit('sus', { confirmed: '1' }), res);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://evil.example');
  });

  it('does not count a click for the warning page itself', async () => {
    const url = createTestUrl({ slug: 'sus', isQuarantined: 1 });
    await UrlController.redirect(visit('sus'), createMockResponse());

    const { getTestDatabase } = require('../../setup/testDatabase');
    expect(getTestDatabase().prepare('SELECT clicks FROM urls WHERE id = ?').get(url.id).clicks).toBe(0);
  });

  it('still refuses a blocked link, confirmed or not', async () => {
    createTestUrl({ slug: 'dead', isQuarantined: 1, isBlocked: 1 });
    const res = createMockResponse();

    await UrlController.redirect(visit('dead', { confirmed: '1' }), res);

    expect(res.statusCode).toBe(403);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('leaves normal links alone', async () => {
    createTestUrl({ slug: 'fine', longUrl: 'https://ok.example' });
    const res = createMockResponse();

    await UrlController.redirect(visit('fine'), res);

    expect(res.redirect).toHaveBeenCalledWith(302, 'https://ok.example');
  });

  it('shows the warning for quarantined bundles, then launches after confirming', async () => {
    createTestBundle({ slug: 'bb', isQuarantined: 1 });

    const warned = createMockResponse();
    await BundleController.launchBundle(visit('bb'), warned);
    expect(warned._view).toBe('quarantine');
    expect(warned._viewData.continueUrl).toBe('/b/bb?confirmed=1');

    const launched = createMockResponse();
    await BundleController.launchBundle(visit('bb', { confirmed: '1' }), launched);
    expect(launched._view).toBe('bundle-launcher');
  });
});
