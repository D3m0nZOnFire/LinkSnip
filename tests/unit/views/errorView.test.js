const path = require('path');
const ejs = require('ejs');

const VIEW = path.join(__dirname, '../../../views/error.ejs');
const render = (locals) => ejs.renderFile(VIEW, locals);

describe('views/error.ejs', () => {
  it('renders the usual { title, message, code }', async () => {
    const html = await render({ title: 'Page Not Found', message: 'Nope.', code: 404 });
    expect(html).toContain('Page Not Found');
    expect(html).toContain('Nope.');
    expect(html).toContain('404');
  });

  it('renders { message, statusCode } without crashing (file pages)', async () => {
    const html = await render({ message: 'This file has been blocked.', statusCode: 403 });
    expect(html).toContain('This file has been blocked.');
    expect(html).toContain('403');
    expect(html).toContain('Access Denied');
  });

  it('falls back to a generic title and 500 when given almost nothing', async () => {
    const html = await render({ message: 'Oops' });
    expect(html).toContain('500');
    expect(html).toContain('Something Went Wrong');
  });

  it('uses the status from { error: { status } } (rate limiter)', async () => {
    const html = await render({ message: 'Too Many Requests', error: { status: 429 } });
    expect(html).toContain('429');
    expect(html).toContain('Too Many Requests');
  });
});
