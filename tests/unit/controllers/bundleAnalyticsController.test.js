// Mock models before requiring the controller
jest.mock('../../../models/Bundle');
jest.mock('../../../services/analyticsService');
jest.mock('../../../services/qrcodeService');
jest.mock('../../../config/database', () => ({
  prepare: jest.fn(() => ({ get: jest.fn() }))
}));

const BundleAnalyticsController = require('../../../controllers/bundleAnalyticsController');
const Bundle = require('../../../models/Bundle');
const AnalyticsService = require('../../../services/analyticsService');
const QRCodeService = require('../../../services/qrcodeService');
const db = require('../../../config/database');

function makeReq(overrides = {}) {
  return {
    params: {},
    query: {},
    session: {},
    protocol: 'https',
    get: jest.fn(() => 'example.com'),
    user: { id: 1, isAdmin: false },
    ...overrides
  };
}

function makeRes() {
  return {
    redirect: jest.fn(),
    json: jest.fn(),
    render: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    setHeader: jest.fn()
  };
}

const mockBundle = {
  id: 10,
  slug: 'test-bundle',
  title: 'Test Bundle',
  creatorId: 1,
  items: [{ id: 1, url: 'https://a.com' }, { id: 2, url: 'https://b.com' }],
  createdAt: new Date().toISOString()
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── trackBundleItemClick ─────────────────────────────────────────────────────

describe('trackBundleItemClick', () => {
  // /bt checks the item's bundle (bundleItemAccess.test.js covers the refusals); here it is live
  beforeEach(() => {
    Bundle.findById.mockReturnValue({ id: 10, slug: 'b', isBlocked: 0, isQuarantined: 0, clicks: 0, maxUses: null, password: null });
  });

  it('should return 404 when item not found', async () => {
    db.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(null) });
    const req = makeReq({ params: { itemId: '999' } });
    const res = makeRes();

    await BundleAnalyticsController.trackBundleItemClick(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith('error', expect.any(Object));
  });

  it('should redirect to item URL when item found', async () => {
    const mockItem = { id: 1, bundleId: 10, url: 'https://example.com' };
    db.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(mockItem) });
    AnalyticsService.record.mockResolvedValue();

    const req = makeReq({ params: { itemId: '1' } });
    const res = makeRes();

    await BundleAnalyticsController.trackBundleItemClick(req, res);

    expect(res.redirect).toHaveBeenCalledWith('https://example.com');
  });

  it('should record a click when item is found', async () => {
    const mockItem = { id: 1, bundleId: 10, url: 'https://example.com' };
    db.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(mockItem) });
    AnalyticsService.record.mockResolvedValue();

    const req = makeReq({ params: { itemId: '1' } });
    const res = makeRes();

    await BundleAnalyticsController.trackBundleItemClick(req, res);

    expect(AnalyticsService.record).toHaveBeenCalledWith(req, 'bundle', 10, 1);
  });

  it('should still redirect even if analytics recording fails', async () => {
    const mockItem = { id: 1, bundleId: 10, url: 'https://example.com' };
    db.prepare.mockReturnValue({ get: jest.fn().mockReturnValue(mockItem) });
    AnalyticsService.record.mockRejectedValue(new Error('fail'));

    const req = makeReq({ params: { itemId: '1' } });
    const res = makeRes();

    await BundleAnalyticsController.trackBundleItemClick(req, res);

    expect(res.redirect).toHaveBeenCalledWith('https://example.com');
  });
});

// ─── getBundleQRCode ──────────────────────────────────────────────────────────

describe('getBundleQRCode', () => {
  it('should return 404 when bundle not found', async () => {
    Bundle.findById.mockReturnValue(null);
    const req = makeReq({ params: { id: '99' }, query: {} });
    const res = makeRes();

    await BundleAnalyticsController.getBundleQRCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Bundle not found' });
  });

  it('should send a PNG buffer for a valid bundle', async () => {
    Bundle.findById.mockReturnValue(mockBundle);
    const fakeBuffer = Buffer.from('pngdata');
    QRCodeService.generateBuffer.mockResolvedValue(fakeBuffer);

    const req = makeReq({ params: { id: '10' }, query: { theme: 'light' } });
    const res = makeRes();

    await BundleAnalyticsController.getBundleQRCode(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.send).toHaveBeenCalledWith(fakeBuffer);
  });

  it('should return 500 if QR generation fails', async () => {
    Bundle.findById.mockReturnValue(mockBundle);
    QRCodeService.generateBuffer.mockRejectedValue(new Error('QR fail'));

    const req = makeReq({ params: { id: '10' }, query: {} });
    const res = makeRes();

    await BundleAnalyticsController.getBundleQRCode(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Failed to generate QR code' });
  });
});

// ─── downloadBundleQRCode ─────────────────────────────────────────────────────

describe('downloadBundleQRCode', () => {
  it('should return 404 when bundle not found', async () => {
    Bundle.findById.mockReturnValue(null);
    const req = makeReq({ params: { id: '99' }, query: {} });
    const res = makeRes();

    await BundleAnalyticsController.downloadBundleQRCode(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should set Content-Disposition header with bundle slug', async () => {
    Bundle.findById.mockReturnValue(mockBundle);
    QRCodeService.generateBuffer.mockResolvedValue(Buffer.from('data'));

    const req = makeReq({ params: { id: '10' }, query: {} });
    const res = makeRes();

    await BundleAnalyticsController.downloadBundleQRCode(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="qrcode-bundle-${mockBundle.slug}.png"`
    );
  });
});
