const fs = require('fs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const retention = require('../../../services/retentionService');
const DashboardController = require('../../../controllers/dashboardController');
const pasteController = require('../../../controllers/pasteController');
const {
  createTestUser, createTestUrl, createTestPaste, createMockRequest, createMockResponse
} = require('../../setup/testHelpers');

const NOW = new Date('2026-06-15T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();
const daysAhead = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

function setGraceDays(days) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify({ retention: { expiredGraceDays: days } }));
  configService.reload();
}

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

// Matches the nightly cleanup (Url/Paste.deleteInactiveRegistered): a registered
// user's item is deleted retention.expiredGraceDays after it expired or was deactivated.
describe('retentionService.deletesInDays', () => {
  const link = (fields) => ({ creatorId: 1, expiresAt: null, deactivateAt: null, ...fields });
  const days = (record, type = 'url') => retention.deletesInDays(type, record, NOW);

  it('counts down the last 30 days of the grace period', () => {
    expect(days(link({ expiresAt: daysAgo(70) }))).toBe(20);
    expect(days(link({ deactivateAt: daysAgo(89.5) }))).toBe(1);
  });

  it('shows nothing earlier in the grace period', () => {
    expect(days(link({ expiresAt: daysAgo(50) }))).toBeNull();
  });

  it('shows nothing once the grace period is over (the cleanup deletes it tonight)', () => {
    expect(days(link({ expiresAt: daysAgo(95) }))).toBeNull();
  });

  it('shows nothing for items that have not expired', () => {
    expect(days(link({}))).toBeNull();
    expect(days(link({ expiresAt: daysAhead(5), deactivateAt: daysAhead(5) }))).toBeNull();
  });

  it('counts from the earlier date, as the cleanup does', () => {
    expect(days(link({ expiresAt: daysAgo(80), deactivateAt: daysAgo(10) }))).toBe(10);
    expect(days(link({ expiresAt: daysAgo(10), deactivateAt: daysAgo(80) }))).toBe(10);
  });

  it('shows nothing for anonymous items (they are deleted as soon as they expire)', () => {
    expect(days(link({ creatorId: null, expiresAt: daysAgo(70) }))).toBeNull();
  });

  it('uses each type\'s owner column', () => {
    expect(days({ userId: 1, expiresAt: daysAgo(70) }, 'paste')).toBe(20);
    expect(days({ userId: null, expiresAt: daysAgo(70) }, 'paste')).toBeNull();
  });

  it('reads retention.expiredGraceDays live', () => {
    setGraceDays(40);
    expect(days(link({ expiresAt: daysAgo(25) }))).toBe(15);
    expect(days(link({ expiresAt: daysAgo(5) }))).toBeNull(); // 35 days left: not yet
  });

  it('warns for the whole period when it is shorter than 30 days', () => {
    setGraceDays(7);
    expect(days(link({ expiresAt: daysAgo(1) }))).toBe(6);
  });

  it('shows nothing when the grace period is 0', () => {
    setGraceDays(0);
    expect(days(link({ expiresAt: daysAgo(1) }))).toBeNull();
  });

  it('reads dates without a timezone as UTC', () => {
    expect(days(link({ expiresAt: daysAgo(70).slice(0, 16) }))).toBe(20);
  });
});

describe('list rows carry deletesInDays from the setting', () => {
  const expiredDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  let admin;
  beforeEach(async () => {
    const row = await createTestUser({ username: 'boss', isAdmin: 1 });
    admin = { id: row.id, username: 'boss', isAdmin: 1 };
    setGraceDays(40);
  });

  const render = (handler) => {
    const res = createMockResponse();
    handler(createMockRequest({
      user: admin, session: { userId: admin.id, isAdmin: true }, query: {}, protocol: 'http', get: () => 'localhost'
    }), res);
    return res._viewData;
  };
  const row = (rows, slug) => rows.find(r => r.slug === slug);

  it('dashboard', () => {
    createTestUrl({ slug: 'old', creatorId: admin.id, expiresAt: expiredDaysAgo(25) });
    expect(row(render(DashboardController.getUserDashboard).urls, 'old').deletesInDays).toBe(15);
  });

  it('dashboard pastes', () => {
    createTestPaste(admin.id, { slug: 'old-paste', expiresAt: expiredDaysAgo(25) });
    createTestPaste(admin.id, { slug: 'new-paste' });
    const pastes = render(DashboardController.getUserDashboard).pastes;
    expect(row(pastes, 'old-paste').deletesInDays).toBe(15);
    expect(row(pastes, 'new-paste').deletesInDays).toBeNull();
  });

  it('Admin → Pastes', () => {
    createTestPaste(admin.id, { slug: 'old-paste', expiresAt: expiredDaysAgo(25) });
    createTestPaste(null, { slug: 'anon-paste', expiresAt: expiredDaysAgo(25) });
    const pastes = render(pasteController.adminList).pastes;
    expect(row(pastes, 'old-paste').deletesInDays).toBe(15);
    expect(row(pastes, 'anon-paste').deletesInDays).toBeNull();
  });

  it('admin', () => {
    createTestUrl({ slug: 'old', creatorId: admin.id, expiresAt: expiredDaysAgo(25) });
    createTestUrl({ slug: 'anon', expiresAt: expiredDaysAgo(25) });
    const urls = render(DashboardController.getAdminDashboard).urls;
    expect(row(urls, 'old').deletesInDays).toBe(15);
    expect(row(urls, 'anon').deletesInDays).toBeNull();
  });
});
