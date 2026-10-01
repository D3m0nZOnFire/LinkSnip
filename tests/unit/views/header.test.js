const path = require('path');
const ejs = require('ejs');

const HEADER = path.join(__dirname, '../../../views/partials/header.ejs');
const render = (locals) => ejs.renderFile(HEADER, { currentPage: 'home', ...locals });

describe('header navigation on small screens', () => {
  it('has a menu button that controls the nav', async () => {
    const html = await render({ user: { id: 1, username: 'u' } });

    const button = html.match(/<button[^>]*class="[^"]*nav-toggle[^"]*"[^>]*>/);
    expect(button).not.toBeNull();
    expect(button[0]).toMatch(/aria-controls="site-nav"/);
    expect(button[0]).toMatch(/aria-expanded="false"/);
    expect(button[0]).toMatch(/aria-label="[^"]+"/);
    expect(html).toMatch(/<nav[^>]*id="site-nav"/);
  });

  it('loads the menu script', async () => {
    const html = await render({ user: null });
    expect(html).toContain('<script src="/js/nav.js" defer></script>');
  });

  it('keeps the menu button for visitors too', async () => {
    const html = await render({ user: null });
    expect(html).toMatch(/class="[^"]*nav-toggle/);
  });
});

describe('header branding', () => {
  const BRAND = { name: 'Snipz', tagline: '', logoUrl: '/branding/logo?v=7', faviconUrl: '/logo.png', themeUrl: '/theme.css' };

  it("shows the site's name and logo, linking home", async () => {
    const html = await render({ user: null, branding: BRAND });
    expect(html).toMatch(/<a href="\/" class="brand"[^>]*>/);
    expect(html).toContain('<img src="/branding/logo?v=7" alt="" class="brand-logo">');
    expect(html).toMatch(/<span class="brand-name">Snipz<\/span>/);
    expect(html).not.toContain('LinkSnip');
  });

  it('falls back to LinkSnip when rendered without branding locals', async () => {
    const html = await render({ user: null });
    expect(html).toMatch(/<span class="brand-name">LinkSnip<\/span>/);
    expect(html).toContain('<img src="/logo.png" alt="" class="brand-logo">');
  });

  it('lists Appearance in the admin menu', async () => {
    const html = await render({ user: { id: 1, username: 'boss', isAdmin: 1 }, currentPage: 'admin-appearance' });
    expect(html).toMatch(/<a href="\/admin\/appearance" class="active">Appearance<\/a>/);
  });
});
