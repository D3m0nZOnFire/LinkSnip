/**
 * Dashboard (views/dashboard.ejs): live search and filters, the ⋯ row menus, copy / QR / edit / delete for every
 * type, select mode with bulk delete. The results (pills, rows, paging) come from GET /dashboard?partial=1 and are
 * swapped into #dashResults; the address bar follows. Moving to and from teams: public/js/teamMove.js.
 */
(function () {
  'use strict';

  const form = document.getElementById('dashFilters');
  const results = document.getElementById('dashResults');
  if (!form || !results) return;

  const NOUN = { url: 'link', bundle: 'bundle', paste: 'paste', file: 'file' };
  const MAX_BULK = 200;

  async function send(url, options = {}) {
    const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) {
      throw new Error(body.error || (body.errors && body.errors.join(', ')) || `Request failed (${response.status})`);
    }
    return body;
  }

  // ─── Loading results ──────────────────────────────────────────────────────
  let loading = null;

  function addressFromForm() {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (!value) continue;
      if ((key === 'sort' && value === 'newest') || (key === 'limit' && value === '50')) continue;
      params.set(key, value);
    }
    const query = params.toString();
    return `/dashboard${query ? `?${query}` : ''}`;
  }

  async function load(address, { push = false } = {}) {
    if (loading) loading.abort();
    loading = new AbortController();
    const url = new URL(address, window.location.origin);
    const partial = new URL(url);
    partial.searchParams.set('partial', '1');
    results.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(partial, { signal: loading.signal, headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      results.innerHTML = await response.text();
      history[push ? 'pushState' : 'replaceState'](null, '', url.pathname + url.search);
      form.elements.type.value = url.searchParams.get('type') || '';
      if (selecting) startSelecting();
    } catch (error) {
      if (error.name !== 'AbortError') showToast(error.message, 'error');
    } finally {
      results.removeAttribute('aria-busy');
    }
  }

  const reload = () => load(window.location.pathname + window.location.search);

  let typing = null;
  form.elements.search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => load(addressFromForm()), 250);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(typing);
    load(addressFromForm());
  });
  form.addEventListener('change', (event) => {
    if (event.target.matches('select')) load(addressFromForm());
  });
  // The page size select sits in the results (form="dashFilters")
  results.addEventListener('change', (event) => {
    if (event.target.id === 'pageSize') load(addressFromForm());
  });
  results.addEventListener('click', (event) => {
    const nav = event.target.closest('a[data-nav]');
    if (!nav || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    load(nav.getAttribute('href'), { push: true });
    if (nav.matches('.pager a')) results.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  window.addEventListener('popstate', () => load(window.location.pathname + window.location.search));

  const scope = document.getElementById('dashboardScope');
  if (scope) {
    scope.addEventListener('change', () => {
      window.location.href = scope.value ? `/dashboard?team=${scope.value}` : '/dashboard';
    });
  }

  // ─── ⋯ menus ──────────────────────────────────────────────────────────────
  function closeMenus(except) {
    results.querySelectorAll('.row-menu .menu:not([hidden])').forEach(menu => {
      if (menu === except) return;
      menu.hidden = true;
      menu.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(button) {
    const menu = button.nextElementSibling;
    const open = menu.hidden;
    closeMenus(menu);
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    menu.classList.remove('opens-up');
    const box = menu.getBoundingClientRect();
    if (box.bottom > window.innerHeight - 8) menu.classList.add('opens-up');
    const first = menu.querySelector('a, button');
    if (first) first.focus();
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.row-menu')) closeMenus();
  });
  document.addEventListener('keydown', (event) => {
    const menu = event.target.closest && event.target.closest('.row-menu .menu');
    if (event.key === 'Escape') {
      const open = results.querySelector('.row-menu .menu:not([hidden])');
      if (open) {
        closeMenus();
        open.previousElementSibling.focus();
      }
    } else if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('a, button')];
      const next = items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
      items[(next + items.length) % items.length].focus();
    }
  });

  // ─── Row actions ──────────────────────────────────────────────────────────
  results.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-menu-toggle]');
    if (toggle) return toggleMenu(toggle);

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('.item-row');
    if (!row) return;
    const { type, id, name } = row.dataset;
    const action = button.dataset.action;
    if (action === 'edit' && button.tagName === 'A') return; // pastes: their editor page
    closeMenus();

    if (action === 'copy') return copy(button);
    if (action === 'qr') return showQr(type, button.dataset.slug, row);
    if (action === 'edit') return ({ url: editUrl, bundle: editBundle, file: editFile })[type](id, row);
    if (action === 'delete') return deleteItems([{ type, id }], `Delete the ${NOUN[type]} ${name}? This cannot be undone.`);
  });

  async function copy(button) {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      showToast('Short link copied');
    } catch (error) {
      showToast('Could not copy the link', 'error');
    }
  }

  // ─── QR code ──────────────────────────────────────────────────────────────
  function showQr(type, slug, row) {
    const image = document.getElementById('qrImage');
    image.src = `/qrcode/${type}/${encodeURIComponent(slug)}?theme=light`;
    document.getElementById('qrDownload').href = `/qrcode/${type}/${encodeURIComponent(slug)}/download?theme=light`;
    document.getElementById('qrTarget').textContent = row.querySelector('[data-action="copy"]').dataset.copy;
    openModal('qrModal');
  }

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  // ─── Delete (one item or a selection) ─────────────────────────────────────
  async function deleteItems(items, question) {
    if (!(await confirmAction(question, items.length > 1 ? `Delete ${items.length} items` : 'Delete'))) return;
    const ids = (type) => items.filter(item => item.type === type).map(item => Number(item.id));
    const failures = [];
    const run = async (promise) => { try { await promise; } catch (error) { failures.push(error.message); } };

    // Links, bundles and pastes have bulk endpoints; files go one by one
    for (const [type, path] of [['url', '/api/urls/bulk-delete'], ['bundle', '/api/bundles/bulk-delete'], ['paste', '/api/pastes/bulk-delete']]) {
      const list = ids(type);
      if (list.length === 1) await run(send(`/api/${type === 'url' ? 'urls' : `${type}s`}/${list[0]}`, { method: 'DELETE' }));
      else if (list.length) await run(send(path, { method: 'POST', body: JSON.stringify({ ids: list }) }));
    }
    for (const id of ids('file')) await run(send(`/api/files/${id}`, { method: 'DELETE' }));

    if (failures.length) showToast(failures[0], 'error');
    else showToast(items.length > 1 ? `Deleted ${items.length} items` : 'Deleted');
    stopSelecting();
    reload();
  }

  // ─── Select mode ──────────────────────────────────────────────────────────
  const selectButton = document.getElementById('selectModeBtn');
  const bulkBar = document.getElementById('bulkBar');
  const bulkCount = document.getElementById('bulkCount');
  const bulkDelete = document.getElementById('bulkDelete');
  let selecting = false;

  const checkboxes = () => [...results.querySelectorAll('.item-select')];
  const selected = () => checkboxes().filter(box => box.checked).map(box => box.closest('.item-row'));

  function updateBulk() {
    const rows = selected();
    bulkCount.textContent = `${rows.length} selected`;
    bulkDelete.disabled = rows.length === 0 || rows.length > MAX_BULK;
    checkboxes().forEach(box => box.closest('.item-row').classList.toggle('is-selected', box.checked));
  }

  function startSelecting() {
    selecting = true;
    checkboxes().forEach(box => { box.hidden = false; });
    bulkBar.hidden = false;
    document.body.classList.add('selecting');
    if (selectButton) {
      selectButton.setAttribute('aria-pressed', 'true');
      selectButton.textContent = 'Done';
    }
    updateBulk();
  }

  function stopSelecting() {
    selecting = false;
    checkboxes().forEach(box => { box.hidden = true; box.checked = false; });
    if (bulkBar) bulkBar.hidden = true;
    document.body.classList.remove('selecting');
    if (selectButton) {
      selectButton.setAttribute('aria-pressed', 'false');
      selectButton.textContent = 'Select';
    }
  }

  if (selectButton) {
    selectButton.addEventListener('click', () => (selecting ? stopSelecting() : startSelecting()));
    results.addEventListener('change', (event) => {
      if (event.target.matches('.item-select')) updateBulk();
    });
    document.getElementById('bulkAll').addEventListener('click', () => {
      const boxes = checkboxes();
      const all = boxes.every(box => box.checked);
      boxes.forEach(box => { box.checked = !all; });
      updateBulk();
    });
    document.getElementById('bulkCancel').addEventListener('click', stopSelecting);
    bulkDelete.addEventListener('click', () => {
      const rows = selected();
      if (!rows.length) return;
      deleteItems(rows.map(row => ({ type: row.dataset.type, id: row.dataset.id })),
        `Delete ${rows.length} item${rows.length === 1 ? '' : 's'}? This cannot be undone.`);
    });
  }

  // ─── Tag inputs in the edit forms ─────────────────────────────────────────
  const tagSelectors = {};
  function tagSelector(id) {
    if (!tagSelectors[id] && document.getElementById(id) && typeof TagSelector !== 'undefined') {
      tagSelectors[id] = new TagSelector(id, { placeholder: 'Add tags…' });
    }
    return tagSelectors[id] || null;
  }
  const tagNames = (tags) => (tags || []).map(tag => tag.name).join(',');
  const value = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const checked = (id) => { const el = document.getElementById(id); return !!(el && el.checked); };

  function saving(buttonId, busy) {
    const button = document.getElementById(buttonId);
    if (button) setButtonLoading(button, busy);
  }

  // ─── Edit a link ──────────────────────────────────────────────────────────
  let editingUrl = null;
  async function editUrl(id) {
    try {
      const url = await send(`/api/urls/${id}`);
      editingUrl = url;
      document.getElementById('editLongUrl').value = url.longUrl;
      document.getElementById('editCustomSlug').value = url.slug;
      document.getElementById('editMaxUses').value = url.maxUses || '';
      const days = document.getElementById('editExpirationDays');
      days.value = url.expiresAt ? Math.max(0, Math.ceil((new Date(url.expiresAt) - Date.now()) / 86400000)) || '' : '';
      days.dataset.original = days.value; // rounded days: only a changed value is sent
      const activate = document.getElementById('editActivateDateTime');
      const deactivate = document.getElementById('editDeactivateDateTime');
      if (activate) activate.value = url.activateAt ? url.activateAt.substring(0, 16) : '';
      if (deactivate) deactivate.value = url.deactivateAt ? url.deactivateAt.substring(0, 16) : '';
      const password = document.getElementById('editPassword');
      if (password) password.value = '';
      document.getElementById('removePassword').checked = false;
      document.getElementById('removePasswordLine').hidden = !url.password;
      document.getElementById('editUrlPasswordNote').hidden = !url.password;
      document.getElementById('editUrlMeta').textContent =
        `${url.clicks} click${url.clicks === 1 ? '' : 's'} · created ${formatDate(url.createdAt)}`;
      const tags = tagSelector('editUrlTags');
      if (tags) tags.setValue(tagNames(url.tags));
      openModal('editUrlModal');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  document.getElementById('editUrlForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingUrl) return;
    const longUrl = value('editLongUrl');
    if (!longUrl) return showToast('The destination is required', 'error');

    const body = { longUrl, customSlug: value('editCustomSlug') || null, maxUses: value('editMaxUses') ? Number(value('editMaxUses')) : null };
    const days = document.getElementById('editExpirationDays');
    if (days.value !== days.dataset.original) body.expirationDays = days.value ? Number(days.value) : null;
    if (document.getElementById('editActivateDateTime')) {
      body.activateDateTime = value('editActivateDateTime') || null;
      body.deactivateDateTime = value('editDeactivateDateTime') || null;
    }
    if (checked('removePassword')) body.removePassword = true;
    else if (value('editPassword')) body.password = value('editPassword');
    const tags = tagSelector('editUrlTags');
    if (tags) body.tags = tags.getValue() || '';

    saving('saveUrlBtn', true);
    try {
      await send(`/api/urls/${editingUrl.id}`, { method: 'PUT', body: JSON.stringify(body) });
      closeModal('editUrlModal');
      showToast('Link saved');
      reload();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      saving('saveUrlBtn', false);
    }
  });

  // ─── Edit a bundle ────────────────────────────────────────────────────────
  let editingBundle = null;
  const bundleItems = document.getElementById('editBundleItems');

  function addBundleItem(url = '', label = '') {
    const item = document.createElement('div');
    item.className = 'bundle-edit-item';
    item.innerHTML = `
      <input type="url" class="form-input edit-bundle-url" placeholder="https://example.com" aria-label="Link">
      <input type="text" class="form-input edit-bundle-label" placeholder="Label (optional)" maxlength="100" aria-label="Label">
      <button type="button" class="icon-btn danger" title="Remove" aria-label="Remove this link">✕</button>`;
    item.querySelector('.edit-bundle-url').value = url;
    item.querySelector('.edit-bundle-label').value = label || '';
    item.querySelector('button').addEventListener('click', () => item.remove());
    bundleItems.appendChild(item);
  }

  async function editBundle(id) {
    try {
      const bundle = await send(`/api/bundles/${id}`);
      editingBundle = bundle;
      document.getElementById('editBundleName').value = bundle.title || '';
      document.getElementById('editBundleDescription').value = bundle.description || '';
      bundleItems.innerHTML = '';
      (bundle.items || []).forEach(item => addBundleItem(item.url, item.label));
      const tags = tagSelector('editBundleTags');
      if (tags) tags.setValue(tagNames(bundle.tags));
      openModal('editBundleModal');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  document.getElementById('editBundleAdd').addEventListener('click', () => addBundleItem());
  document.getElementById('editBundleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editingBundle) return;
    const title = value('editBundleName');
    if (!title) return showToast('The title is required', 'error');
    const items = [...bundleItems.querySelectorAll('.bundle-edit-item')]
      .map(item => ({ url: item.querySelector('.edit-bundle-url').value.trim(), label: item.querySelector('.edit-bundle-label').value.trim() || null }))
      .filter(item => item.url);
    if (items.length < 2) return showToast('A bundle needs at least 2 links', 'error');

    const body = { title, description: value('editBundleDescription') || null, items };
    const tags = tagSelector('editBundleTags');
    if (tags) body.tags = tags.getValue() || '';

    saving('saveBundleBtn', true);
    try {
      await send(`/api/bundles/${editingBundle.id}`, { method: 'PUT', body: JSON.stringify(body) });
      closeModal('editBundleModal');
      showToast('Bundle saved');
      reload();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      saving('saveBundleBtn', false);
    }
  });

  // ─── Edit a file ──────────────────────────────────────────────────────────
  let editingFile = null;
  let allowedUsers = [];
  const fileForm = document.getElementById('editFileForm');

  function renderAllowedUsers() {
    const wrap = document.getElementById('editFileUsers');
    const input = document.getElementById('editFileUserInput');
    wrap.querySelectorAll('.user-chip').forEach(chip => chip.remove());
    allowedUsers.forEach(user => {
      const chip = document.createElement('span');
      chip.className = 'user-chip';
      chip.textContent = `@${user.username}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${user.username}`);
      remove.addEventListener('click', () => {
        allowedUsers = allowedUsers.filter(other => other.id !== user.id);
        renderAllowedUsers();
      });
      chip.appendChild(remove);
      wrap.insertBefore(chip, input);
    });
    document.getElementById('editFileUsersGroup').hidden = document.getElementById('editFileSharing').value !== 'restricted';
  }

  async function editFile(id) {
    try {
      const { file } = await send(`/api/files/${id}`);
      editingFile = file;
      document.getElementById('editFileName').textContent = file.originalName;
      document.getElementById('editFileExpires').value = file.expiresAt ? file.expiresAt.substring(0, 10) : '';
      document.getElementById('editFileMaxDownloads').value = file.maxDownloads || '';
      const password = document.getElementById('editFilePassword');
      if (password) password.value = '';
      document.getElementById('editFileRemovePassword').checked = false;
      document.getElementById('editFileRemoveLine').hidden = !file.hasPassword;
      document.getElementById('editFileSharing').value = file.sharingMode || 'public';
      document.getElementById('editFileUsersError').textContent = '';
      allowedUsers = file.allowedUsers || [];
      renderAllowedUsers();
      const tags = tagSelector('editFileTags');
      if (tags) tags.setValue(tagNames(file.tags));
      openModal('editFileModal');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  if (fileForm) {
    document.getElementById('editFileSharing').addEventListener('change', renderAllowedUsers);
    document.getElementById('editFileUsers').addEventListener('click', () => document.getElementById('editFileUserInput').focus());
    document.getElementById('editFileUserInput').addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      const input = event.target;
      const error = document.getElementById('editFileUsersError');
      const username = input.value.trim().replace(/^@/, '');
      if (!username) return;
      try {
        const data = await send(`/api/users/lookup?username=${encodeURIComponent(username)}`);
        if (!data.found) throw new Error(`There is no user called ${username}.`);
        if (!allowedUsers.some(user => user.id === data.id)) allowedUsers.push({ id: data.id, username: data.username });
        input.value = '';
        error.textContent = '';
        renderAllowedUsers();
      } catch (lookupError) {
        error.textContent = lookupError.message;
      }
    });

    fileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!editingFile) return;
      const body = {
        expiresAt: value('editFileExpires') || null,
        maxDownloads: value('editFileMaxDownloads') || null,
        sharingMode: value('editFileSharing'),
        allowedUsers: JSON.stringify(allowedUsers.map(user => user.id))
      };
      if (checked('editFileRemovePassword')) body.removePassword = '1';
      else if (value('editFilePassword')) body.password = value('editFilePassword');
      const tags = tagSelector('editFileTags');
      if (tags) body.tags = tags.getValue() || '';

      saving('saveFileBtn', true);
      try {
        await send(`/api/files/${editingFile.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        closeModal('editFileModal');
        showToast('File saved');
        reload();
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        saving('saveFileBtn', false);
      }
    });
  }
})();
