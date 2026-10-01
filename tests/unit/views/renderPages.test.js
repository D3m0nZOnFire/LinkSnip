const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const AnalyticsShare = require('../../../models/AnalyticsShare');
const { viewLocals, appLocals } = require('../../../middleware/viewLocals');
const { bodyChildren } = require('../../setup/htmlTree');
const { getTestDatabase } = require('../../setup/testDatabase');
const {
  createTestUser, createTestUrl, createTestTag, createTestBundle, createTestBundleItem, createTestFile,
  createTestPaste, createTestReport, createMockRequest, createMockResponse, tagItem
} = require('../../setup/testHelpers');

/**
 * Renders every page for real: the controller builds its data from a seeded database, then the
 * template renders with the locals the app adds (app.locals + the view-locals middleware).
 * Controller tests stub res.render, so this is where a template that crashes, or a page that breaks
 * the shared layout, shows up.
 */
const VIEWS = path.join(__dirname, '../../../views');

afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

let s; // seeded records
beforeEach(async () => {
  const db = getTestDatabase();
  const admin = await createTestUser({ username: 'boss', isAdmin: 1 });
  const user = await createTestUser({ username: 'alice' });
  const password = await bcrypt.hash('secret', 4);
  const url = createTestUrl({ slug: 'link', creatorId: user.id, clicks: 3 });
  const lockedUrl = createTestUrl({ slug: 'locked', creatorId: user.id, password });
  const soonUrl = createTestUrl({ slug: 'soon', creatorId: user.id, activateAt: '2999-01-01T00:00:00.000Z' });
  const flaggedUrl = createTestUrl({ slug: 'flagged', creatorId: user.id, isQuarantined: 1 });
  const tag = createTestTag({ name: 'launch', userId: user.id });
  tagItem('url', url.id, tag.id);
  const bundle = createTestBundle({ slug: 'kit', creatorId: user.id, description: 'Things' });
  createTestBundleItem(bundle.id, { url: 'https://example.com/a', label: 'A' });
  const paste = createTestPaste(user.id, { slug: 'notes', content: 'line one\nline two', language: 'markdown' });
  const file = createTestFile(user.id, { slug: 'doc' });
  createTestReport({ urlId: flaggedUrl.id });
  AnalyticsShare.create({ targetType: 'url', targetId: url.id, createdBy: user.id, label: 'Client' });
  db.prepare(`INSERT INTO analytics_events (targetType, targetId, timestamp, ipHash, browser, os, device, country)
              VALUES ('url', ?, datetime('now'), 'h1', 'Firefox', 'Linux', 'desktop', 'CH')`).run(url.id);
  db.prepare(`INSERT INTO audit_logs (action, category, userId, username, ipAddress, details)
              VALUES ('LOGIN_SUCCESS', 'AUTH', ?, 'boss', '127.0.0.1', '{}')`).run(admin.id);
  const team = teamService.create(admin, 'Crew');
  s = { admin, user, url, lockedUrl, soonUrl, flaggedUrl, tag, bundle, paste, file, team };
});

function request(user, overrides = {}) {
  return createMockRequest({
    user: user || null,
    session: user ? { userId: user.id, isAdmin: !!user.isAdmin } : {},
    protocol: 'http',
    get: (name) => (name.toLowerCase() === 'host' ? 'localhost:8081' : undefined),
    originalUrl: '/',
    path: '/',
    ...overrides
  });
}

// Runs a handler and returns what it rendered
async function rendered(handler, req) {
  const res = createMockResponse();
  await handler(req, res, jest.fn());
  if (!res._view) throw new Error(`rendered nothing (status ${res.statusCode}, redirect ${res._redirectUrl})`);
  return { req, view: res._view, data: res._viewData };
}

const c = (name) => require(`../../../controllers/${name}`);

// One entry per page: how the app reaches it
const PAGES = {
  'index': () => rendered(c('urlController').getCreateForm, request(s.user)),
  'login': () => rendered(c('authController').getLogin, request(null)),
  'register': () => rendered(c('authController').getRegister, request(null)),
  'setup': async () => ({ req: request(null), view: 'setup', data: { error: null, username: '', minPassword: 8 } }),
  'dashboard': () => rendered(c('dashboardController').getUserDashboard, request(s.user)),
  'settings': () => rendered(c('userController').getSettings, request(s.user)),
  'import': () => rendered(c('importExportController').getImportPage, request(s.user)),
  'tags': () => rendered(c('tagController').getTagManagementPage, request(s.user)),
  'tag-analytics': () => rendered(c('tagController').getTagAnalytics, request(s.user, { params: { id: String(s.tag.id) } })),
  'teams': () => rendered(c('teamController').listPage, request(s.user)),
  'team': () => rendered(c('teamController').teamPage, request(s.admin, { params: { id: String(s.team.id) } })),
  'analytics': () => rendered(c('analyticsController').getAnalyticsPage, request(s.user, { params: { type: 'url', id: String(s.url.id) } })),
  'url-info': () => rendered(c('infoController').getUrlInfo, request(null, { params: { slug: 'link' } })),
  'paste-view': () => rendered(c('pasteController').view, request(null, { params: { slug: 'notes' } })),
  'paste-info': () => rendered(c('pasteController').showInfoPage, request(null, { params: { slug: 'notes' } })),
  'paste-edit': () => rendered(c('pasteController').showEditPage, request(s.user, { params: { id: String(s.paste.id) } })),
  'file-download': () => rendered(c('fileController').preview, request(null, { params: { slug: 'doc' } })),
  'bundle-launcher': () => rendered(c('bundleController').launchBundle, request(null, { params: { slug: 'kit' } })),
  'unlock': () => rendered(c('unlockController').showUnlockPage, request(null, { params: { type: 'url', slug: 'locked' } })),
  'scheduled': () => rendered(c('urlController').redirect, request(null, { params: { slug: 'soon' } })),
  'quarantine': () => rendered(c('urlController').redirect, request(null, { params: { slug: 'flagged' } })),
  'error': async () => ({ req: request(null), view: 'error', data: { title: 'Page Not Found', message: 'Nope.', code: 404 } }),
  'bio-page': async () => ({ req: request(null), view: 'bio-page', data: bioPageData() }),
  'bio-settings': async () => ({ req: request(s.user), view: 'bio-settings', data: bioSettingsData() }),
  'admin': () => rendered(c('dashboardController').getAdminDashboard, request(s.admin)),
  'admin-users': () => rendered(c('adminController').getUsersPage, request(s.admin)),
  'admin-files': () => rendered(c('fileController').adminList, request(s.admin)),
  'admin-pastes': () => rendered(c('pasteController').adminList, request(s.admin)),
  'admin-reports': () => rendered(c('reportController').getReportsPage, request(s.admin)),
  'admin-analytics': () => rendered(c('analyticsController').getAdminAnalyticsPage, request(s.admin)),
  'admin-analytics-shares': () => rendered(c('analyticsShareController').getAdminPage, request(s.admin)),
  'admin-audit-logs': () => rendered(c('auditLogController').getAuditLogsPage, request(s.admin)),
  'admin-teams': () => rendered(c('teamController').adminPage, request(s.admin)),
  'admin-settings': () => rendered(c('adminSettingsController').getSettingsPage, request(s.admin))
};

// The bio page tables aren't part of the test database; same shape as BioPage.findByUsername
function bioPageData() {
  return {
    bioPage: { id: 1, userId: s.user.id, displayName: 'Alice', bio: 'Hello', theme: 'dark', avatarUrl: null,
      gradientStart: null, gradientEnd: null, socialLinks: [{ platform: 'github', url: 'https://github.com/a', icon: 'github' }] },
    username: 'alice',
    urls: [{ ...s.url, title: 'My link', tags: [s.tag] }],
    socialLinks: [{ platform: 'github', url: 'https://github.com/a', icon: 'github' }],
    baseUrl: 'http://localhost:8081',
    user: null
  };
}
function bioSettingsData() {
  const { bioPage, socialLinks } = bioPageData();
  return {
    user: s.user, bioPage, userUrls: [s.url], bioPageUrlIds: new Set([s.url.id]), socialLinks, currentPage: 'bio-settings'
  };
}

async function renderPage(name) {
  const { req, view, data } = await PAGES[name]();
  expect(view).toBe(name);
  const res = createMockResponse();
  viewLocals(req, res, () => {});
  return ejs.renderFile(path.join(VIEWS, `${view}.ejs`), { ...appLocals(), ...res.locals, ...data });
}

const pages = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs')).map(f => f.replace(/\.ejs$/, ''));

describe('every page renders', () => {
  it('has a case for every page in views/', () => {
    expect(Object.keys(PAGES).sort()).toEqual(pages.sort());
  });

  it.each(pages)('%s', async (name) => {
    const html = await renderPage(name);

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<footer class="site-footer"/g)).toHaveLength(1);

    // header, then .page with everything else, then the footer (main.css pins it to the bottom)
    const children = bodyChildren(html).filter(el => !['script', 'noscript', 'template'].includes(el.name));
    const pageAt = children.findIndex(el => el.classes.includes('page'));
    const footerAt = children.findIndex(el => el.name === 'footer');
    expect(pageAt).toBeGreaterThan(-1);
    expect(footerAt).toBe(children.length - 1);
    children.forEach((el, i) => {
      if (i === pageAt || i === footerAt) return;
      expect({ el, before: i < pageAt }).toEqual({ el: expect.objectContaining({ name: 'header' }), before: true });
    });
  });
});
