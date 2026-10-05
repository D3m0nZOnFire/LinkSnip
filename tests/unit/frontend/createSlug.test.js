/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const paths = require('../../../config/paths');
const configService = require('../../../services/configService');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const UrlController = require('../../../controllers/urlController');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The create page (views/index.ejs + public/js/create.js): every mode has a "Short link" field with its own prefix,
// and sends what is typed there as the slug.

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

describe('with customSlugs', () => {
  let user;
  beforeEach(async () => { user = await trusted(); });

  it('every mode has a Short link field with its prefix and the host', async () => {
    await renderCreatePage(user);
    const PREFIX = { customSlug: '/s/', pasteSlug: '/p/', bundleSlug: '/b/', fileSlug: '/f/' };
    for (const [id, prefix] of Object.entries(PREFIX)) {
      const field = $(id);
      expect(field).not.toBeNull();
      expect(field.disabled).toBe(false);
      const wrapper = field.closest('.creator-slug');
      expect(wrapper.querySelector('.creator-slug-prefix').textContent).toBe(`${window.location.host}${prefix}`);
    }
  });

  it('links post the slug with the form (customSlug)', async () => {
    await renderCreatePage(user);
    expect($('customSlug').name).toBe('customSlug');
    expect($('customSlug').form).toBe($('creatorForm'));
  });

  it('a paste sends its slug', async () => {
    await renderCreatePage(user);
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    type($('pasteSlug'), 'my-notes');
    submit();
    expect(global.fetch).toHaveBeenCalledWith('/api/pastes', expect.anything());
    expect(sentBody().slug).toBe('my-notes');
  });

  it('a bundle sends its slug', async () => {
    await renderCreatePage(user);
    $('pillBundle').click();
    type($('bundleTitleInput'), 'Kit');
    document.querySelectorAll('.bundle-row-url').forEach((input, i) => type(input, `https://${i}.example`));
    type($('bundleSlug'), 'kit');
    submit();
    expect(global.fetch).toHaveBeenCalledWith('/api/bundles', expect.anything());
    expect(sentBody().slug).toBe('kit');
  });

  it('a file sends its slug', async () => {
    const sent = [];
    global.XMLHttpRequest = jest.fn(() => ({
      upload: { addEventListener: () => {} }, addEventListener: () => {}, open: () => {}, send: (data) => sent.push(data)
    }));
    await renderCreatePage(user);
    $('pillFile').click();
    Object.defineProperty($('fileInput'), 'files', { value: [new File(['x'], 'a.txt')] });
    type($('fileSlug'), 'report');
    submit();
    expect(sent[0].get('slug')).toBe('report');
  });

  it('no slug typed: none is sent', async () => {
    await renderCreatePage(user);
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    submit();
    expect(sentBody().slug).toBeUndefined();
  });

  it('shows the format error under the field being typed in', async () => {
    await renderCreatePage(user);
    type($('pasteSlug'), 'no spaces');
    expect($('pasteSlugError').hidden).toBe(false);
    expect($('customSlugError').hidden).toBe(true);
    type($('pasteSlug'), 'fine');
    expect($('pasteSlugError').hidden).toBe(true);
  });
});

describe('without customSlugs', () => {
  it('the fields show, disabled, and nothing is sent', async () => {
    fs.writeFileSync(paths.ROLES_PATH, JSON.stringify({ roles: { trusted: { permissions: { customSlugs: false } } } }));
    configService.reload();
    await renderCreatePage(await trusted());
    for (const id of ['customSlug', 'pasteSlug', 'bundleSlug', 'fileSlug']) expect($(id).disabled).toBe(true);
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    submit();
    expect(sentBody().slug).toBeUndefined();
  });

  it('visitors (anonymous role, off by default) get a disabled link slug field', async () => {
    await renderCreatePage(null);
    expect($('customSlug').disabled).toBe(true);
  });
});
