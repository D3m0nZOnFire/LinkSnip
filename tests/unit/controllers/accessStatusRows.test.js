const DashboardController = require('../../../controllers/dashboardController');
const fileController = require('../../../controllers/fileController');
const pasteController = require('../../../controllers/pasteController');
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

    expect(statusOf(data.urls, 'u-used')).toBe('limit_reached');
    expect(statusOf(data.urls, 'u-reported')).toBe('quarantined');
    expect(statusOf(data.bundles, 'b-deact')).toBe('expired');
    expect(statusOf(data.bundles, 'b-used')).toBe('limit_reached');
    expect(statusOf(data.files, 'f-used')).toBe('limit_reached');
    expect(statusOf(data.files, 'f-later')).toBe('scheduled');
    expect(statusOf(data.pastes, 'p-used')).toBe('limit_reached');
    expect(statusOf(data.pastes, 'p-live')).toBe('active');
  });
});

describe('admin rows', () => {
  beforeEach(() => { user.isAdmin = 1; });

  it('admin dashboard links and bundles', () => {
    createTestUrl({ slug: 'u-exp', expiresAt: PAST });
    createTestBundle({ slug: 'b-reported', isQuarantined: 1 });

    const data = render(DashboardController.getAdminDashboard);

    expect(statusOf(data.urls, 'u-exp')).toBe('expired');
    expect(statusOf(data.bundles, 'b-reported')).toBe('quarantined');
  });

  it('Admin → Files', () => {
    createTestFile(user.id, { slug: 'f-deact', deactivateAt: PAST });
    expect(statusOf(render(fileController.adminList).files, 'f-deact')).toBe('expired');
  });

  it('Admin → Pastes', () => {
    createTestPaste(user.id, { slug: 'p-blocked', isBlocked: 1 });
    expect(statusOf(render(pasteController.adminList).pastes, 'p-blocked')).toBe('blocked');
  });
});
