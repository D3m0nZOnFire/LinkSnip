const { contentType, isTypeEnabled } = require('../../../services/contentTypes');
const slugService = require('../../../services/slugService');
const brandingService = require('../../../services/brandingService');
const { uploadName } = require('../../../middleware/fileUpload');

// Fixes for the first CodeQL scan (see the PR): lookups by a name from the request, the SVG check's regular
// expression, random slugs and stored upload names.

describe('content types are looked up by their own names only', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('"%s" is not a content type', (name) => {
    expect(isTypeEnabled(name)).toBe(false);
    expect(() => contentType(name)).toThrow(/Unknown content type/);
  });

  it('the real ones still are', () => {
    ['url', 'bundle', 'paste', 'file'].forEach(type => expect(contentType(type).table).toBeTruthy());
  });
});

describe('SVG detection (branding uploads)', () => {
  const svg = (prefix) => Buffer.from(`${prefix}<svg xmlns="http://www.w3.org/2000/svg"></svg>`);

  // 27 comments: about a second with the old expression (doubling with each one), well under a millisecond now.
  // A larger count would hang a vulnerable version instead of failing this test.
  it('stays fast on many comments (no catastrophic backtracking)', () => {
    const started = Date.now();
    expect(() => brandingService.saveAsset('logo', Buffer.from('<!---->'.repeat(27) + 'x'))).toThrow(/Use a PNG/);
    expect(() => brandingService.saveAsset('logo', Buffer.from('<!--' + '<!---->'.repeat(27) + '!'))).toThrow(/Use a PNG/);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('still accepts SVGs after an XML declaration, comments and a doctype', () => {
    const saved = brandingService.saveAsset('logo', svg('<?xml version="1.0"?>\n<!-- a -- b -->\n<!-- c -->\n<!DOCTYPE svg>\n'));
    expect(saved.type).toBe('svg');
  });
});

describe('random slugs', () => {
  it('come from crypto, not Math.random (predictable from earlier slugs)', () => {
    const spy = jest.spyOn(Math, 'random');
    const slug = slugService.generate('url');
    expect(slug).toMatch(/^[A-Za-z0-9_-]{5}$/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('uploadName (stored file names)', () => {
  it('is a UUID plus the original extension when it is plain letters and digits', () => {
    expect(uploadName('Photo.JPG')).toMatch(/^[0-9a-f-]{36}\.JPG$/);
    expect(uploadName('archive.tar.gz')).toMatch(/^[0-9a-f-]{36}\.gz$/);
  });

  it.each(['notes', 'a.b c', 'x.\\..\\y', 'evil.js\n', 'x.' + 'a'.repeat(30)])('drops an extension like %j', (name) => {
    expect(uploadName(name)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never repeats', () => {
    expect(uploadName('a.txt')).not.toBe(uploadName('a.txt'));
  });
});
