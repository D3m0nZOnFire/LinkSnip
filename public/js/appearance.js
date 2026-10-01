/**
 * Admin → Appearance (views/admin-appearance.ejs): live palette preview, saving, logo and favicon uploads.
 */
(function () {
  'use strict';

  const form = document.getElementById('appearanceForm');
  if (!form) return;
  const root = document.documentElement;
  const status = document.getElementById('appearanceStatus');
  const errors = document.getElementById('appearanceErrors');
  let previewed = [];

  const currentMode = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

  // Show the picked palette of the mode the page is in, on top of /theme.css
  function preview() {
    previewed.forEach(name => root.style.removeProperty(name));
    previewed = [];
    const picked = form.querySelector(`input[data-mode="${currentMode()}"]:checked`);
    if (!picked) return;
    const tokens = JSON.parse(picked.dataset.tokens);
    for (const [name, value] of Object.entries(tokens)) {
      root.style.setProperty(name, value);
      previewed.push(name);
    }
  }

  form.addEventListener('change', (event) => {
    if (event.target.matches('input[type="radio"]')) {
      status.textContent = 'Not saved yet';
      preview();
    }
  });
  // The theme toggle switches mode: show that mode's pick
  new MutationObserver(preview).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('saveAppearance');
    const data = new FormData(form);
    errors.innerHTML = '';
    status.textContent = '';
    button.disabled = true;
    try {
      const response = await fetch('/api/admin/appearance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          tagline: data.get('tagline'),
          darkPalette: data.get('darkPalette'),
          lightPalette: data.get('lightPalette')
        })
      });
      const result = await response.json();
      if (!response.ok) {
        for (const message of result.errors || ['Could not save']) {
          const li = document.createElement('li');
          li.textContent = message;
          errors.appendChild(li);
        }
        return;
      }
      // Load the saved palettes, then drop the preview
      const sheet = document.querySelector('link[href^="/theme.css"]');
      if (sheet) sheet.href = result.themeUrl;
      previewed.forEach(name => root.style.removeProperty(name));
      previewed = [];
      document.querySelectorAll('.brand-name').forEach(el => { el.textContent = data.get('name').trim(); });
      status.textContent = 'Saved';
      showToast('Appearance saved');
    } catch (error) {
      showToast('Could not save. Check your connection.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  // The new image everywhere on this page: its preview, the header logo, the tab icon
  function showAsset(asset, url) {
    const slot = form.querySelector(`.asset-slot[data-asset="${asset}"]`);
    slot.querySelector('.asset-preview img').src = url;
    if (asset === 'logo') document.querySelectorAll('.brand-logo').forEach(img => { img.src = url; });
    // Without a favicon of its own the site uses the logo
    const ownFavicon = !form.querySelector('[data-reset="favicon"]').hidden;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && (asset === 'favicon' || !ownFavicon)) icon.href = url;
  }

  form.querySelectorAll('[data-upload]').forEach(input => {
    input.addEventListener('change', async () => {
      const asset = input.dataset.upload;
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const body = new FormData();
      body.append('file', file);
      try {
        const response = await fetch(`/api/admin/branding/${asset}`, { method: 'POST', body });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return showToast(result.error || 'Upload failed', 'error');
        showAsset(asset, result.url);
        form.querySelector(`[data-reset="${asset}"]`).hidden = false;
        showToast(asset === 'logo' ? 'Logo updated' : 'Favicon updated');
      } catch (error) {
        showToast('Upload failed. Check your connection.', 'error');
      }
    });
  });

  form.querySelectorAll('[data-reset]').forEach(button => {
    button.addEventListener('click', async () => {
      const asset = button.dataset.reset;
      try {
        const response = await fetch(`/api/admin/branding/${asset}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) return showToast(result.error || 'Could not reset', 'error');
        button.hidden = true;
        showAsset(asset, result.url);
        showToast(asset === 'logo' ? 'Default logo restored' : 'Favicon removed');
      } catch (error) {
        showToast('Could not reset. Check your connection.', 'error');
      }
    });
  });
})();
