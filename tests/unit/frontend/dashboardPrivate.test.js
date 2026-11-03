/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "require"]}
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const DashboardController = require('../../../controllers/dashboardController');
const { createTestUser, createTestUrl, createTestBundle, createTestFile, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The dashboard's edit forms (views/dashboard.ejs + public/js/dashboard.js): links, bundles and files have the same
// Private checkbox; it shows the stored value and is sent back as isPrivate. Files no longer have a people list.

const VIEWS = path.join(__dirname, '../../../views');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../public/js/dashboard.js'), 'utf8');

let user;
let items;
beforeEach(async () => {
  const u = await createTestUser({ username: 'maker', role: 'trusted' });
  user = { id: u.id, username: 'maker', isAdmin: 0, role: 'trusted' };
  items = {
    url: createTestUrl({ slug: 'mylink', creatorId: user.id, isPrivate: 1 }),
    bundle: createTestBundle({ slug: 'mybundle', creatorId: user.id }),
    file: createTestFile(user.id, { slug: 'myfile', isPrivate: 1 })
  };
});

async function renderDashboard() {
  const req = createMockRequest({
    user, session: { userId: user.id }, protocol: 'http', query: {},
    get: (name) => (name.toLowerCase() === 'host' ? 'localhost:8081' : undefined), originalUrl: '/dashboard', path: '/dashboard'
  });
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  await DashboardController.getUserDashboard(req, res);
  const html = await ejs.renderFile(path.join(VIEWS, `${res._view}.ejs`), { ...appLocals(), ...res.locals, ...res._viewData });
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  Object.assign(global, {
    openModal: jest.fn(), closeModal: jest.fn(), showToast: jest.fn(), setButtonLoading: jest.fn(),
    formatDate: () => 'today', confirmAction: jest.fn()
  });
}

// Answers the edit form's GET with the stored item, and records the save
function answer(type) {
  const item = items[type];
  global.fetch = jest.fn(async (url, options = {}) => {
    if (!options.method) {
      const body = type === 'file' ? { success: true, file: { ...item, hasPassword: false, tags: [] } }
        : type === 'bundle' ? { ...item, items: [{ url: 'https://a.example' }, { url: 'https://b.example' }], tags: [] }
        : { ...item, tags: [] };
      return { ok: true, json: async () => body };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const $ = (id) => document.getElementById(id);

async function openEdit(type) {
  answer(type);
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
  document.querySelector(`.item-row[data-type="${type}"] [data-action="edit"]`).click();
  await tick();
}

async function save(formId) {
  $(formId).dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  const call = global.fetch.mock.calls.find(([, options]) => options && options.method);
  return JSON.parse(call[1].body);
}

it.each([
  ['url', 'editUrlPrivate', 'editUrlForm', true],
  ['bundle', 'editBundlePrivate', 'editBundleForm', false],
  ['file', 'editFilePrivate', 'editFileForm', true]
])('%s: the checkbox shows the stored value and is sent back', async (type, checkboxId, formId, stored) => {
  await renderDashboard();
  await openEdit(type);
  expect($(checkboxId).checked).toBe(stored);
  $(checkboxId).checked = !stored;
  const body = await save(formId);
  expect(body.isPrivate).toBe(stored ? '0' : '1');
});

it('the file form has no people list any more', async () => {
  await renderDashboard();
  expect($('editFileSharing')).toBeNull();
  expect($('editFileUsers')).toBeNull();
  await openEdit('file');
  const body = await save('editFileForm');
  expect(body).not.toHaveProperty('allowedUsers');
  expect(body).not.toHaveProperty('sharingMode');
});
