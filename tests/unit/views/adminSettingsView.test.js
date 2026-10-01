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
function renderPage() {
  const res = createMockResponse();
  AdminSettingsController.getSettingsPage(createMockRequest({ user: admin, session: {} }), res);
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

    const data = editorData(await renderPage());

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

    const html = await renderPage();

    expect(html).not.toContain('<script>alert(1)');
    expect(editorData(html).roles.find(r => r.name === 'user').label).toBe(label);
  });

  it('loads the editor and says how hand edits and the page interact', async () => {
    const html = await renderPage();

    expect(html).toContain('<script src="/js/rolesEditor.js"></script>');
    expect(html).toContain('id="rolesEditor"');
    expect(html).toMatch(/reload this page/i);
    expect(html).not.toMatch(/Read-only here/);
  });
});
