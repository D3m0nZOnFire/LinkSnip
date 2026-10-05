/**
 * Admin → Items (views/admin-items.ejs): row actions, select mode with bulk actions, QR code, editing a link,
 * the search help. Actions go to /api/admin/:type/… and reload the list.
 */
(function () {
  'use strict';

  const list = document.getElementById('itemList');
  const NOUN = { url: 'link', bundle: 'bundle', paste: 'paste', file: 'file' };
  const MAX_BULK = 200;

  async function send(url, options = {}) {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || (body.errors && body.errors.join(', ')) || `Request failed (${response.status})`);
    return body;
  }

  const reloadSoon = () => setTimeout(() => window.location.reload(), 600);
  const rowOf = (el) => el.closest('.item-row');
  const describeRow = (row) => `${NOUN[row.dataset.type]} ${row.querySelector('.item-slug').textContent.trim()}`;

  // ─── Search help, page size ──────────────────────────────────────────────
  const helpButton = document.querySelector('.search-help-btn');
  const help = document.getElementById('searchHelp');
  if (helpButton && help) {
    helpButton.addEventListener('click', () => {
      help.hidden = !help.hidden;
      helpButton.setAttribute('aria-expanded', String(!help.hidden));
    });
  }
  document.querySelectorAll('[data-autosubmit]').forEach(select => {
    select.addEventListener('change', () => select.form.submit());
  });

  // ─── Modals ──────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.active').forEach(modal => closeModal(modal.id));
  });

  if (!list) return;

  // ─── Row actions ─────────────────────────────────────────────────────────
  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button || !list.contains(button)) return;
    const row = rowOf(button);
    const { type, id, slug } = row.dataset;

    if (button.dataset.qr) return showQr(type, slug);
    if (button.dataset.editUrl) return editUrl(button.dataset.editUrl);

    const action = button.dataset.action;
    if (!action) return;
    const question = {
      block: `Block ${describeRow(row)}? Nobody can open it until it is unblocked.`,
      unblock: `Unblock ${describeRow(row)}?`,
      delete: `Delete ${describeRow(row)}? This cannot be undone.`
    }[action];
    if (!confirm(question)) return;

    button.disabled = true;
    try {
      if (action === 'delete') await send(`/api/admin/${type}/${id}`, { method: 'DELETE' });
      else await send(`/api/admin/${type}/${id}/${action}`, { method: 'POST' });
      showToast(action === 'delete' ? 'Deleted' : action === 'block' ? 'Blocked' : 'Unblocked');
      reloadSoon();
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
    }
  });

  // ─── Select mode and bulk actions ────────────────────────────────────────
  const selectButton = document.getElementById('selectModeBtn');
  const bar = document.getElementById('bulkBar');
  const count = document.getElementById('bulkCount');
  const checkboxes = () => [...list.querySelectorAll('.item-select')];
  const selected = () => checkboxes().filter(box => box.checked).map(rowOf);

  function setSelecting(on) {
    document.body.classList.toggle('selecting', on);
    selectButton.setAttribute('aria-pressed', String(on));
    selectButton.textContent = on ? 'Done' : 'Select';
    bar.hidden = !on;
    checkboxes().forEach(box => { box.hidden = !on; if (!on) box.checked = false; });
    updateBar();
  }

  function updateBar() {
    const n = selected().length;
    count.textContent = `${n} selected`;
    bar.querySelectorAll('[data-bulk]').forEach(button => { button.disabled = n === 0; });
  }

  selectButton.addEventListener('click', () => setSelecting(!document.body.classList.contains('selecting')));
  document.getElementById('bulkCancel').addEventListener('click', () => setSelecting(false));
  list.addEventListener('change', (event) => {
    if (event.target.classList.contains('item-select')) updateBar();
  });

  bar.querySelectorAll('[data-bulk]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.bulk;
      const rows = selected();
      const verb = { block: 'Block', unblock: 'Unblock', delete: 'Delete' }[action];
      const warning = action === 'delete' ? ' This cannot be undone.' : '';
      if (!rows.length || !confirm(`${verb} ${rows.length} item${rows.length === 1 ? '' : 's'}?${warning}`)) return;

      // One request per type (and per 200 items)
      const byType = {};
      rows.forEach(row => { (byType[row.dataset.type] = byType[row.dataset.type] || []).push(Number(row.dataset.id)); });
      const errors = [];
      bar.querySelectorAll('button').forEach(b => { b.disabled = true; });
      for (const [type, ids] of Object.entries(byType)) {
        for (let i = 0; i < ids.length; i += MAX_BULK) {
          try {
            const result = await send(`/api/admin/${type}/bulk-${action}`, {
              method: 'POST',
              body: JSON.stringify({ ids: ids.slice(i, i + MAX_BULK) })
            });
            errors.push(...(result.errors || []));
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      if (errors.length) showToast(`Done, with problems: ${errors.slice(0, 3).join('; ')}`, 'error');
      else showToast(`${{ block: 'Blocked', unblock: 'Unblocked', delete: 'Deleted' }[action]} ${rows.length} item${rows.length === 1 ? '' : 's'}`);
      reloadSoon();
    });
  });

  // ─── QR code ─────────────────────────────────────────────────────────────
  async function showQr(type, slug) {
    const image = document.getElementById('qrImage');
    const target = document.getElementById('qrTarget');
    try {
      const data = await send(`/api/qrcode/${type}/${encodeURIComponent(slug)}/dataurl?theme=light`);
      image.src = data.dataURL;
      target.textContent = data.target;
      document.getElementById('qrDownload').href = `/qrcode/${type}/${encodeURIComponent(slug)}/download?theme=light`;
      openModal('qrModal');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  // ─── Edit a link ─────────────────────────────────────────────────────────
  let editingId = null;
  const field = (id) => document.getElementById(id);

  async function editUrl(id) {
    try {
      const url = await send(`/api/urls/${id}`);
      editingId = id;
      field('editLongUrl').value = url.longUrl;
      field('editCustomSlug').value = url.slug;
      field('editMaxUses').value = url.maxUses || '';
      const days = url.expiresAt ? Math.ceil((new Date(url.expiresAt) - Date.now()) / 86400000) : '';
      field('editExpirationDays').value = days > 0 ? days : '';
      // Rounded to days: only a changed value is sent, so saving doesn't move the expiry
      field('editExpirationDays').dataset.original = field('editExpirationDays').value;
      field('editActivateDateTime').value = url.activateAt ? url.activateAt.substring(0, 16) : '';
      field('editDeactivateDateTime').value = url.deactivateAt ? url.deactivateAt.substring(0, 16) : '';
      field('editPassword').value = '';
      field('removePassword').checked = false;
      field('editUrlPasswordNote').hidden = !url.password;
      // SQLite dates have no zone and are UTC
      const created = url.createdAt.includes('T') ? url.createdAt : `${url.createdAt.replace(' ', 'T')}Z`;
      field('editUrlMeta').textContent = `${url.clicks} clicks · created ${new Date(created).toISOString().slice(0, 10)}`;
      openModal('editUrlModal');
      field('editLongUrl').focus();
    } catch (error) {
      showToast(`Could not load the link: ${error.message}`, 'error');
    }
  }

  field('editUrlForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingId) return;
    const longUrl = field('editLongUrl').value.trim();
    if (!longUrl) return showToast('The destination is required', 'error');

    const body = {
      longUrl,
      slug: field('editCustomSlug').value.trim(),
      maxUses: field('editMaxUses').value ? parseInt(field('editMaxUses').value, 10) : null,
      activateDateTime: field('editActivateDateTime').value || null,
      deactivateDateTime: field('editDeactivateDateTime').value || null
    };
    const days = field('editExpirationDays').value;
    if (days !== field('editExpirationDays').dataset.original) body.expirationDays = days ? parseInt(days, 10) : null;
    if (field('removePassword').checked) body.removePassword = true;
    else if (field('editPassword').value.trim()) body.password = field('editPassword').value.trim();

    const save = field('saveUrlBtn');
    save.disabled = true;
    try {
      await send(`/api/urls/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Link saved');
      closeModal('editUrlModal');
      reloadSoon();
    } catch (error) {
      showToast(error.message, 'error');
      save.disabled = false;
    }
  });
})();
