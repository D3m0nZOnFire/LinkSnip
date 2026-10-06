const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '../../../views');
const HEAD = path.join(VIEWS, 'partials/head.ejs');
const render = (locals = {}) => ejs.renderFile(HEAD, locals);
const pages = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs'));
const BRAND = { name: 'Snipz', tagline: 'Tiny <links>.', logoUrl: '/branding/logo?v=1', faviconUrl: '/branding/favicon?v=1', themeUrl: '/theme.css' };

describe('partials/head', () => {
  it('names the page, then the site', async () => {
    expect(await render({ title: 'Dashboard' })).toContain('<title>Dashboard · LinkSnip</title>');
  });

  it('uses the site name alone when the page has no title', async () => {
    expect(await render()).toContain('<title>LinkSnip</title>');
  });

  it('escapes the title (paste titles and file names are user input)', async () => {
    const html = await render({ title: '<script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sets the charset, viewport and favicon', async () => {
    const html = await render();
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(html).toMatch(/<link rel="icon" href="\/logo.png">/);
  });

  it('loads the tokens, then the palette colors, then main.css and the page styles in the given order', async () => {
    const html = await render({ styles: ['tables', 'forms'], branding: { ...BRAND, themeUrl: '/theme.css?v=abc' } });
    const order = ['href="/css/tokens.css"', 'href="/theme.css?v=abc"', 'href="/css/main.css"',
      'href="/css/tables.css"', 'href="/css/forms.css"'].map(tag => html.indexOf(tag));
    order.forEach(i => expect(i).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('still loads the palette colors when rendered without branding locals', async () => {
    expect(await render()).toContain('<link rel="stylesheet" href="/theme.css">');
  });

  it("uses the site's name and favicon from Admin → Appearance", async () => {
    const html = await render({ title: 'Dashboard', branding: BRAND });
    expect(html).toContain('<title>Dashboard · Snipz</title>');
    expect(html).toMatch(/<link rel="icon" href="\/branding\/favicon\?v=1">/);
  });

  it('describes the site for search engines and link previews', async () => {
    const html = await render({ title: 'Dashboard', branding: BRAND });
    expect(html).toContain('<meta name="description" content="Tiny &lt;links&gt;.">');
    expect(html).toContain('<meta property="og:site_name" content="Snipz">');
    expect(html).toContain('<meta property="og:title" content="Dashboard · Snipz">');
    expect(html).toContain('<meta property="og:description" content="Tiny &lt;links&gt;.">');
  });

  it('leaves the description out when there is no tagline', async () => {
    const html = await render({ branding: { ...BRAND, tagline: '' } });
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain('og:description');
  });

  describe('chat previews of a shared item (share: { description, url } from services/sharePreview)', () => {
    const share = { description: 'Paste · 12 lines · <b>md</b>', url: 'https://lnksnp.ch/p/notes' };

    it("describes the item instead of the site, with its address", async () => {
      const html = await render({ title: 'Parts list', branding: BRAND, share });
      expect(html).toContain('<meta property="og:title" content="Parts list · Snipz">');
      expect(html).toContain('<meta property="og:description" content="Paste · 12 lines · &lt;b&gt;md&lt;/b&gt;">');
      expect(html).toContain('<meta name="description" content="Paste · 12 lines · &lt;b&gt;md&lt;/b&gt;">');
      expect(html).toContain('<meta property="og:url" content="https://lnksnp.ch/p/notes">');
      expect(html).not.toContain('Tiny &lt;links&gt;.');
    });

    it('says it is a web page and asks for a card without a picture', async () => {
      const html = await render({ branding: BRAND, share });
      expect(html).toContain('<meta property="og:type" content="website">');
      expect(html).toContain('<meta name="twitter:card" content="summary">');
    });

    it('pages without share keep the generic site preview and no address', async () => {
      const html = await render({ title: 'Dashboard', branding: BRAND });
      expect(html).toContain('<meta property="og:description" content="Tiny &lt;links&gt;.">');
      expect(html).not.toContain('og:url');
    });

    it('never names a preview image (chat apps would show it big; a text card is the goal)', async () => {
      for (const locals of [{}, { branding: BRAND }, { branding: BRAND, share }]) {
        expect(await render(locals)).not.toMatch(/og:image|twitter:image/);
      }
    });
  });

  it('preloads the Geist font served by the app itself', async () => {
    const html = await render();
    expect(html).toMatch(/<link rel="preload" href="\/fonts\/Geist-Variable.woff2" as="font" type="font\/woff2" crossorigin>/);
  });

  it('runs the theme script in the head, so the page never flashes the wrong theme', async () => {
    expect(await render()).toContain('<script src="/js/theme.js"></script>');
  });

  it('can keep a page out of search engines', async () => {
    expect(await render()).not.toContain('noindex');
    expect(await render({ noindex: true })).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('loads no stylesheet from another server', async () => {
    const html = await render({ styles: ['tables'] });
    for (const [, href] of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)) {
      expect(href.startsWith('/')).toBe(true);
    }
  });
});

describe('every page uses partials/head', () => {
  it.each(pages)('%s includes it inside <head>', (page) => {
    const html = fs.readFileSync(path.join(VIEWS, page), 'utf8');
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
    expect(head).toContain("include('partials/head'");
  });

  // The partial owns these; a page repeating them would load them twice or in the wrong order
  it.each(pages)('%s leaves the shared tags to the partial', (page) => {
    const html = fs.readFileSync(path.join(VIEWS, page), 'utf8');
    expect(html).not.toMatch(/<meta charset/i);
    expect(html).not.toMatch(/<meta name="viewport"/);
    expect(html).not.toMatch(/<title>/);
    expect(html).not.toMatch(/rel="icon"/);
    expect(html).not.toMatch(/href="\/css\/(tokens|main)\.css"/);
    expect(html).not.toContain('src="/js/theme.js"');
  });
});
