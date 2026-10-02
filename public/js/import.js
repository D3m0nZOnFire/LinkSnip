/**
 * Import / export (views/import.ejs): sends the chosen file to POST /api/import and shows what happened.
 * Messages are added as text (they can contain slugs and links from the file).
 */
(function () {
  'use strict';

  const form = document.getElementById('importForm');
  const results = document.getElementById('importResults');
  const input = document.getElementById('importFile');
  if (!form) return;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(kind, title, lines = [], extra = null) {
    results.replaceChildren();
    results.className = `import-results ${kind}`;
    results.appendChild(el('strong', null, title));
    if (lines.length) {
      const details = el('details');
      details.appendChild(el('summary', null, `${lines.length} problem${lines.length === 1 ? '' : 's'}`));
      const list = el('ul');
      lines.forEach(line => list.appendChild(el('li', null, line)));
      details.appendChild(list);
      results.appendChild(details);
    }
    if (extra) results.appendChild(extra);
    results.hidden = false;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = input.files[0];
    if (!file) return show('error', 'Choose a file first.');

    const button = document.getElementById('importBtn');
    button.disabled = true;
    show('pending', 'Importing…');
    const data = new FormData();
    data.append('file', file);

    try {
      const response = await fetch('/api/import', { method: 'POST', body: data });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        const { success, failed, errors = [] } = result.results;
        const link = el('a', 'btn btn-small', 'Open the dashboard');
        link.href = '/dashboard';
        show(failed ? 'warning' : 'success',
          `${success} link${success === 1 ? '' : 's'} imported${failed ? `, ${failed} failed` : ''}.`,
          errors.map(error => `Line ${error.line}: ${error.error}`), link);
        input.value = '';
      } else {
        show('error', result.error || `The import failed (${response.status}).`, result.details || []);
      }
    } catch (error) {
      show('error', 'The import failed. Please try again.');
    } finally {
      button.disabled = false;
    }
  });
})();
