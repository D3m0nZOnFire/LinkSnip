/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const { viewLocals, appLocals, brandingLocals } = require('../../../middleware/viewLocals');
const UrlController = require('../../../controllers/urlController');
const { createTestUser, createMockRequest, createMockResponse } = require('../../setup/testHelpers');

// The create page's success box has an Open button next to Copy: a link opens its info page, a paste, bundle or
// file its own page (the address that is copied). Always in a new tab.

const VIEWS = path.join(__dirname, '../../../views');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../../../public/js/create.js'), 'utf8');

function mockRequest(user, extra = {}) {
  return createMockRequest({
    user, session: user ? { userId: user.id } : {}, protocol: 'http', query: {},
    get: (name) => (name.toLowerCase() === 'host' ? 'localhost:8081' : undefined), originalUrl: '/', path: '/',
    ...extra
  });
}

async function render(handler, req) {
  const res = createMockResponse();
  brandingLocals(req, res, () => {});
  viewLocals(req, res, () => {});
  await handler(req, res);
  const html = await ejs.renderFile(path.join(VIEWS, 'index.ejs'), { ...appLocals(), ...res.locals, ...res._viewData });
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>\s*$/, '');
  Element.prototype.scrollIntoView = () => {}; // not in jsdom
  // eslint-disable-next-line no-new-func
  new Function(SCRIPT)();
  return res;
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
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function expectOpenButton(href) {
  const open = $('creatorOpen');
  expect(open).not.toBeNull();
  expect(open.tagName).toBe('A');
  expect(open.getAttribute('href')).toBe(href);
  expect(open.getAttribute('target')).toBe('_blank');
  expect(open.getAttribute('rel')).toBe('noopener');
  expect(open.textContent).toContain('Open');
}

describe('Open button after creating', () => {
  let user;
  beforeEach(async () => { user = await trusted(); });

  it('a link opens its info page', async () => {
    const req = mockRequest(user, { method: 'POST', body: { longUrl: 'https://example.com', customSlug: 'docs' } });
    const res = await render(UrlController.createShortUrl, req);
    expect(res._viewData.success.openUrl).toBe('http://localhost:8081/info/docs');
    expect($('creatorSuccess').hidden).toBe(false);
    expect($('creatorSuccessUrl').textContent).toBe('http://localhost:8081/s/docs');
    expectOpenButton('http://localhost:8081/info/docs');
  });

  it('a paste opens its page', async () => {
    await render(UrlController.getCreateForm, mockRequest(user));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, pasteUrl: 'http://localhost:8081/p/notes' })
    });
    $('pillPaste').click();
    type($('pasteContent'), 'hello');
    submit();
    await flush();
    expect($('creatorSuccess').hidden).toBe(false);
    expectOpenButton('http://localhost:8081/p/notes');
  });

  it('a bundle opens its page', async () => {
    await render(UrlController.getCreateForm, mockRequest(user));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, bundleUrl: 'http://localhost:8081/b/kit' })
    });
    $('pillBundle').click();
    type($('bundleTitleInput'), 'Kit');
    document.querySelectorAll('.bundle-row-url').forEach((input, i) => type(input, `https://${i}.example`));
    submit();
    await flush();
    expectOpenButton('http://localhost:8081/b/kit');
  });

  it('a file opens its page', async () => {
    let xhr;
    global.XMLHttpRequest = jest.fn(() => {
      const listeners = {};
      xhr = {
        upload: { addEventListener: () => {} },
        addEventListener: (name, fn) => { listeners[name] = fn; },
        open: () => {}, send: () => {}, listeners
      };
      return xhr;
    });
    await render(UrlController.getCreateForm, mockRequest(user));
    $('pillFile').click();
    Object.defineProperty($('fileInput'), 'files', { value: [new File(['x'], 'a.txt')] });
    submit();
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ success: true, fileUrl: 'http://localhost:8081/f/report' });
    xhr.listeners.load();
    expectOpenButton('http://localhost:8081/f/report');
  });
});
