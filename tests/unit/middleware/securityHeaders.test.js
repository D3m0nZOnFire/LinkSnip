const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { securityHeaders, allowBioIcons } = require('../../../middleware/securityHeaders');

const ROOT = path.join(__dirname, '../../..');

// The policy as { directive: [sources] }
function parseCsp(header) {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
  }));
}

function makeApp(...extra) {
  const app = express();
  app.use(securityHeaders);
  app.get('/page', ...extra, (req, res) => res.send('<p>ok</p>'));
  app.get('/download', (req, res) => {
    res.set('Content-Security-Policy', 'sandbox');
    res.send('file');
  });
  return app;
}

describe('securityHeaders', () => {
  let res;
  let csp;
  beforeAll(async () => {
    res = await request(makeApp()).get('/page');
    csp = parseCsp(res.headers['content-security-policy']);
  });

  it('loads everything from this site by default', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('runs only scripts served by LinkSnip: no inline code, no CDN, no eval', () => {
    expect(csp['script-src']).toEqual(["'self'"]);
  });

  it('allows style attributes (CSS variables in views) but only stylesheets from this site', () => {
    expect(csp['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('allows images from this site and data: URLs (QR codes)', () => {
    expect(csp['img-src']).toEqual(["'self'", 'data:']);
  });

  it('blocks plugins, <base> rewriting and framing by other sites', () => {
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
  });

  it('has no form-action: a password unlock posts here, then redirects to the destination site', () => {
    expect(csp['form-action']).toBeUndefined();
  });

  it('refuses framing in older browsers too', () => {
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('sends only the origin to other sites', () => {
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('stops content-type sniffing', () => {
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('lets a route replace the policy (file downloads are sandboxed)', async () => {
    const download = await request(makeApp()).get('/download');
    expect(download.headers['content-security-policy']).toBe('sandbox');
  });
});

describe('allowBioIcons (bio page and its settings)', () => {
  let csp;
  beforeAll(async () => {
    const res = await request(makeApp(allowBioIcons)).get('/page');
    csp = parseCsp(res.headers['content-security-policy']);
  });

  it('adds Ionicons scripts, pinned to the version the views load', () => {
    expect(csp['script-src']).toEqual(["'self'", 'https://unpkg.com/ionicons@7.1.0/']);
  });

  it('lets Ionicons fetch its SVGs and the settings page list Dashboard Icons', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://unpkg.com/ionicons@7.1.0/', 'https://api.github.com/repos/homarr-labs/dashboard-icons/']);
  });

  it('adds Dashboard Icons images', () => {
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/']);
  });

  it('keeps the rest of the policy', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
  });

  it('matches the Ionicons version in the views', () => {
    for (const view of ['bio-page', 'bio-settings']) {
      const source = fs.readFileSync(path.join(ROOT, 'views', `${view}.ejs`), 'utf8');
      const versions = [...source.matchAll(/https:\/\/unpkg\.com\/ionicons@([\d.]+)\//g)].map(m => m[1]);
      expect(versions.length).toBeGreaterThan(0);
      versions.forEach(version => expect(version).toBe('7.1.0'));
    }
  });

  it('is used by the bio page and the bio settings page only', () => {
    const router = require('../../../routes/bioPageRoutes');
    const withIcons = router.stack
      .filter(layer => layer.route && layer.route.stack.some(s => s.handle === allowBioIcons))
      .map(layer => layer.route.path)
      .sort();
    expect(withIcons).toEqual(['/bio/:username', '/bio/settings']);
  });
});

describe('app.js', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  it('does not announce Express (X-Powered-By)', () => {
    expect(source).toContain("app.disable('x-powered-by')");
  });

  it('sends the headers on every response, static files and the health check included', () => {
    const headers = source.indexOf('app.use(securityHeaders)');
    expect(headers).toBeGreaterThan(-1);
    expect(headers).toBeLessThan(source.indexOf("require('./routes/healthRoutes')"));
    expect(headers).toBeLessThan(source.indexOf('express.static'));
  });
});

describe('docker/Caddyfile', () => {
  it('turns on HSTS (only the HTTPS proxy can know the site is HTTPS-only)', () => {
    const caddyfile = fs.readFileSync(path.join(ROOT, 'docker/Caddyfile'), 'utf8');
    expect(caddyfile).toMatch(/header\s+Strict-Transport-Security\s+"max-age=31536000"/);
  });
});
