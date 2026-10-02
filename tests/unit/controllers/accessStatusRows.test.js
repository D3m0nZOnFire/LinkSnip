const DashboardController = require('../../../controllers/dashboardController');
const {
  createTestUser, createTestUrl, createTestBundle, createTestPaste, createTestFile,
  createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

// Lists no longer work out a status in the template: every row carries accessStatus
let user;
beforeEach(async () => {
  const row = await createTestUser({ username: 'me', role: 'trusted' });
  user = { id: row.id, username: 'me', role: 'trusted', isAdmin: 0 };
});

const listReq = () => createMockRequest({
  user, session: { userId: user.id, isAdmin: !!user.isAdmin }, query: {}, protocol: 'http', get: () => 'localhost'
});

function render(handler, req = listReq()) {
  const res = createMockResponse();
  handler(req, res);
  return res._viewData;
}

const statusOf = (rows, slug) => rows.find(r => r.slug === slug).accessStatus;
const ofType = (data, type) => data.result.rows.filter(r => r.type === type);

describe('user dashboard rows', () => {
  it('links, bundles, files and pastes all carry the shared status', () => {
    createTestUrl({ slug: 'u-used', creatorId: user.id, clicks: 1, maxUses: 1 });
    createTestUrl({ slug: 'u-reported', creatorId: user.id, isQuarantined: 1 });
    createTestBundle({ slug: 'b-deact', creatorId: user.id, deactivateAt: PAST });
    createTestBundle({ slug: 'b-used', creatorId: user.id, clicks: 2, maxUses: 2 });
    createTestFile(user.id, { slug: 'f-used', downloads: 1, maxDownloads: 1 });
    createTestFile(user.id, { slug: 'f-later', activateAt: FUTURE });
    createTestPaste(user.id, { slug: 'p-used', views: 1, maxViews: 1 });
    createTestPaste(user.id, { slug: 'p-live' });

    const data = render(DashboardController.getUserDashboard);

    expect(statusOf(ofType(data, 'url'), 'u-used')).toBe('limit_reached');
    expect(statusOf(ofType(data, 'url'), 'u-reported')).toBe('quarantined');
    expect(statusOf(ofType(data, 'bundle'), 'b-deact')).toBe('expired');
    expect(statusOf(ofType(data, 'bundle'), 'b-used')).toBe('limit_reached');
    expect(statusOf(ofType(data, 'file'), 'f-used')).toBe('limit_reached');
    expect(statusOf(ofType(data, 'file'), 'f-later')).toBe('scheduled');
    expect(statusOf(ofType(data, 'paste'), 'p-used')).toBe('limit_reached');
    expect(statusOf(ofType(data, 'paste'), 'p-live')).toBe('active');
  });
});

describe('admin rows (Admin → Items)', () => {
  const adminItems = require('../../../services/itemList');
  const rows = () => adminItems.list({ limit: null }).rows;
  const statusIn = (type, slug) => rows().find(r => r.type === type && r.slug === slug).accessStatus;

  it('links and bundles', () => {
    createTestUrl({ slug: 'u-exp', expiresAt: PAST });
    createTestBundle({ slug: 'b-reported', isQuarantined: 1 });
    expect(statusIn('url', 'u-exp')).toBe('expired');
    expect(statusIn('bundle', 'b-reported')).toBe('quarantined');
  });

  it('files', () => {
    createTestFile(user.id, { slug: 'f-deact', deactivateAt: PAST });
    expect(statusIn('file', 'f-deact')).toBe('expired');
  });

  it('pastes', () => {
    createTestPaste(user.id, { slug: 'p-blocked', isBlocked: 1 });
    expect(statusIn('paste', 'p-blocked')).toBe('blocked');
  });
});
