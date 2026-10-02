const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const UrlController = require('../../../controllers/urlController');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The create page (/): logged-in users get a plain "Create" page in the app shell; visitors keep the landing
// hero until the public pages are redone. Styles live in public/css/create.css, the script in public/js/create.js.

const VIEWS = path.join(__dirname, '../../../views');
const SOURCE = fs.readFileSync(path.join(VIEWS, 'index.ejs'), 'utf8');

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

async function render(user) {
  const req = createMockRequest({
    user, session: user ? { userId: user.id } : {}, query: {}, protocol: 'http',
    get: () => 'localhost', originalUrl: '/', path: '/'
  });
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  UrlController.getCreateForm(req, res);
  return ejs.renderFile(path.join(VIEWS, 'index.ejs'), { views: [VIEWS], ...appLocals(), ...res.locals, ...res._viewData });
}

async function member(role = null, extra = {}) {
  const row = await createTestUser({ username: 'alice', role, ...extra });
  return { id: row.id, username: 'alice', role, isAdmin: extra.isAdmin || 0 };
}

describe('logged in', () => {
  it('is a plain Create page: no landing hero, no feature cards', async () => {
    const html = await render(await member());
    expect(html).toMatch(/<h2[^>]*>Create<\/h2>/);
    expect(html).not.toContain('class="hero"');
    expect(html).not.toContain('class="features"');
    expect(html).not.toContain('Track Your Impact');
  });

  it('states the role\'s own link limit per hour', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { user: { limits: { urlsPerHour: 42 } } } }));
    configService.reload();
    const html = await render(await member());
    expect(html).toMatch(/42 links per hour/);
    expect(html).not.toMatch(/100 URLs per hour/);
  });

  it('says nothing about a limit when there is none', async () => {
    const html = await render(await member(null, { isAdmin: 1 }));
    expect(html).not.toMatch(/per hour/);
  });

  it('locks the paste and file options the role lacks', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { trusted: { permissions: { passwordProtection: false, scheduling: false } } } }));
    configService.reload();
    const html = await render(await member('trusted'));
    for (const id of ['pchip-password', 'pchip-schedule', 'fchip-password', 'fchip-schedule']) {
      expect(html).toMatch(new RegExp(`<button[^>]*id="${id}"[^>]*disabled`));
    }
    expect(html).not.toMatch(/<button[^>]*id="pchip-tags"[^>]*disabled/);
  });
});

describe('visitors', () => {
  it('keep the landing hero for now', async () => {
    const html = await render(null);
    expect(html).toContain('class="hero"');
  });

  it('see their own limit', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { anonymous: { limits: { urlsPerHour: 7 } } } }));
    configService.reload();
    expect(await render(null)).toMatch(/7 links per hour/);
  });
});

describe('the template', () => {
  it('has no <style> block, inline handlers or inline style attributes', () => {
    expect(SOURCE).not.toMatch(/<style/);
    expect(SOURCE).not.toMatch(/\son[a-z]+="/);
    expect(SOURCE).not.toMatch(/\sstyle="/);
  });

  it('loads its stylesheet and script instead of inline code', async () => {
    const html = await render(await member());
    expect(html).toContain('href="/css/create.css"');
    expect(html).toContain('<script src="/js/create.js"></script>');
    const inline = html.match(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>[\s\S]*?<\/script>/g) || [];
    // Only partials' small scripts remain (e.g. the theme bootstrap); none of the create page's own code
    expect(inline.join('')).not.toMatch(/setMode|submitPaste|TagSelector/);
  });
});
