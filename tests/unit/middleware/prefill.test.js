const { urlFromPath, prefillFromPath } = require('../../../middleware/prefill');

// lnksnp.ch/<a link> opens the create page with that link filled in
const YOUTUBE = 'https://www.youtube.com/watch?v=JSur9qyqtuA&t=262s';

describe('urlFromPath', () => {
  it('takes a full link after the slash, query string included', () => {
    expect(urlFromPath(`/${YOUTUBE}`)).toBe(YOUTUBE);
    expect(urlFromPath('/http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c');
  });

  it('adds https:// to a link typed without it', () => {
    expect(urlFromPath('/www.youtube.com/watch?v=JSur9qyqtuA&t=262s')).toBe(YOUTUBE);
    expect(urlFromPath('/example.co.uk')).toBe('https://example.co.uk');
  });

  // Some proxies (nginx's merge_slashes) turn "https://" in a path into "https:/"
  it('repairs a link whose double slash was merged on the way', () => {
    expect(urlFromPath('/https:/www.youtube.com/watch?v=JSur9qyqtuA&t=262s')).toBe(YOUTUBE);
  });

  it('takes an encoded link', () => {
    expect(urlFromPath(`/${encodeURIComponent(YOUTUBE)}`)).toBe(YOUTUBE);
  });

  it("leaves LinkSnip's own paths alone, dots or not", () => {
    for (const path of ['/', '/dashboard', '/s/abc', '/p/notes.v2', '/f/report.pdf', '/info/a.b', '/bio/someone', '/api/x.json']) {
      expect(urlFromPath(path)).toBeNull();
    }
  });

  it('only takes http and https', () => {
    expect(urlFromPath('/javascript:alert(1)')).toBeNull();
    expect(urlFromPath('/ftp://example.com')).toBeNull();
    expect(urlFromPath('/data:text/html,hi')).toBeNull();
  });

  it('refuses very long links (over 2048 characters)', () => {
    expect(urlFromPath(`/https://example.com/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('refuses something that only looks like a link', () => {
    expect(urlFromPath('/https://')).toBeNull();
    expect(urlFromPath('/https://exa mple.com')).toBeNull();
  });
});

describe('prefillFromPath', () => {
  it('hands a link to the create page', () => {
    const createPage = jest.fn();
    const next = jest.fn();
    const req = { originalUrl: `/${YOUTUBE}` };
    prefillFromPath(createPage)(req, {}, next);
    expect(req.prefillUrl).toBe(YOUTUBE);
    expect(createPage).toHaveBeenCalledWith(req, {});
    expect(next).not.toHaveBeenCalled();
  });

  it('passes everything else on', () => {
    const createPage = jest.fn();
    const next = jest.fn();
    prefillFromPath(createPage)({ originalUrl: '/dashboard' }, {}, next);
    expect(createPage).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
