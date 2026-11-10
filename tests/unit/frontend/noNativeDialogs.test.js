const fs = require('fs');
const path = require('path');

// Pages ask and report with the app's own dialogs and toasts (confirmAction, showToast, a modal for typed
// confirmations), never the browser's confirm(), alert() or prompt(): those look foreign and block the page.
// main.js keeps confirm() only as confirmAction's fallback for a page without the dialog.

const JS = path.join(__dirname, '../../../public/js');
const scripts = fs.readdirSync(JS).filter(name => name.endsWith('.js'));
const NATIVE = /(^|[^\w.$])(window\.)?(confirm|alert|prompt)\s*\(/;

it.each(scripts)('%s uses no browser dialog', (name) => {
  const code = fs.readFileSync(path.join(JS, name), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const lines = code.split('\n').filter(line => NATIVE.test(line));
  const allowed = name === 'main.js' ? lines.filter(line => !/return Promise\.resolve\(confirm\(message\)\)/.test(line)) : lines;
  expect(allowed).toEqual([]);
});
