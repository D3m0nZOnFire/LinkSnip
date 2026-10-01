const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const AdminSettingsController = require('../../../controllers/adminSettingsController');
const { createMockRequest, createMockResponse } = require('../../setup/testHelpers');

const VIEW = path.join(__dirname, '../../../views/admin-settings.ejs');
const admin = { id: 1, username: 'boss', isAdmin: 1 };

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

// Render the page with exactly what the controller passes it
function renderPage(tab) {
  const res = createMockResponse();
  AdminSettingsController.getSettingsPage(createMockRequest({ user: admin, session: {}, params: tab ? { tab } : {} }), res);
  return ejs.renderFile(VIEW, res._viewData);
}

function editorData(html) {
  const match = html.match(/<script type="application\/json" id="rolesData">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

describe('views/admin-settings.ejs roles editor', () => {
  it('embeds every role with its permissions, limits, account count and the file version', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { marketing: { label: 'Marketing', limits: { urlsPerHour: null } } } }));
    configService.reload();

    const data = editorData(await renderPage('roles'));

    expect(data.version).toBe(configService.rolesVersion());
    expect(data.defaultRole).toBe('user');
    expect(data.roles.map(r => r.name)).toEqual(['anonymous', 'user', 'trusted', 'unlimited', 'marketing']);
    const marketing = data.roles.find(r => r.name === 'marketing');
    expect(marketing).toEqual(expect.objectContaining({ label: 'Marketing', builtIn: false, users: 0 }));
    expect(marketing.permissions).toEqual(configService.getRoles().roles.marketing.permissions);
    expect(marketing.limits.urlsPerHour).toBeNull();
    expect(data.permissions[0]).toEqual({ name: 'createUrls', description: expect.any(String) });
    expect(data.limits.map(l => l.name)).toContain('storageQuotaMB');
  });

  it('keeps a hostile label inside the data block', async () => {
    const label = '</script><script>alert(1)</script>';
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { user: { label } } }));
    configService.reload();

    const html = await renderPage('roles');

    expect(html).not.toContain('<script>alert(1)');
    expect(editorData(html).roles.find(r => r.name === 'user').label).toBe(label);
  });

  it('loads the editor and says how hand edits and the page interact', async () => {
    const html = await renderPage('roles');

    expect(html).toContain('<script src="/js/rolesEditor.js"></script>');
    expect(html).toContain('id="rolesEditor"');
    expect(html).toMatch(/reload this page/i);
    expect(html).not.toMatch(/Read-only here/);
  });
});

describe('views/admin-settings.ejs branding section', () => {
  it('points to Admin → Appearance instead of editing the branding keys here', async () => {
    const html = await renderPage();
    expect(html).toMatch(/<a href="\/admin\/appearance"[^>]*>/);
    expect(html).not.toMatch(/data-key="branding\./);
  });

  it('still shows the branding keys and their values, for people editing settings.json by hand', async () => {
    const html = await renderPage();
    expect(html).toContain('<code>branding.darkPalette</code>');
    expect(html).toContain('linksnip-dark');
  });
});

describe('views/admin-settings.ejs tabs', () => {
  it('shows a tab bar with the current tab marked', async () => {
    const html = await renderPage('features');
    expect(html).toMatch(/<nav class="tabs"[^>]*>/);
    expect(html).toMatch(/<a href="\/admin\/settings\/features" class="tab" aria-current="page">Features<\/a>/);
    expect(html).toMatch(/<a href="\/admin\/settings" class="tab">General<\/a>/);
  });

  it("shows only the tab's settings", async () => {
    const general = await renderPage();
    expect(general).toContain('data-key="registration.open"');
    expect(general).not.toContain('data-key="features.pastes"');

    const features = await renderPage('features');
    expect(features).toContain('data-key="features.pastes"');
    expect(features).not.toContain('data-key="registration.open"');
  });

  it('has the roles editor on its own tab, without the settings form', async () => {
    expect(await renderPage()).not.toContain('id="rolesData"');
    const roles = await renderPage('roles');
    expect(roles).toContain('id="rolesData"');
    expect(roles).not.toContain('id="settingsForm"');
  });
});
