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
