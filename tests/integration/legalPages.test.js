const fs = require('fs');
const request = require('supertest');
const paths = require('../../config/paths');
const configService = require('../../services/configService');
const setupService = require('../../services/setupService');
const { createApp } = require('../../createApp');
const { createTestUser } = require('../setup/testHelpers');

// /privacy and /terms: written for the people who use and visit the instance, built from its live settings, so they
// never promise something the instance doesn't do. `legal.contact` is where abuse and privacy requests go.

const app = () => createApp({ sessionSecret: 'legal-pages-test-secret-'.padEnd(64, 'x') });

function setSettings(settings) {
  fs.writeFileSync(paths.SETTINGS_PATH, JSON.stringify(settings));
  configService.reload();
}

const get = async (address) => {
  const res = await request(app()).get(address);
  expect(res.status).toBe(200);
  return res.text;
};

beforeEach(async () => {
  setupService.reset();
  await createTestUser({ username: 'boss', isAdmin: 1 });
});
afterEach(() => {
  fs.rmSync(paths.SETTINGS_PATH, { force: true });
  configService.reload();
});

describe('/privacy', () => {
  it('is a public page named after the site', async () => {
    setSettings({ branding: { name: 'Acme Links' } });
    const html = await get('/privacy');
    expect(html).toMatch(/<title>Privacy · Acme Links<\/title>/);
    expect(html).toContain('site-header'); // the public shell
  });

  it('says visits are kept until the item is deleted when no retention is set', async () => {
    const html = await get('/privacy');
    expect(html).toContain('keyed hash of your IP address');
    expect(html).toMatch(/kept until the item is deleted/);
  });

  it('gives the analytics retention when it is set', async () => {
    setSettings({ retention: { analyticsDays: 45 } });
    expect(await get('/privacy')).toMatch(/deleted after 45 days/);
  });

  it('says no visits are recorded when analytics are off', async () => {
    setSettings({ features: { analytics: false } });
    const html = await get('/privacy');
    expect(html).toContain('No visits are recorded');
    expect(html).not.toContain('The visit is recorded'); // reports still keep a hash, so not the phrase itself
  });

  it('mentions countries only when geolocation is on', async () => {
    expect(await get('/privacy')).toMatch(/country/i);
    setSettings({ geo: { enabled: false } });
    expect(await get('/privacy')).not.toMatch(/country/i);
  });

  it('gives the audit log retention', async () => {
    setSettings({ retention: { auditLogDays: 60 } });
    expect(await get('/privacy')).toMatch(/60 days/);
  });

  it('names the icon servers only while bio pages are on', async () => {
    expect(await get('/privacy')).toContain('unpkg.com');
    setSettings({ features: { bioPages: false } });
    expect(await get('/privacy')).not.toContain('unpkg.com');
  });
});

describe('/terms', () => {
  it('lists what is not allowed and that content can be removed', async () => {
    const html = await get('/terms');
    expect(html).toMatch(/<title>Terms · LinkSnip<\/title>/);
    expect(html).toMatch(/phishing/i);
    expect(html).toMatch(/malware/i);
    expect(html).toMatch(/remove/i);
  });

  it('gives the expiry of content made without an account', async () => {
    setSettings({ anonymous: { urlExpirationDays: 7, pasteExpirationDays: 14 } });
    const html = await get('/terms');
    expect(html).toMatch(/links after 7 days/);
    expect(html).toMatch(/pastes after 14 days/);
  });

  it('points to the Report button only while reports are on', async () => {
    expect(await get('/terms')).toContain('Report');
    setSettings({ features: { reports: false } });
    expect(await get('/terms')).not.toMatch(/Report button/);
  });
});

describe('legal.contact', () => {
  it('an e-mail address becomes a mailto link on both pages', async () => {
    setSettings({ legal: { contact: 'abuse@example.com' } });
    for (const page of ['/privacy', '/terms']) {
      expect(await get(page)).toContain('<a href="mailto:abuse@example.com">abuse@example.com</a>');
    }
  });

  it('an https address becomes a link', async () => {
    setSettings({ legal: { contact: 'https://example.com/contact' } });
    expect(await get('/terms')).toContain('<a href="https://example.com/contact" rel="noopener">https://example.com/contact</a>');
  });

  it('anything else is shown as text, escaped, never a link', async () => {
    setSettings({ legal: { contact: 'javascript:alert(1) <b>' } });
    const html = await get('/terms');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('javascript:alert(1) &lt;b&gt;');
  });

  it('without one, the pages say to contact the administrator', async () => {
    expect(await get('/privacy')).toMatch(/administrator/);
  });
});

describe('everyone can read them', () => {
  it('on a private instance too', async () => {
    setSettings({ access: { loginRequired: true } });
    await get('/privacy');
    await get('/terms');
  });

  it('every footer links to them', async () => {
    const html = await get('/login');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it('the register page says that creating an account accepts the terms', async () => {
    expect(await get('/register')).toMatch(/agree to the <a href="\/terms">terms<\/a>/);
  });
});

describe('Admin → Settings', () => {
  it('legal.contact is a text field on the General tab', async () => {
    const agent = request.agent(app());
    await agent.post('/login').set('Sec-Fetch-Site', 'same-origin').type('form').send({ username: 'boss', password: 'password123' });
    const html = (await agent.get('/admin/settings')).text;
    expect(html).toMatch(/<input type="text"[^>]*data-key="legal\.contact"[^>]*data-type="string"/);
  });

  it('saves it', async () => {
    const agent = request.agent(app());
    await agent.post('/login').set('Sec-Fetch-Site', 'same-origin').type('form').send({ username: 'boss', password: 'password123' });
    const res = await agent.put('/api/admin/settings').set('Sec-Fetch-Site', 'same-origin').send({ 'legal.contact': 'abuse@example.com' });
    expect(res.body.success).toBe(true);
    expect(configService.get('legal.contact')).toBe('abuse@example.com');
  });
});
