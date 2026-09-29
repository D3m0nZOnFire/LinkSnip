const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '../../../views');
const pages = fs.readdirSync(VIEWS).filter(f => f.endsWith('.ejs'));

describe('footer credit', () => {
  it.each(pages)('%s includes the footer partial before </body>', (page) => {
    const html = fs.readFileSync(path.join(VIEWS, page), 'utf8');
    const include = html.indexOf("include('partials/footer')");
    expect(include).toBeGreaterThan(-1);
    expect(include).toBeLessThan(html.lastIndexOf('</body>'));
  });

  it('credits the author with a link to their GitHub profile', async () => {
    const html = await ejs.renderFile(path.join(VIEWS, 'partials/footer.ejs'), {});
    expect(html).toContain('Made by');
    expect(html).toContain('href="https://github.com/D3m0nZOnFire"');
    expect(html).toContain('D3m0nZOnFire');
  });
});
