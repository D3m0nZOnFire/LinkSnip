const BundleController = require('../../../controllers/bundleController');
const BundleAnalyticsController = require('../../../controllers/bundleAnalyticsController');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestBundle, createTestBundleItem, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

const itemClicks = () => getTestDatabase().prepare('SELECT COUNT(*) AS n FROM bundle_item_analytics').get().n;

async function click(itemId, session = {}, query = {}) {
  const res = createMockResponse();
  await BundleAnalyticsController.trackBundleItemClick(
    createMockRequest({ params: { itemId: String(itemId) }, session, query, originalUrl: `/bt/${itemId}`, get: () => undefined }),
    res
  );
  return res;
}

async function launch(slug, session) {
  const res = createMockResponse();
  await BundleController.launchBundle(createMockRequest({ params: { slug }, session, get: () => 'localhost' }), res);
  return res;
}

// /bt/:itemId redirects to one item of a bundle. It must not open anything the
// bundle's own page (/b/:slug) would refuse: item IDs are sequential and guessable.
describe('GET /bt/:itemId respects its bundle', () => {
  const bundleWithItem = (fields = {}) => {
    const bundle = createTestBundle({ slug: 'bb', ...fields });
    const item = createTestBundleItem(bundle.id, { url: 'https://secret.example' });
    return { bundle, item };
  };

  it('redirects for a live bundle and records the click', async () => {
    const { item } = bundleWithItem();
    const res = await click(item.id);
    expect(res.redirect).toHaveBeenCalledWith('https://secret.example');
    expect(itemClicks()).toBe(1);
  });

  it.each([
    ['blocked', { isBlocked: 1 }, 403],
    ['expired', { expiresAt: PAST }, 410],
    ['not active yet', { activateAt: FUTURE }, 404]
  ])('refuses items of a %s bundle, without recording a click', async (_state, fields, code) => {
    const { item } = bundleWithItem(fields);
    const res = await click(item.id);
    expect(res.statusCode).toBe(code);
    expect(res.redirect).not.toHaveBeenCalledWith('https://secret.example');
    expect(itemClicks()).toBe(0);
  });

  it('asks for the bundle password until the bundle is unlocked', async () => {
    const { bundle, item } = bundleWithItem({ password: 'hash' });

    expect((await click(item.id)).redirect).toHaveBeenCalledWith('/unlock-bundle/bb');
    expect((await click(item.id, { unlockedBundles: [bundle.id] })).redirect).toHaveBeenCalledWith('https://secret.example');
  });

  it('shows the quarantine warning until the visitor continued on the bundle', async () => {
    const { bundle, item } = bundleWithItem({ isQuarantined: 1 });

    const warned = await click(item.id);
    expect(warned._view).toBe('quarantine');
    expect(warned._viewData.continueUrl).toBe('/b/bb?confirmed=1');

    const res = await click(item.id, { quarantineAck: [`bundle:${bundle.id}`] });
    expect(res.redirect).toHaveBeenCalledWith('https://secret.example');
  });

  it('404s an item whose bundle is gone', async () => {
    const res = await click(99999);
    expect(res.statusCode).toBe(404);
  });

  describe('usage limit: launches are counted, not item clicks', () => {
    it('lets the visitor who used the last launch open its items', async () => {
      const { item } = bundleWithItem({ maxUses: 1 });
      const session = {};

      expect((await launch('bb', session))._view).toBe('bundle-launcher');
      const res = await click(item.id, session);

      expect(res.redirect).toHaveBeenCalledWith('https://secret.example');
    });

    it('refuses the items of a used-up bundle to anyone who did not launch it', async () => {
      const { item } = bundleWithItem({ maxUses: 1, clicks: 1 });
      const res = await click(item.id);
      expect(res.statusCode).toBe(410);
      expect(itemClicks()).toBe(0);
    });

    it('still refuses a bundle that was blocked after the visitor launched it', async () => {
      const { bundle, item } = bundleWithItem({ maxUses: 1 });
      const session = {};
      await launch('bb', session);
      getTestDatabase().prepare('UPDATE bundles SET isBlocked = 1 WHERE id = ?').run(bundle.id);

      expect((await click(item.id, session)).statusCode).toBe(403);
    });
  });
});
