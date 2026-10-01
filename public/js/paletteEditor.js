/**
 * Admin → Appearance: the palette editor (new, edit, delete custom palettes). The preview asks the server
 * (POST /api/admin/palettes/preview) for the theme colors, so it shows exactly what /theme.css will.
 */
(function () {
  'use strict';

  const modal = document.getElementById('paletteEditor');
  const form = document.getElementById('paletteForm');
  if (!modal || !form) return;

  const palettes = JSON.parse(document.getElementById('paletteData').textContent);
  const KEYS = ['background', 'foreground', 'accent', 'red', 'yellow'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const title = document.getElementById('paletteEditorTitle');
  const nameInput = document.getElementById('paletteName');
  const baseSelect = document.getElementById('paletteBase');
  const startFrom = document.getElementById('paletteStartFrom');
  const live = document.getElementById('paletteLive');
  const adjustments = document.getElementById('paletteAdjustments');
  const errors = document.getElementById('paletteErrors');
  const deleteButton = document.getElementById('paletteDelete');
  const saveButton = document.getElementById('paletteSave');
  let editing = null; // id of the custom palette being edited, null for a new one
  let previewTimer = null;
  let previewRequest = 0;

  const mode = () => (form.querySelector('input[name="mode"]:checked') || {}).value;
  const colors = () => Object.fromEntries(KEYS.map(k => [k, form.querySelector(`[data-hex="${k}"]`).value.trim()]));
  const byId = (id) => palettes.find(p => p.id === id);

  function setColor(key, value) {
    const hex = form.querySelector(`[data-hex="${key}"]`);
    hex.value = value;
    hex.classList.remove('invalid');
    form.querySelector(`[data-color="${key}"]`).value = value;
  }

  function setColors(values) {
    for (const key of KEYS) setColor(key, values[key]);
  }

  function setMode(value) {
    form.querySelectorAll('input[name="mode"]').forEach(r => { r.checked = r.value === value; });
  }

  // "Start from": every palette, this mode's first
  function fillBaseSelect(selected) {
    baseSelect.innerHTML = '';
    for (const group of [mode(), mode() === 'dark' ? 'light' : 'dark']) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group === 'dark' ? 'Dark palettes' : 'Light palettes';
      for (const p of palettes.filter(x => x.mode === group)) {
        const option = new Option(p.name, p.id, false, p.id === selected);
        optgroup.appendChild(option);
      }
      baseSelect.appendChild(optgroup);
    }
  }

  function showErrors(list) {
    errors.innerHTML = '';
    for (const message of list) {
      const li = document.createElement('li');
      li.textContent = message;
      errors.appendChild(li);
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 150);
  }

  async function preview() {
    const values = colors();
    if (!mode() || !KEYS.every(k => HEX.test(values[k]))) return;
    const ticket = ++previewRequest;
    try {
      const response = await fetch('/api/admin/palettes/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode(), colors: values })
      });
      const result = await response.json();
      if (ticket !== previewRequest || !response.ok) return;
      for (const [name, value] of Object.entries(result.tokens)) live.style.setProperty(name, value);
      adjustments.innerHTML = '';
      for (const note of result.adjustments) {
        const li = document.createElement('li');
        const swatch = document.createElement('span');
        swatch.className = 'adjust-swatch';
        swatch.style.background = note.to;
        const text = document.createElement('span');
        text.textContent = note.message;
        // Take the color that is shown anyway, and the note goes away
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'btn btn-small btn-secondary adjust-use';
        use.textContent = `Use ${note.to}`;
        use.addEventListener('click', () => {
          setColor(note.key, note.to);
          preview();
        });
        text.appendChild(use);
        li.append(swatch, text);
        adjustments.appendChild(li);
      }
    } catch (_) { /* offline: keep the last preview */ }
  }

  function open({ id = null, newMode = 'dark' } = {}) {
    editing = id;
    showErrors([]);
    const palette = id ? byId(id) : null;
    if (palette) {
      title.textContent = `Edit ${palette.name}`;
      nameInput.value = palette.name;
      setMode(palette.mode);
      setColors(palette.colors);
      startFrom.hidden = true;
      deleteButton.hidden = false;
    } else {
      title.textContent = `New ${newMode} palette`;
      nameInput.value = '';
      setMode(newMode);
      const base = palettes.find(p => p.mode === newMode);
      fillBaseSelect(base.id);
      setColors(base.colors);
      startFrom.hidden = false;
      deleteButton.hidden = true;
    }
    openModal('paletteEditor');
    preview();
    nameInput.focus();
  }

  // Opening
  document.querySelectorAll('[data-new]').forEach(button => {
    button.addEventListener('click', () => open({ newMode: button.dataset.new }));
  });
  document.querySelectorAll('[data-edit]').forEach(button => {
    button.addEventListener('click', (event) => {
      event.preventDefault(); // inside the card's <label>: don't select the palette
      event.stopPropagation();
      open({ id: button.dataset.edit });
    });
  });

  // Closing
  modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal('paletteEditor')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('active')) closeModal('paletteEditor');
  });

  // Editing
  form.addEventListener('input', (event) => {
    const picker = event.target.dataset.color;
    const hex = event.target.dataset.hex;
    if (picker) form.querySelector(`[data-hex="${picker}"]`).value = event.target.value;
    if (hex) {
      let value = event.target.value.trim();
      if (/^[0-9a-f]{6}$/i.test(value)) value = `#${value}`;
      event.target.classList.toggle('invalid', !HEX.test(value));
      if (HEX.test(value)) form.querySelector(`[data-color="${hex}"]`).value = value.toLowerCase();
    }
    if (picker || hex) schedulePreview();
  });
  form.addEventListener('change', (event) => {
    if (event.target.name === 'mode') {
      if (!editing) fillBaseSelect(baseSelect.value);
      schedulePreview();
    }
  });
  baseSelect.addEventListener('change', () => {
    const base = byId(baseSelect.value);
    if (!base) return;
    setColors(base.colors);
    schedulePreview();
  });

  // Saving
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = colors();
    for (const key of KEYS) if (/^[0-9a-f]{6}$/i.test(values[key])) values[key] = `#${values[key]}`;
    saveButton.disabled = true;
    try {
      const response = await fetch(editing ? `/api/admin/palettes/${encodeURIComponent(editing)}` : '/api/admin/palettes', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.value, mode: mode(), colors: values })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return showErrors(result.errors || ['Could not save the palette.']);
      window.location.reload();
    } catch (_) {
      showErrors(['Could not save. Check your connection.']);
    } finally {
      saveButton.disabled = false;
    }
  });

  deleteButton.addEventListener('click', async () => {
    const palette = byId(editing);
    if (!palette || !confirm(`Delete the palette "${palette.name}"? Its file is removed.`)) return;
    try {
      const response = await fetch(`/api/admin/palettes/${encodeURIComponent(editing)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return showErrors(result.errors || ['Could not delete the palette.']);
      window.location.reload();
    } catch (_) {
      showErrors(['Could not delete. Check your connection.']);
    }
  });
})();
