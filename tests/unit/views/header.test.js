const path = require('path');
const ejs = require('ejs');

const PARTIALS = path.join(__dirname, '../../../views/partials');
const renderPartial = (name, locals) => ejs.renderFile(path.join(PARTIALS, `${name}.ejs`), locals);

const ALL = new Proxy({}, { get: () => true });
const NONE = new Proxy({}, { get: () => false });
const BRAND = { name: 'Snipz', tagline: '', logoUrl: '/branding/logo?v=7', faviconUrl: '/logo.png', themeUrl: '/theme.css' };
const user = { id: 1, username: 'alice', isAdmin: 0 };
const admin = { id: 2, username: 'boss', isAdmin: 1 };

const sidebar = (locals) => renderPartial('sidebar', { currentPage: 'dashboard', can: ALL, features: ALL, branding: BRAND, ...locals });
const header = (locals) => renderPartial('header', { currentPage: 'info', registrationOpen: true, branding: BRAND, ...locals });
const linkTo = (html, href) => new RegExp(`<a[^>]*href="${href.replace(/[/?]/g, '\\$&')}"`).test(html);

describe('partials/sidebar (logged-in pages)', () => {
  it("shows the site's name and logo, linking home", async () => {
    const html = await sidebar({ user });
    expect(html).toContain('<img src="/branding/logo?v=7" alt="" class="brand-logo">');
    expect(html).toMatch(/<span class="brand-name">Snipz<\/span>/);
  });

  it('leads with Create (the home page) and Dashboard', async () => {
    const html = await sidebar({ user });
    expect(html).toMatch(/<a href="\/" class="sidebar-create[^"]*"/);
    expect(linkTo(html, '/dashboard')).toBe(true);
  });

  it('lists only what the role and the features allow', async () => {
    const all = await sidebar({ user });
    for (const href of ['/tags', '/teams', '/bio/settings', '/import']) expect(linkTo(all, href)).toBe(true);

    const none = await sidebar({ user, can: NONE, features: NONE });
    for (const href of ['/tags', '/teams', '/bio/settings', '/import']) expect(linkTo(none, href)).toBe(false);
  });

  it('marks the current page', async () => {
    const html = await sidebar({ user, currentPage: 'tags' });
    expect(html).toMatch(/<a href="\/tags" class="sidebar-link" aria-current="page">/);
    expect(html).not.toMatch(/<a href="\/dashboard"[^>]*aria-current/);
  });

  it('marks Create on the home page', async () => {
    expect(await sidebar({ user, currentPage: 'home' })).toMatch(/<a href="\/" class="sidebar-create[^"]*" aria-current="page">/);
  });

  it('shows the admin pages to admins only, opened on an admin page', async () => {
    expect(await sidebar({ user })).not.toContain('/admin');

    const closed = await sidebar({ user: admin });
    expect(closed).toMatch(/<details class="sidebar-group">/);
    for (const href of ['/admin', '/admin/users', '/admin/settings', '/admin/appearance', '/admin/audit-logs']) {
      expect(linkTo(closed, href)).toBe(true);
    }
    const open = await sidebar({ user: admin, currentPage: 'admin-users' });
    expect(open).toMatch(/<details class="sidebar-group" open>/);
    expect(open).toMatch(/<a href="\/admin\/users" class="sidebar-link" aria-current="page">/);
  });

  it('hides admin pages of switched-off features', async () => {
    const html = await sidebar({ user: admin, features: NONE });
    for (const href of ['/admin/files', '/admin/pastes', '/admin/reports', '/admin/teams', '/admin/analytics-shares']) {
      expect(linkTo(html, href)).toBe(false);
    }
  });

  it('has the user menu at the bottom: Settings, theme, Log out', async () => {
    const html = await sidebar({ user });
    expect(html).toMatch(/<button[^>]*class="user-button"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(html).toContain('alice');
    expect(linkTo(html, '/settings')).toBe(true);
    expect(html).toMatch(/<button[^>]*data-theme-toggle/);
    expect(linkTo(html, '/logout')).toBe(true);
  });

  it('says when the account is an admin', async () => {
    expect(await sidebar({ user: admin })).toMatch(/class="user-role">Admin</);
  });

  it('can be opened as a drawer on small screens', async () => {
    const html = await sidebar({ user });
    expect(html).toMatch(/<aside class="sidebar" id="sidebar"/);
  });
});

describe('partials/topbar (small screens)', () => {
  it('has a menu button that opens the sidebar', async () => {
    const html = await renderPartial('topbar', { branding: BRAND });
    expect(html).toMatch(/<button[^>]*data-sidebar-toggle[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"[^>]*aria-label="Open menu"/);
    expect(html).toMatch(/<span class="brand-name">Snipz<\/span>/);
  });
});

describe('partials/header (public pages)', () => {
  it('offers visitors Log in and Register', async () => {
    const html = await header({ user: null });
    expect(linkTo(html, '/login')).toBe(true);
    expect(linkTo(html, '/register')).toBe(true);
    expect(html).toMatch(/<button[^>]*data-theme-toggle/);
  });

  it('leaves Register out while registration is closed', async () => {
    expect(linkTo(await header({ user: null, registrationOpen: false }), '/register')).toBe(false);
  });

  it('gives logged-in people the way back to the app and their menu', async () => {
    const html = await header({ user });
    expect(linkTo(html, '/dashboard')).toBe(true);
    expect(html).toMatch(/class="user-button"/);
    expect(linkTo(html, '/login')).toBe(false);
  });

  it("shows the site's name", async () => {
    expect(await header({ user: null })).toMatch(/<span class="brand-name">Snipz<\/span>/);
  });

  it('falls back to LinkSnip when rendered without branding locals', async () => {
    const html = await header({ user: null, branding: undefined });
    expect(html).toMatch(/<span class="brand-name">LinkSnip<\/span>/);
  });

  it('loads the shell script', async () => {
    expect(await header({ user: null })).toContain('<script src="/js/shell.js" defer></script>');
    expect(await sidebar({ user })).toContain('<script src="/js/shell.js" defer></script>');
  });
});
