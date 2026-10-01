const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '../../../views');
const pages = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs'));
const renderFooter = (locals = {}) => ejs.renderFile(path.join(VIEWS, 'partials/footer.ejs'), locals);

describe('footer', () => {
  it.each(pages)('%s includes the footer partial before </body>', (page) => {
    const html = fs.readFileSync(path.join(VIEWS, page), 'utf8');
    const include = html.indexOf("include('partials/footer')");
    expect(include).toBeGreaterThan(-1);
    expect(include).toBeLessThan(html.lastIndexOf('</body>'));
  });

  it('credits the author with a link to their GitHub profile', async () => {
    const html = await renderFooter();
    expect(html).toContain('Made by');
    expect(html).toContain('href="https://github.com/D3m0nZOnFire"');
    expect(html).toContain('D3m0nZOnFire');
  });

  it('says which LinkSnip version runs the site, linking to the project', async () => {
    const html = await renderFooter({ appVersion: '1.3.0' });
    expect(html).toContain('Powered by');
    expect(html).toMatch(/<a href="https:\/\/github.com\/D3m0nZOnFire\/LinkSnip"[^>]*>LinkSnip<\/a>/);
    expect(html).toContain('v1.3.0');
  });

  it('leaves the version out rather than printing "vundefined"', async () => {
    const html = await renderFooter();
    expect(html).toContain('Powered by');
    expect(html).not.toContain('vundefined');
  });
});

// The footer sits at the bottom of the window on short pages: <body> is a column that
// fills the window, `.page` takes the free space, the footer comes after it
describe('sticky footer layout (main.css)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../public/css/main.css'), 'utf8');
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (css.match(new RegExp(`(^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`)) || [])[2] || '';
  };

  it('makes <body> a column at least as tall as the window', () => {
    expect(rule('body')).toMatch(/display:\s*flex/);
    expect(rule('body')).toMatch(/flex-direction:\s*column/);
    expect(rule('body')).toMatch(/min-height:\s*100dvh/);
  });

  it('lets .page grow into the free space', () => {
    expect(rule('.page')).toMatch(/flex:\s*1 0 auto/);
  });

  it('has no full-window boxes left that push the footer below the fold', () => {
    expect(css).not.toMatch(/min-height:\s*100vh/);
  });
});
