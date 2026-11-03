/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "require"]}
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const UrlController = require('../../../controllers/urlController');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The create page (views/index.ejs + public/js/create.js): every mode has a Public / Private toggle for logged-in
// users, and sends isPrivate when it is on.

const VIEWS = path.join(__dirname, '../../../views');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../public/js/create.js'), 'utf8');

afterEach(() => {
  fs.rmSync(paths.ROLES_PATH, { force: true });
  configService.reload();
});

async function renderCreatePage(user) {
  const req = createMockRequest({
    user, session: user ? { userId: user.id } : {}, protocol: 'http', query: {},
    get: (name) => (name.toLowerCase() === 'host' ? 'localhost:8081' : undefined), originalUrl: '/', path: '/'
  });
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  await UrlController.getCreateForm(req, res);
  const html = await ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...res.locals, ...res._viewData });
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  Element.prototype.scrollIntoView = () => {}; // not in jsdom
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, pasteUrl: 'x', bundleUrl: 'x' }) });
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
}

async function trusted() {
  const u = await createTestUser({ username: 'maker', role: 'trusted' });
  return { id: u.id, username: 'maker', isAdmin: 0, role: 'trusted' };
}

const $ = (id) => document.getElementById(id);
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = () => $('creatorForm').dispatchEvent(new Event('submit', { cancelable: true }));
const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

const toggleIn = (mode) => document.querySelector(`[data-section="${mode}"] [data-private-toggle]`);

describe('logged in', () => {
  let user;
  beforeEach(async () => { user = await trusted(); });

  it.each(['url', 'paste', 'bundle', 'file'])('%s: a toggle that reads Public, then Private', async (mode) => {
    await renderCreatePage(user);
    const toggle = toggleIn(mode);
    expect(toggle).not.toBeNull();
    expect(toggle.textContent.trim()).toBe('Public');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    toggle.click();
    expect(toggle.textContent.trim()).toBe('Private');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.classList.contains('chip-set')).toBe(true);
    toggle.click();
    expect(toggle.textContent.trim()).toBe('Public');
  });

  it('links post isPrivate with the form', async () => {
    await renderCreatePage(user);
    const input = $('creatorForm').elements.isPrivate;
    expect(input).toBeTruthy();
    expect(input.value).toBe('');
    toggleIn('url').click();
    expect(input.value).toBe('1');
  });

  it('a paste sends isPrivate only when it is on', async () => {
    await renderCreatePage(user);
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    submit();
    expect(sentBody()).not.toHaveProperty('isPrivate');
    global.fetch.mockClear();
    type($('pasteContent'), 'hello');
    toggleIn('paste').click();
    submit();
    expect(sentBody().isPrivate).toBe('1');
  });

  it('a bundle sends isPrivate', async () => {
    await renderCreatePage(user);
    $('pillBundle').click();
    type($('bundleTitleInput'), 'Kit');
    document.querySelectorAll('.bundle-row-url').forEach((input, i) => { input.value = `https://${i}.example`; });
    toggleIn('bundle').click();
    submit();
    expect(sentBody().isPrivate).toBe('1');
  });

  it('a file sends isPrivate, and no sharing list', async () => {
    let sent;
    global.XMLHttpRequest = class {
      constructor() { this.upload = { addEventListener: () => {} }; }
      addEventListener() {}
      open() {}
      send(data) { sent = data; }
    };
    await renderCreatePage(user);
    $('pillFile').click();
    Object.defineProperty($('fileInput'), 'files', { value: [new File(['x'], 'a.txt')] });
    toggleIn('file').click();
    submit();
    expect(sent.get('isPrivate')).toBe('1');
    expect(sent.has('allowedUsers')).toBe(false);
    expect(sent.has('sharingMode')).toBe(false);
  });

  it('the toggle goes back to Public after creating', async () => {
    await renderCreatePage(user);
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    toggleIn('paste').click();
    submit();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toggleIn('paste').textContent.trim()).toBe('Public');
    expect(toggleIn('paste').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('a visitor', () => {
  it('gets no Private toggle (an item without an owner cannot be private)', async () => {
    await renderCreatePage(null);
    expect(document.querySelectorAll('[data-private-toggle]')).toHaveLength(0);
    expect($('creatorForm').elements.isPrivate).toBeUndefined();
  });
});
