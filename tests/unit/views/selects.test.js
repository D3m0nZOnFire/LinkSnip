const fs = require('fs');
const path = require('path');

// Every dropdown uses the custom list (public/js/customSelect.js): each <select> in a view opts in with data-select,
// and partials/head.ejs loads the script and its stylesheet on every page.

const VIEWS = path.join(__dirname, '../../../views');
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(path.join(dir, entry.name)) : entry.name.endsWith('.ejs') ? [path.join(dir, entry.name)] : []);

describe('custom dropdowns', () => {
  it('every <select> in the views has data-select', () => {
    const missing = [];
    for (const file of files(VIEWS)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const tag of source.match(/<select\b[^>]*>/g) || []) {
        if (!/\sdata-select[\s>]/.test(tag)) missing.push(`${path.relative(VIEWS, file)}: ${tag}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('scripts that build selects mark them too', () => {
    const js = path.join(__dirname, '../../../public/js');
    const missing = fs.readdirSync(js).filter(name => name.endsWith('.js')).filter(name => {
      const source = fs.readFileSync(path.join(js, name), 'utf8');
      return /createElement\('select'\)/.test(source) && !/dataset\.select\s*=|setAttribute\('data-select'/.test(source);
    });
    expect(missing).toEqual([]);
  });

  it('every page loads the script and the stylesheet', () => {
    const head = fs.readFileSync(path.join(VIEWS, 'partials/head.ejs'), 'utf8');
    expect(head).toMatch(/<link rel="stylesheet" href="\/css\/select\.css">/);
    expect(head).toMatch(/<script src="\/js\/customSelect\.js" defer><\/script>/);
  });
});
