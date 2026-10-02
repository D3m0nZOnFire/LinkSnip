const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const bcrypt = require('bcrypt');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const teamService = require('../../../services/teamService');
const AnalyticsShare = require('../../../models/AnalyticsShare');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const { bodyTree } = require('../../setup/htmlTree');
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
  fs.rmSync(paths.PALETTES_DIR, { recursive: true, force: true });
  configService.reload();
  require('../../../services/paletteService').reload();
});

let s; // seeded records
beforeEach(async () => {
  configService.updateSettings({ 'branding.name': 'Snipz' });
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
  'admin-overview': () => rendered(c('adminOverviewController').overviewPage, request(s.admin)),
  'admin-items': () => rendered(c('adminItemsController').itemsPage, request(s.admin, { query: {} })),
  'admin-users': () => rendered(c('adminController').getUsersPage, request(s.admin)),
  'admin-reports': () => rendered(c('reportController').getReportsPage, request(s.admin)),
  'admin-analytics': () => rendered(c('analyticsController').getAdminAnalyticsPage, request(s.admin)),
  'admin-analytics-shares': () => rendered(c('analyticsShareController').getAdminPage, request(s.admin)),
  'admin-audit-logs': () => rendered(c('auditLogController').getAuditLogsPage, request(s.admin)),
  'admin-teams': () => rendered(c('teamController').adminPage, request(s.admin)),
  'admin-settings': () => rendered(c('adminSettingsController').getSettingsPage, request(s.admin)),
  'admin-appearance': () => {
    require('../../../services/paletteService').createPalette({ name: 'Company', mode: 'dark',
      colors: { accent: '#3b82f6', background: '#0b1220', foreground: '#e6edf3', red: '#ef4444', yellow: '#f59e0b' } });
    return rendered(c('brandingController').appearancePage, request(s.admin));
  }
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

async function localsFor(user) {
  const req = request(user);
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  return res.locals;
}

async function renderPage(name) {
  const { req, view, data } = await PAGES[name]();
  expect(view).toBe(name);
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  return ejs.renderFile(path.join(VIEWS, `${view}.ejs`), { ...appLocals(), ...res.locals, ...data });
}

const pages = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs')).map(f => f.replace(/\.ejs$/, ''));

// Which frame each page has, as the seeded case renders it:
//   app: sidebar + main column (top bar on small screens, page, footer) for logged-in work
//   admin: the same with the admin sidebar (admin mode)
//   public: slim header, page, footer, for anyone (the item pages, the home page of a visitor)
//   standalone: page and footer only (login, errors, bio pages)
const SHELL = Object.fromEntries(pages.map(name => [name,
  ['url-info', 'paste-view', 'paste-info', 'file-download', 'bundle-launcher', 'unlock'].includes(name) ? 'public'
    : ['login', 'register', 'setup', 'error', 'scheduled', 'quarantine', 'bio-page'].includes(name) ? 'standalone'
      : name.startsWith('admin') ? 'admin'
        : 'app']));

const visible = (nodes) => nodes.filter(el => !['script', 'noscript', 'template'].includes(el.name));
const describeNode = (el) => `${el.name}${el.classes.map(c => `.${c}`).join('')}`;

// The footer is the last thing in its column, after .page (main.css pins it to the bottom of the window)
function expectLayout(html, shell) {
  const body = bodyTree(html);
  const top = visible(body.children).map(describeNode);
  if (shell === 'app' || shell === 'admin') {
    expect(body.classes).toContain('app');
    expect(top).toEqual([shell === 'admin' ? 'aside.sidebar.sidebar-admin' : 'aside.sidebar', 'div.sidebar-backdrop', 'div.app-main']);
    const main = body.children.find(el => el.classes.includes('app-main'));
    expect(visible(main.children).map(describeNode)).toEqual(['header.topbar', 'div.page', 'footer.site-footer']);
  } else if (shell === 'public') {
    expect(body.classes).not.toContain('app');
    expect(top).toEqual(['header.site-header', 'div.page', 'footer.site-footer']);
  } else {
    expect(top).toEqual([expect.stringMatching(/^div\.page/), 'footer.site-footer']);
  }
}

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

    // The site's name (Admin → Appearance), not LinkSnip's; the footer credits LinkSnip on purpose
    expect(html).toMatch(/<title>[^<]*Snipz<\/title>/);
    const withoutFooter = html.replace(/<footer class="site-footer"[\s\S]*?<\/footer>/, '');
    expect(withoutFooter).not.toMatch(/>\s*LinkSnip\s*</);
    expect(withoutFooter).not.toMatch(/alt="LinkSnip/);

    expectLayout(html, SHELL[name]);
  });
});

describe('admin-appearance', () => {
  it('shows custom palettes with an edit button and a New tile per mode', async () => {
    const html = await renderPage('admin-appearance');
    expect(html).toMatch(/<button type="button" class="palette-edit" data-edit="company"/);
    expect(html).toContain('data-new="dark"');
    expect(html).toContain('data-new="light"');
    const data = JSON.parse(html.match(/<script type="application\/json" id="paletteData">([\s\S]*?)<\/script>/)[1]);
    expect(data.find(p => p.id === 'company')).toMatchObject({ builtIn: false, mode: 'dark' });
  });
});

describe('pages with two frames', () => {
  it('index: the public header for visitors', async () => {
    const { data } = await rendered(c('urlController').getCreateForm, request(null));
    const res = createMockResponse();
    brandingLocals(request(null), res, () => {});
    viewLocals(request(null), res, () => {});
    const html = await ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...res.locals, ...data });
    expectLayout(html, 'public');
  });

  it('analytics: the public header on a read-only share link (/stats/:token)', async () => {
    const { data } = await rendered(c('analyticsController').getAnalyticsPage, request(s.user, { params: { type: 'url', id: String(s.url.id) } }));
    const html = await ejs.renderFile(path.join(VIEWS, 'analytics.ejs'), { ...appLocals(), ...(await localsFor(null)), ...data, user: null, readOnly: true });
    expectLayout(html, 'public');
  });
});

describe('index: links in the address (lnksnp.ch/<link>)', () => {
  const YOUTUBE = 'https://www.youtube.com/watch?v=JSur9qyqtuA&t=262s';

  it('fills the Link tab with the whole link, query string included', async () => {
    const req = request(s.user, { prefillUrl: YOUTUBE });
    const { data } = await rendered(c('urlController').getCreateForm, req);
    const html = await ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...(await localsFor(s.user)), ...data });
    expect(html).toMatch(/<input[^>]*id="longUrl"[^>]*value="https:\/\/www\.youtube\.com\/watch\?v=JSur9qyqtuA&amp;t=262s"/);
    expect(html).toMatch(/<button[^>]*class="mode-pill active" id="pillUrl"/);
  });
});

describe('admin-items', () => {
  const renderItems = async (query) => {
    const { req, data } = await rendered(c('adminItemsController').itemsPage, request(s.admin, { query }));
    return ejs.renderFile(path.join(VIEWS, 'admin-items.ejs'), { ...appLocals(), ...(await localsFor(req.user)), ...data });
  };

  it('shows every type with its own actions, and the type pills', async () => {
    const html = await renderItems({});
    for (const [type, slug] of [['url', 'link'], ['bundle', 'kit'], ['paste', 'notes'], ['file', 'doc']]) {
      expect(html).toMatch(new RegExp(`<div class="item-row[^"]*" data-type="${type}" data-id="\\d+" data-slug="${slug}"`));
    }
    for (const pill of ['all', 'url', 'bundle', 'paste', 'file']) expect(html).toContain(`data-type-pill="${pill}"`);
    expect(html).toMatch(/href="\/analytics\/paste\/\d+"/);
    expect(html).toMatch(/href="\/pastes\/\d+\/edit"/);
    expect(html).toMatch(/data-edit-url="\d+"/);
  });

  it('marks the current type and keeps the filters in the form', async () => {
    const html = await renderItems({ type: 'paste', search: '@user:alice', status: 'active' });
    expect(html).toMatch(/<a href="\/admin\/items\?type=paste[^"]*" class="type-pill" data-type-pill="paste" aria-current="page">/);
    expect(html).toContain('value="@user:alice"');
    expect(html).toMatch(/<option value="active" selected>/);
  });

  it('says so when nothing matches', async () => {
    expect(await renderItems({ search: 'zzz-nothing' })).toContain('No items match');
  });
});

describe('app pages (v1.3 part 5b): no inline styling, no emoji, the shared look', () => {
  const APP_PAGES = ['tags', 'tag-analytics', 'teams', 'team', 'settings', 'import', 'bio-settings'];
  const EMOJI = /\p{Extended_Pictographic}/u;

  it.each(APP_PAGES)('%s.ejs has no <style> blocks, style attributes (CSS variables aside), inline handlers or emoji', (name) => {
    const source = fs.readFileSync(path.join(VIEWS, `${name}.ejs`), 'utf8');
    expect(source).not.toMatch(/<style/);
    expect(source.match(/\sstyle="(?!--[a-z-]+:)[^"]*"/g)).toBeNull();
    expect(source).not.toMatch(/\son[a-z]+="/);
    expect(source).not.toMatch(EMOJI);
  });

  it.each(APP_PAGES)('%s has no inline script code (scripts come from /js)', async (name) => {
    const html = await renderPage(name);
    const inline = (html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/g) || [])
      .filter(script => !/theme|data-theme/.test(script)); // the head's theme bootstrap
    const own = inline.filter(script => !script.includes('team-invite'));
    expect(own).toEqual([]);
  });

  it('tags: the totals in the header, no "Back to Dashboard", the how-to only without tags', async () => {
    const html = await renderPage('tags');
    expect(html).toMatch(/1 tag · 1 use · 1 visit/);
    expect(html).not.toContain('Back to Dashboard');
    expect(html).not.toContain('How to use tags');
    expect(html).toMatch(new RegExp(`data-tag-id="${s.tag.id}"[^>]*data-tag-name="launch"`));
  });

  it('tags: a quote in a tag name stays text (no inline JavaScript)', async () => {
    getTestDatabase().prepare('UPDATE tags SET name = ? WHERE id = ?').run("it's\");alert(1)//", s.tag.id);
    const html = await renderPage('tags');
    expect(html).toContain('data-tag-name="it&#39;s&#34;);alert(1)//"');
    expect(html).not.toMatch(/editTag\(/);
  });

  it('settings: says what deleting the account deletes, and asks for the password in the page', async () => {
    const html = await renderPage('settings');
    expect(html).toMatch(/links, bundles, pastes and files/);
    expect(html).toMatch(/team[^.]*stay/i);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*id="deletePassword"/);
    expect(html).not.toContain('All your URLs');
  });

  it('import: states the role\'s own limits; the format guide is folded away', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { user: { limits: { importsPerHour: 4, importBatchSize: 250 } } } }));
    configService.reload();
    try {
      const html = await renderPage('import');
      expect(html).toMatch(/4 imports per hour/);
      expect(html).toMatch(/250 links per import/);
      expect(html).toMatch(/<details[^>]*class="[^"]*import-guide/);
    } finally {
      fs.rmSync(paths.ROLES_PATH, { force: true });
      configService.reload();
    }
  });

  it('bio-settings: a save bar instead of a button at the top; link checkboxes without inline handlers', async () => {
    const html = await renderPage('bio-settings');
    expect(html).toMatch(/class="save-bar"/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*data-url-id="\d+"/);
  });
});

describe('public pages (v1.3 part 6a): no inline styling or handlers, the agreed layouts', () => {
  const PUBLIC_PAGES = ['index', 'url-info', 'paste-info', 'paste-view', 'file-download', 'bundle-launcher', 'unlock',
    'quarantine', 'scheduled', 'error', 'partials/report-modal'];
  const EMOJI = /\p{Extended_Pictographic}/u;

  it.each(PUBLIC_PAGES)('%s.ejs has no <style> blocks, style attributes (CSS variables aside), inline handlers or emoji', (name) => {
    const source = fs.readFileSync(path.join(VIEWS, `${name}.ejs`), 'utf8');
    expect(source).not.toMatch(/<style/);
    expect(source.match(/\sstyle="(?!--[a-z-]+:)[^"]*"/g)).toBeNull();
    expect(source).not.toMatch(/\son[a-z]+="/);
    expect(source).not.toMatch(EMOJI);
  });

  it.each(['url-info', 'paste-info', 'paste-view', 'file-download', 'bundle-launcher', 'unlock'])(
    '%s has no inline script code', async (name) => {
      const html = await renderPage(name);
      const inline = (html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/g) || [])
        .filter(script => !/theme|data-theme/.test(script));
      expect(inline).toEqual([]);
    });

  it('the status pages share one calm card (no pink .error-box)', async () => {
    for (const name of ['error', 'scheduled', 'quarantine', 'unlock']) {
      const html = await renderPage(name);
      expect(html).toContain('class="status-card');
      expect(html).not.toContain('error-box');
    }
  });

  it('url-info: the short link is the copyable heading; the destination\'s domain leads; "Continue to <domain>"', async () => {
    const html = await renderPage('url-info');
    expect(html).toMatch(/<h1[^>]*class="short-link"[^>]*>[^<]*localhost:8081\/s\/link/);
    expect(html).toMatch(/data-copy="http:\/\/localhost:8081\/s\/link"/);
    expect(html).toMatch(/class="destination-host"[^>]*>example\.com</);
    expect(html).toMatch(/Continue to example\.com/);
    expect(html).not.toMatch(/data-copy="https:\/\/example\.com/); // copying the destination would skip analytics and limits
  });

  it('url-info: a destination with quotes and backslashes stays text (no inline JavaScript)', async () => {
    getTestDatabase().prepare('UPDATE urls SET longUrl = ? WHERE id = ?').run("https://x.example/\\');alert(1)//", s.url.id);
    const html = await renderPage('url-info');
    expect(html).not.toMatch(/\son[a-z]+="/);
    expect(html).not.toMatch(/copyToClipboard\(/);
  });

  it('paste-info: same pattern, with "Open paste"', async () => {
    const html = await renderPage('paste-info');
    expect(html).toMatch(/<h1[^>]*class="short-link"[^>]*>[^<]*localhost:8081\/p\/notes/);
    expect(html).toMatch(/data-copy="http:\/\/localhost:8081\/p\/notes"/);
  });

  it('index: a visitor sees the site\'s name and tagline as the heading', async () => {
    configService.updateSettings({ 'branding.tagline': 'Links for the Snipz crew' });
    const { data } = await rendered(c('urlController').getCreateForm, request(null));
    const html = await ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...(await localsFor(null)), ...data });
    expect(html).toMatch(/<h1[^>]*class="hero-title"[^>]*>\s*Snipz\s*<\/h1>/);
    expect(html).toContain('Links for the Snipz crew');
    expect(html).not.toContain('Track Your Impact');
  });

  it('index: the default tagline is the neutral line; an emptied tagline shows none', async () => {
    const page = async () => {
      const { data } = await rendered(c('urlController').getCreateForm, request(null));
      return ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...(await localsFor(null)), ...data });
    };
    expect(await page()).toMatch(/class="hero-tagline"[^>]*>\s*Short links, pastes, files and bundles, with analytics\./);
    configService.updateSettings({ 'branding.tagline': '' });
    expect(await page()).not.toContain('hero-tagline');
  });

  it('error: a readable title, the code small', async () => {
    const html = await renderPage('error');
    expect(html).toMatch(/class="status-code"[^>]*>\s*Error 404/);
    expect(html).toMatch(/<h1[^>]*>\s*Page Not Found\s*<\/h1>/);
  });
});

describe('bio-page: icon names never reach JavaScript', () => {
  it('has no inline onerror handler (the icon fallback lives in public/js/bio-icons.js)', () => {
    const source = fs.readFileSync(path.join(VIEWS, 'bio-page.ejs'), 'utf8');
    expect(source).not.toMatch(/\sonerror=/);
    expect(source).toContain('/js/bio-icons.js');
  });
});

describe('public pages (v1.3 part 6b): auth, analytics, bio page', () => {
  const PAGES_6B = ['login', 'register', 'setup', 'analytics', 'bio-page', 'partials/analytics-summary'];
  const EMOJI = /\p{Extended_Pictographic}/u;

  it.each(PAGES_6B)('%s.ejs has no <style> blocks, style attributes (CSS variables aside), inline handlers or emoji', (name) => {
    const source = fs.readFileSync(path.join(VIEWS, `${name}.ejs`), 'utf8');
    expect(source).not.toMatch(/<style/);
    expect(source.match(/\sstyle="(?!--[a-z-]+:)[^"]*"/g)).toBeNull();
    expect(source).not.toMatch(/\son[a-z]+="/);
    expect(source).not.toMatch(EMOJI);
  });

  it.each(['login', 'register', 'setup', 'analytics', 'bio-page'])('%s has no inline script code (data goes as JSON)', async (name) => {
    const html = await renderPage(name);
    const inline = (html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/g) || [])
      .filter(script => !/theme|data-theme/.test(script));
    expect(inline).toEqual([]);
  });

  it('auth pages share one centered card with the brand', async () => {
    for (const name of ['login', 'register', 'setup']) {
      const html = await renderPage(name);
      expect(html).toContain('class="auth-card"');
    }
  });

  it('login: carries next in the form', async () => {
    const { data } = await rendered(c('authController').getLogin, request(null, { query: { next: '/f/doc' } }));
    const html = await ejs.renderFile(path.join(VIEWS, 'login.ejs'), { ...appLocals(), ...(await localsFor(null)), ...data });
    expect(html).toMatch(/<input type="hidden" name="next" value="\/f\/doc">/);
  });

  it('analytics: the overview stat cards and the data as JSON for public/js/analytics.js', async () => {
    const html = await renderPage('analytics');
    expect(html).toContain('class="stat-card"');
    expect(html).toMatch(/<script type="application\/json" id="analyticsData">/);
    expect(html).toContain('/js/analytics.js');
    expect(html).toContain('/vendor/chart.umd.js');
  });

  it('bio-page: a link shows its label, else its domain; never the bare short address', async () => {
    const data = bioPageData();
    data.urls = [
      { ...s.url, longUrl: 'https://www.youtube.com/@alice', label: 'My channel', tags: [] },
      { ...s.url, id: 999, slug: 'gh', longUrl: 'https://github.com/alice', label: null, tags: [] }
    ];
    const html = await ejs.renderFile(path.join(VIEWS, 'bio-page.ejs'), { ...appLocals(), ...(await localsFor(null)), ...data });
    expect(html).toMatch(/class="bio-link-title"[^>]*>\s*My channel/);
    expect(html).toMatch(/class="bio-link-title"[^>]*>\s*github\.com/);
    expect(html).not.toMatch(/>\s*http:\/\/localhost:8081\/s\/gh\s*</);
  });

  it('bio-page: "Powered by" once (the site footer)', async () => {
    const html = await renderPage('bio-page');
    expect(html.match(/Powered by/g)).toHaveLength(1);
  });
});

describe('bio-settings: link labels', () => {
  it('a ticked link has a label field with its label', async () => {
    const data = { ...bioSettingsData(), bioLabels: new Map([[s.url.id, 'My link']]) };
    const html = await ejs.renderFile(path.join(VIEWS, 'bio-settings.ejs'), { ...appLocals(), ...(await localsFor(s.user)), ...data });
    expect(html).toMatch(new RegExp(`<input[^>]*data-label-for="${s.url.id}"[^>]*value="My link"`));
  });
});
