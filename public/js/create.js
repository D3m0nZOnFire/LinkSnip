/**
 * Create page (views/index.ejs): the Link / Text / Bundle / File modes, the option chips and their panels, and
 * submitting. Links post the form (POST /create); pastes, bundles and files go to their APIs.
 * Each mode is a [data-section]; a chip [data-chip] opens the [data-panel] of the same name in its section and
 * shows the panel's value (data-format says how).
 */
(function () {
  'use strict';

  const form = document.getElementById('creatorForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const sections = [...form.querySelectorAll('[data-section]')];
  let mode = 'url';

  // ─── Messages ─────────────────────────────────────────────────────────────
  function showError(message) {
    const box = $('creatorError');
    box.textContent = message;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    $('creatorError').hidden = true;
  }

  function showSuccess(label, url) {
    hideError();
    $('creatorSuccessLabel').textContent = label;
    $('creatorSuccessUrl').textContent = url;
    $('creatorSuccess').hidden = false;
    $('creatorSuccess').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  $('creatorCopy').addEventListener('click', async () => {
    const button = $('creatorCopy');
    try {
      await navigator.clipboard.writeText($('creatorSuccessUrl').textContent.trim());
      const original = button.innerHTML;
      button.textContent = 'Copied';
      setTimeout(() => { button.innerHTML = original; }, 1800);
    } catch (error) {
      showError('Could not copy the link.');
    }
  });

  // ─── Modes ────────────────────────────────────────────────────────────────
  function setMode(next) {
    mode = next;
    form.querySelectorAll('[data-mode]').forEach(pill => {
      const active = pill.dataset.mode === next;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-pressed', String(active));
    });
    sections.forEach(section => { section.hidden = section.dataset.section !== next; });
    $('longUrl').required = next === 'url';
    const text = $('submitBtnText');
    text.textContent = text.dataset[next];
    const rate = $('creatorRate');
    rate.textContent = rate.dataset[next] || '';
    hideError();
  }

  form.querySelectorAll('[data-mode]').forEach(pill => {
    pill.addEventListener('click', () => { if (!pill.disabled) setMode(pill.dataset.mode); });
  });

  // ─── Chips and panels ─────────────────────────────────────────────────────
  const panelOf = (chip) => chip.closest('[data-section]').querySelector(`[data-panel="${chip.dataset.chip}"]`);
  const chipOf = (panel) => panel.closest('[data-section]').querySelector(`[data-chip="${panel.dataset.panel}"]`);

  function setChip(chip, label, isSet) {
    if (!chip) return;
    chip.querySelector('.chip-label').textContent = label || chip.dataset.default;
    chip.classList.toggle('chip-set', !!isSet);
  }

  const shortDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  // What the panel's inputs read as on its chip
  function refreshChip(chip) {
    const panel = panelOf(chip);
    if (!panel) return;
    const inputs = [...panel.querySelectorAll('input:not([type="hidden"])')];
    const format = chip.dataset.format;
    if (format === 'days') {
      const radio = panel.querySelector('input[type="radio"]:checked');
      const value = radio ? radio.value : inputs[0].value.trim();
      return setChip(chip, value ? `${value} days` : '', !!value && !radio);
    }
    if (format === 'max') {
      const value = inputs[0].value.trim();
      return setChip(chip, value ? `Max ${value}` : '', !!value);
    }
    if (format === 'date') {
      const value = inputs[0].value;
      return setChip(chip, value ? `Until ${shortDate(value)}` : '', !!value);
    }
    if (format === 'password') {
      return setChip(chip, inputs[0].value ? 'Protected' : '', !!inputs[0].value);
    }
    if (format === 'schedule') {
      const [from, until] = inputs.map(input => input.value);
      const label = from && until ? 'Scheduled' : from ? 'Starts later' : until ? 'Ends later' : '';
      return setChip(chip, label, !!label);
    }
  }

  form.querySelectorAll('[data-chip]').forEach(chip => {
    const panel = panelOf(chip);
    if (!panel || chip.disabled) return;
    chip.addEventListener('click', () => {
      const opening = panel.hidden;
      // One open panel per section
      chip.closest('[data-section]').querySelectorAll('[data-panel]').forEach(other => {
        other.hidden = true;
        const otherChip = chipOf(other);
        if (otherChip) {
          otherChip.classList.remove('chip-active');
          otherChip.setAttribute('aria-expanded', 'false');
        }
      });
      panel.hidden = !opening;
      chip.classList.toggle('chip-active', opening);
      chip.setAttribute('aria-expanded', String(opening));
      if (opening) {
        const first = panel.querySelector('input:not([type="radio"]):not([type="hidden"]), select');
        if (first) setTimeout(() => first.focus(), 50);
      }
    });
    panel.addEventListener('input', () => refreshChip(chip));
    panel.addEventListener('change', () => refreshChip(chip));
  });

  form.querySelectorAll('[data-clear]').forEach(button => {
    button.addEventListener('click', () => {
      const panel = button.closest('[data-panel]');
      panel.querySelectorAll('input:not([type="hidden"]):not([type="radio"])').forEach(input => { input.value = ''; });
      refreshChip(chipOf(panel));
    });
  });

  // ─── Tags ─────────────────────────────────────────────────────────────────
  const tagSelectors = {};
  if (typeof TagSelector !== 'undefined') {
    form.querySelectorAll('[data-tag-selector]').forEach(mount => {
      const hidden = $(mount.dataset.tagSelector);
      const chip = mount.closest('[data-panel]') ? chipOf(mount.closest('[data-panel]')) : null;
      tagSelectors[mount.id] = new TagSelector(mount.id, {
        placeholder: 'Add tags…',
        onChange: (tags) => {
          hidden.value = tags.join(',');
          setChip(chip, tags.length ? `${tags.length} tag${tags.length === 1 ? '' : 's'}` : '', tags.length > 0);
        }
      });
    });
  }

  function resetSection(name) {
    const section = form.querySelector(`[data-section="${name}"]`);
    section.querySelectorAll('input:not([type="radio"]), textarea').forEach(input => {
      input.value = '';
      if (input.tagName === 'TEXTAREA') input.dispatchEvent(new Event('input')); // the line-number gutter follows
    });
    section.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = true; });
    section.querySelectorAll('[data-tag-selector]').forEach(mount => {
      if (tagSelectors[mount.id]) tagSelectors[mount.id].setValue('');
    });
    section.querySelectorAll('[data-chip]').forEach(chip => {
      setChip(chip, '', false);
      chip.classList.remove('chip-active');
      chip.setAttribute('aria-expanded', 'false');
    });
  }

  // ─── Short link fields (one per mode): the host as a prefix, the format checked as it is typed ──
  const SLUG_RE = /^[A-Za-z0-9_-]{1,20}$/;
  form.querySelectorAll('[data-slug-host]').forEach(host => { host.textContent = window.location.host; });
  form.querySelectorAll('[data-slug-input]').forEach(input => {
    input.addEventListener('input', () => {
      const bad = !!input.value && !SLUG_RE.test(input.value);
      input.closest('.creator-slug').classList.toggle('slug-error', bad);
      $(`${input.id}Error`).hidden = !bad;
    });
  });
  // The slug typed in a mode's field ('' when none, or when the field is locked)
  const slugOf = (id) => ($(id) && !$(id).disabled ? $(id).value.trim() : '');

  // ─── Dates: what the visitor typed is local time; the server stores UTC ──
  function localToUtc(value) {
    if (!value) return '';
    const [date, time] = value.split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi, 0, 0).toISOString();
  }
  const endOfDay = (date) => `${date}T23:59:00.000Z`;

  const teamId = () => ($('createInTeam') ? $('createInTeam').value : '');
  const valueOf = (id) => ($(id) ? $(id).value : '');

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function busy(isBusy, label) {
    $('creatorSubmitBtn').disabled = isBusy;
    $('submitBtnText').textContent = isBusy ? label : $('submitBtnText').dataset[mode];
  }

  // ─── Text (paste) ─────────────────────────────────────────────────────────
  async function submitPaste() {
    const content = valueOf('pasteContent');
    if (!content.trim()) return showError('Write or paste some text first.');
    const body = { content };
    if (valueOf('pasteTitle').trim()) body.title = valueOf('pasteTitle').trim();
    if (valueOf('pasteLanguage').trim()) body.language = valueOf('pasteLanguage').trim();
    if (valueOf('pasteExpiresAt')) body.expiresAt = endOfDay(valueOf('pasteExpiresAt'));
    if (valueOf('pasteMaxViews')) body.maxViews = valueOf('pasteMaxViews');
    if (valueOf('pastePassword')) body.password = valueOf('pastePassword');
    if (valueOf('pasteTags')) body.tags = valueOf('pasteTags');
    if (valueOf('pasteActivateAt')) body.activateDateTime = localToUtc(valueOf('pasteActivateAt'));
    if (valueOf('pasteDeactivateAt')) body.deactivateDateTime = localToUtc(valueOf('pasteDeactivateAt'));
    if (slugOf('pasteSlug')) body.slug = slugOf('pasteSlug');
    if (teamId()) body.teamId = teamId();

    busy(true, 'Creating…');
    try {
      const data = await postJson('/api/pastes', body);
      showSuccess('Your paste is ready', data.pasteUrl);
      resetSection('paste');
    } catch (error) {
      showError(error.message);
    } finally {
      busy(false);
    }
  }

  // ─── Bundle ───────────────────────────────────────────────────────────────
  const MAX_BUNDLE_ITEMS = 20;
  const bundleList = $('bundleUrlList');

  function renumberBundle() {
    bundleList.querySelectorAll('.bundle-row-num').forEach((el, i) => { el.textContent = i + 1; });
    $('bundleAddBtn').disabled = bundleList.children.length >= MAX_BUNDLE_ITEMS;
    bundleList.querySelectorAll('.bundle-row-remove').forEach(button => { button.disabled = bundleList.children.length <= 2; });
  }

  function addBundleRow() {
    if (bundleList.children.length >= MAX_BUNDLE_ITEMS) return;
    const row = document.createElement('div');
    row.className = 'bundle-row';
    row.innerHTML = `
      <span class="bundle-row-num" aria-hidden="true"></span>
      <input type="url" class="form-input bundle-row-url" placeholder="https://example.com" aria-label="Link">
      <input type="text" class="form-input bundle-row-label" placeholder="Label (optional)" maxlength="100" aria-label="Label">
      <button type="button" class="icon-btn danger bundle-row-remove" title="Remove" aria-label="Remove this link">✕</button>`;
    row.querySelector('.bundle-row-remove').addEventListener('click', () => {
      if (bundleList.children.length <= 2) return;
      row.remove();
      renumberBundle();
    });
    bundleList.appendChild(row);
    renumberBundle();
  }

  async function submitBundle() {
    const title = valueOf('bundleTitleInput').trim();
    if (!title) return showError('Give the bundle a title.');
    const items = [];
    for (const row of bundleList.querySelectorAll('.bundle-row')) {
      const url = row.querySelector('.bundle-row-url').value.trim();
      const label = row.querySelector('.bundle-row-label').value.trim();
      if (!url) return showError('Every link needs an address (remove the empty ones).');
      items.push({ url, label: label || null });
    }
    if (items.length < 2) return showError('A bundle needs at least 2 links.');
    const body = { title, items };
    if (valueOf('bundleTags')) body.tags = valueOf('bundleTags');
    if (slugOf('bundleSlug')) body.slug = slugOf('bundleSlug');
    if (teamId()) body.teamId = teamId();

    busy(true, 'Creating…');
    try {
      const data = await postJson('/api/bundles', body);
      showSuccess('Your bundle is ready', data.bundleUrl);
      resetSection('bundle');
      bundleList.innerHTML = '';
      addBundleRow();
      addBundleRow();
    } catch (error) {
      showError(error.message);
    } finally {
      busy(false);
    }
  }

  if (bundleList) {
    $('bundleAddBtn').addEventListener('click', addBundleRow);
    addBundleRow();
    addBundleRow();
  }

  // ─── File ─────────────────────────────────────────────────────────────────
  const fileInput = $('fileInput');
  let allowedUsers = [];

  const fileSize = (bytes) => bytes < 1024 ? `${bytes} B`
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

  function showChosenFile(file) {
    $('fileSelectedName').textContent = file ? file.name : '';
    $('fileSelectedSize').textContent = file ? fileSize(file.size) : '';
    $('fileSelectedInfo').hidden = !file;
    $('fileDropZone').hidden = !!file;
  }

  function renderShare() {
    const wrap = $('fileShareChips');
    const typer = $('fileShareTyper');
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
        renderShare();
      });
      chip.appendChild(remove);
      wrap.insertBefore(chip, typer);
    });
    const count = allowedUsers.length;
    setChip($('fchip-share'), count ? `${count} ${count === 1 ? 'person' : 'people'}` : '', count > 0);
  }

  async function submitFile() {
    const file = fileInput.files[0];
    if (!file) return showError('Choose a file to upload.');
    const data = new FormData();
    data.append('file', file);
    if (teamId()) data.append('teamId', teamId());
    if (slugOf('fileSlug')) data.append('slug', slugOf('fileSlug'));
    if (valueOf('fileExpiresAt')) data.append('expiresAt', endOfDay(valueOf('fileExpiresAt')));
    if (valueOf('fileMaxDownloads')) data.append('maxDownloads', valueOf('fileMaxDownloads'));
    if (valueOf('filePassword')) data.append('password', valueOf('filePassword'));
    if (valueOf('fileTags')) data.append('tags', valueOf('fileTags'));
    if (valueOf('fileActivateAt')) data.append('activateAt', localToUtc(valueOf('fileActivateAt')));
    if (valueOf('fileDeactivateAt')) data.append('deactivateAt', localToUtc(valueOf('fileDeactivateAt')));
    data.append('allowedUsers', JSON.stringify(allowedUsers.map(user => user.id)));
    data.append('sharingMode', allowedUsers.length ? 'restricted' : 'public');

    const progress = $('fileProgressWrap');
    const fill = $('fileProgressFill');
    busy(true, 'Uploading…');
    progress.classList.add('visible');

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      fill.style.width = `${percent}%`;
      $('fileProgressLabel').textContent = `${percent}% uploaded`;
    });
    const done = () => {
      busy(false);
      progress.classList.remove('visible');
      fill.style.width = '0%';
    };
    xhr.addEventListener('load', () => {
      done();
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch (_) { body = {}; }
      if (xhr.status === 200 && body.success) {
        showSuccess('Your file is ready to share', body.fileUrl);
        resetSection('file');
        showChosenFile(null);
        allowedUsers = [];
        renderShare();
      } else {
        showError(body.error || 'The upload failed. Please try again.');
      }
    });
    xhr.addEventListener('error', () => {
      done();
      showError('Network error. Please try again.');
    });
    xhr.open('POST', '/api/files/upload');
    xhr.send(data);
  }

  if (fileInput) {
    const zone = $('fileDropZone');
    fileInput.addEventListener('change', () => showChosenFile(fileInput.files[0]));
    zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('dragover');
      const file = event.dataTransfer.files[0];
      if (!file) return;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      showChosenFile(file);
    });
    $('fileSelectedInfo').addEventListener('click', () => fileInput.click());

    const typer = $('fileShareTyper');
    $('fileShareChips').addEventListener('click', () => typer.focus());
    typer.addEventListener('keydown', async (event) => {
      if (event.key !== 'Enter' && event.key !== ',') return;
      event.preventDefault();
      const error = $('fileShareError');
      const username = typer.value.trim().replace(/^@/, '');
      if (!username) return;
      try {
        const response = await fetch(`/api/users/lookup?username=${encodeURIComponent(username)}`);
        const data = await response.json();
        if (!data.found) throw new Error(`There is no user called ${username}.`);
        if (!allowedUsers.some(user => user.id === data.id)) allowedUsers.push({ id: data.id, username: data.username });
        typer.value = '';
        error.hidden = true;
        renderShare();
      } catch (lookupError) {
        error.textContent = lookupError.message;
        error.hidden = false;
      }
    });
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  form.addEventListener('submit', (event) => {
    if (mode === 'paste') { event.preventDefault(); return submitPaste(); }
    if (mode === 'bundle') { event.preventDefault(); return submitBundle(); }
    if (mode === 'file') { event.preventDefault(); return submitFile(); }
    // Links: a normal form post; the schedule goes as UTC
    form.querySelectorAll('[data-utc]').forEach(input => { $(input.dataset.utc).value = localToUtc(input.value); });
  });
})();
