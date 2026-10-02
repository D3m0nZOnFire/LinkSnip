// ============================================================================
// GLOBAL STATE
// ============================================================================

let hasUnsavedChanges = false;

// ============================================================================
// ICON PICKER
// ============================================================================

// Utility icons from Ionicons (identified by -outline suffix)
// Brand icons are fetched dynamically from Dashboard Icons
const UTILITY_ICONS = [
  { name: 'mail-outline', label: 'Email' },
  { name: 'call-outline', label: 'Phone' },
  { name: 'chatbubble-outline', label: 'Chat' },
  { name: 'globe-outline', label: 'Website' },
  { name: 'link-outline', label: 'Link' },
  { name: 'location-outline', label: 'Location' },
  { name: 'calendar-outline', label: 'Calendar' },
  { name: 'camera-outline', label: 'Camera' },
  { name: 'videocam-outline', label: 'Video' },
  { name: 'musical-notes-outline', label: 'Music' },
  { name: 'newspaper-outline', label: 'News' },
  { name: 'book-outline', label: 'Book' },
  { name: 'briefcase-outline', label: 'Work' },
  { name: 'heart-outline', label: 'Heart' },
  { name: 'star-outline', label: 'Star' },
  { name: 'gift-outline', label: 'Gift' },
  { name: 'cart-outline', label: 'Shop' },
  { name: 'cafe-outline', label: 'Coffee' },
  { name: 'restaurant-outline', label: 'Restaurant' },
  { name: 'game-controller-outline', label: 'Gaming' },
];

const DASHBOARD_ICONS_CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';
const DASHBOARD_ICONS_CACHE_KEY = 'dashboard-icons-cache';
const DASHBOARD_ICONS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Returns true for Dashboard Icons (brand icons), false for Ionicons (utility icons)
function isDashboardIcon(name) {
  return name && !name.endsWith('-outline') && !name.startsWith('logo-');
}

// Returns the themed CDN URL for a Dashboard Icon
function getDashboardIconURL(name) {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const suffix = theme === 'dark' ? '-light' : '-dark';
  return `${DASHBOARD_ICONS_CDN}/${name}${suffix}.svg`;
}

// Renders the correct HTML for an icon (Dashboard Icons img or Ionicons ion-icon)
function renderIconHTML(name) {
  if (!isDashboardIcon(name)) {
    return `<ion-icon name="${name || 'link-outline'}" class="social-icon-preview"></ion-icon>`;
  }
  return `<img src="${getDashboardIconURL(name)}" data-icon="${name}" class="social-icon-preview" alt="">`;
}

// A Dashboard Icon without a themed variant: fall back to the plain one, once (error events don't bubble: capture)
document.addEventListener('error', (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.icon || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = `${DASHBOARD_ICONS_CDN}/${img.dataset.icon}.svg`;
}, true);

// Convert a kebab-case icon filename to a human-readable label
function nameToLabel(name) {
  return name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Get cached Dashboard Icons list from localStorage
function getCachedDashboardIcons() {
  try {
    const raw = localStorage.getItem(DASHBOARD_ICONS_CACHE_KEY);
    if (!raw) return null;
    const { timestamp, icons } = JSON.parse(raw);
    if (Date.now() - timestamp > DASHBOARD_ICONS_CACHE_TTL) return null;
    return icons;
  } catch {
    return null;
  }
}

// Save Dashboard Icons list to localStorage
function setCachedDashboardIcons(icons) {
  try {
    localStorage.setItem(DASHBOARD_ICONS_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), icons }));
  } catch {
    // localStorage unavailable, silently ignore
  }
}

// Fetch all Dashboard Icons from GitHub API (2 requests: main tree → svg tree)
async function fetchDashboardIcons() {
  const cached = getCachedDashboardIcons();
  if (cached) return cached;

  // Step 1: get root tree to find the svg/ directory SHA
  const rootResp = await fetch('https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/main');
  if (!rootResp.ok) throw new Error('GitHub API error');
  const rootTree = await rootResp.json();

  const svgDir = rootTree.tree.find(item => item.path === 'svg' && item.type === 'tree');
  if (!svgDir) throw new Error('svg/ directory not found');

  // Step 2: get all files in svg/
  const svgResp = await fetch(`https://api.github.com/repos/homarr-labs/dashboard-icons/git/trees/${svgDir.sha}`);
  if (!svgResp.ok) throw new Error('GitHub API error');
  const svgTree = await svgResp.json();

  // Parse: only base icons (exclude -light, -dark, -wordmark variants)
  const icons = svgTree.tree
    .filter(item => item.path.endsWith('.svg')
      && !item.path.endsWith('-light.svg')
      && !item.path.endsWith('-dark.svg')
      && !item.path.endsWith('-wordmark.svg'))
    .map(item => {
      const name = item.path.replace('.svg', '');
      return { name, label: nameToLabel(name) };
    });

  setCachedDashboardIcons(icons);
  return icons;
}

let currentIconPickerTarget = null;

// Open icon picker
function openIconPicker(triggerButton) {
  currentIconPickerTarget = triggerButton;
  const modal = document.getElementById('iconPickerModal');
  const grid = document.getElementById('iconPickerGrid');
  const currentIcon = triggerButton.dataset.iconValue || 'link-outline';

  modal.classList.add('active');

  function populateGrid(dashboardIcons) {
    const allIcons = [...dashboardIcons, ...UTILITY_ICONS];
    grid.innerHTML = allIcons.map(icon => `
      <div class="icon-picker-item ${icon.name === currentIcon ? 'selected' : ''}" data-icon="${icon.name}">
        ${renderIconHTML(icon.name)}
        <span>${icon.label}</span>
      </div>
    `).join('');
  }

  const cached = getCachedDashboardIcons();
  if (cached) {
    populateGrid(cached);
  } else {
    grid.innerHTML = '<div class="icon-picker-loading">Loading icons…</div>';
    fetchDashboardIcons()
      .then(populateGrid)
      .catch(() => populateGrid([]));
  }
}

// Close icon picker
function closeIconPicker() {
  const modal = document.getElementById('iconPickerModal');
  modal.classList.remove('active');
  currentIconPickerTarget = null;
  document.getElementById('iconSearchInput').value = '';
  filterIcons('');
}

// Filter icons based on search
function filterIcons(searchTerm) {
  const grid = document.getElementById('iconPickerGrid');
  const items = grid.querySelectorAll('.icon-picker-item');

  items.forEach(item => {
    const iconName = item.dataset.icon;
    const iconLabel = item.querySelector('span').textContent;
    const matches = iconName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                   iconLabel.toLowerCase().includes(searchTerm.toLowerCase());

    item.hidden = !matches;
  });
}

// Search input event
document.getElementById('iconSearchInput')?.addEventListener('input', (e) => {
  filterIcons(e.target.value);
});

// Click outside modal to close
document.getElementById('iconPickerModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'iconPickerModal') {
    closeIconPicker();
  }
});

// Select icon from grid
document.getElementById('iconPickerGrid')?.addEventListener('click', (e) => {
  const item = e.target.closest('.icon-picker-item');
  if (!item || !currentIconPickerTarget) return;

  const iconName = item.dataset.icon;

  // Update the trigger button
  const slot = currentIconPickerTarget.querySelector('.icon-preview-slot');
  const hiddenInput = currentIconPickerTarget.parentElement.querySelector('.social-icon');

  if (slot) {
    slot.innerHTML = renderIconHTML(iconName);
  }

  if (hiddenInput) {
    hiddenInput.value = iconName;
  }

  currentIconPickerTarget.dataset.iconValue = iconName;

  closeIconPicker();
});

// Attach click handlers to icon picker triggers (event delegation)
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.icon-picker-trigger');
  if (trigger) {
    e.preventDefault();
    openIconPicker(trigger);
  }
});

document.getElementById('iconPickerClose')?.addEventListener('click', closeIconPicker);

// Update all dashboard icon images when the site theme changes
new MutationObserver(() => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const suffix = theme === 'dark' ? '-light' : '-dark';
  document.querySelectorAll('img[data-icon]').forEach(img => {
    const name = img.dataset.icon;
    delete img.dataset.fallback;
    img.src = `${DASHBOARD_ICONS_CDN}/${name}${suffix}.svg`;
  });
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ============================================================================
// BIO SETTINGS
// ============================================================================

// Show/hide gradient color pickers based on theme selection
document.getElementById('theme')?.addEventListener('change', (e) => {
  const gradientPickers = document.getElementById('gradientColorPickers');
  if (gradientPickers) {
    gradientPickers.hidden = e.target.value !== 'gradient';
  }
});

// Sync color picker with hex input for gradient start
document.getElementById('gradientStart')?.addEventListener('input', (e) => {
  const hexInput = document.getElementById('gradientStartHex');
  if (hexInput) {
    hexInput.value = e.target.value.toUpperCase();
  }
});

document.getElementById('gradientStartHex')?.addEventListener('input', (e) => {
  const colorPicker = document.getElementById('gradientStart');
  if (colorPicker && /^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
    colorPicker.value = e.target.value;
  }
});

// Sync color picker with hex input for gradient end
document.getElementById('gradientEnd')?.addEventListener('input', (e) => {
  const hexInput = document.getElementById('gradientEndHex');
  if (hexInput) {
    hexInput.value = e.target.value.toUpperCase();
  }
});

document.getElementById('gradientEndHex')?.addEventListener('input', (e) => {
  const colorPicker = document.getElementById('gradientEnd');
  if (colorPicker && /^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
    colorPicker.value = e.target.value;
  }
});

// Save bio information
document.getElementById('saveBioBtn')?.addEventListener('click', async () => {
  const displayName = document.getElementById('displayName').value.trim();
  const bio = document.getElementById('bio').value.trim();
  const theme = document.getElementById('theme').value;
  const gradientStart = document.getElementById('gradientStart')?.value;
  const gradientEnd = document.getElementById('gradientEnd')?.value;

  // Collect social links
  const socialLinks = [];
  document.querySelectorAll('.social-link-item').forEach(item => {
    const icon = item.querySelector('.social-icon').value;
    const platform = item.querySelector('.social-platform').value.trim();
    const url = item.querySelector('.social-url').value.trim();

    // Only URL is required, platform is optional
    if (url) {
      socialLinks.push({ icon, platform: platform || null, url });
    }
  });

  try {
    const body = {
      displayName,
      bio: bio || null,
      theme,
      socialLinks
    };

    // Only include gradient colors if gradient theme is selected
    if (theme === 'gradient') {
      body.gradientStart = gradientStart;
      body.gradientEnd = gradientEnd;
    }

    const response = await fetch('/api/bio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok) {
      setUnsaved(false);
      showToast('Bio page saved');
    } else {
      showToast(data.error || 'Could not save the bio page', 'error');
    }
  } catch (error) {
    console.error('Save error:', error);
    showToast('Could not save the bio page', 'error');
  }
});

// Add social link
document.getElementById('addSocialLinkBtn')?.addEventListener('click', () => {
  const container = document.getElementById('socialLinksContainer');
  const empty = container.querySelector('.social-empty');
  if (empty) empty.hidden = true;

  const item = document.createElement('div');
  item.className = 'social-link-item';
  item.dataset.index = container.querySelectorAll('.social-link-item').length;
  item.innerHTML = `
    <button type="button" class="icon-picker-trigger" data-icon-value="link-outline" aria-label="Choose an icon">
      <span class="icon-preview-slot"><ion-icon name="link-outline" class="social-icon-preview"></ion-icon></span>
      <ion-icon name="chevron-down-outline" class="chevron-icon"></ion-icon>
    </button>
    <input type="hidden" class="social-icon" value="link-outline">
    <input type="text" class="form-input social-platform" placeholder="Name (optional)" aria-label="Name">
    <input type="url" class="form-input social-url" placeholder="https://…" aria-label="Address">
    <button type="button" class="icon-btn danger remove-social-link" title="Remove" aria-label="Remove this link">✕</button>`;
  container.appendChild(item);
  item.querySelector('.social-url').focus();
  setUnsaved(true);
});

// Remove social link (event delegation)
document.getElementById('socialLinksContainer')?.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.remove-social-link');
  if (!removeBtn) return;
  removeBtn.closest('.social-link-item').remove();
  const container = document.getElementById('socialLinksContainer');
  const empty = container.querySelector('.social-empty');
  if (empty) empty.hidden = container.querySelectorAll('.social-link-item').length > 0;
  setUnsaved(true);
});

// ============================================================================
// LINKS ON THE PAGE (saved right away, one click at a time)
// ============================================================================

function updateLinkCount() {
  const count = document.getElementById('bioLinkCount');
  const boxes = document.querySelectorAll('.link-picker input[data-url-id]');
  if (count) count.textContent = `${[...boxes].filter(box => box.checked).length} of ${boxes.length}`;
}

document.addEventListener('change', async (e) => {
  const box = e.target.closest('.link-picker input[data-url-id]');
  if (!box) return;
  box.disabled = true;
  try {
    const response = await fetch(`/api/bio/urls/${box.dataset.urlId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    showToast(box.checked ? 'Shown on your page' : 'Removed from your page');
  } catch (error) {
    box.checked = !box.checked;
    showToast(error.message || 'Could not update your page', 'error');
  } finally {
    box.disabled = false;
    updateLinkCount();
  }
});

// ============================================================================
// UNSAVED CHANGES (profile and social links; the save bar shows the state)
// ============================================================================

function setUnsaved(unsaved) {
  hasUnsavedChanges = unsaved;
  const bar = document.getElementById('saveBar');
  const status = document.getElementById('saveStatus');
  if (bar) bar.dataset.state = unsaved ? 'dirty' : 'clean';
  if (status) status.textContent = unsaved ? 'Unsaved changes' : 'No unsaved changes';
}

document.addEventListener('input', (e) => {
  if (e.target.closest('.bio-main') && e.target.matches('input, textarea, select')) setUnsaved(true);
});
document.getElementById('theme')?.addEventListener('change', () => setUnsaved(true));
document.getElementById('iconPickerGrid')?.addEventListener('click', (e) => {
  if (e.target.closest('.icon-picker-item')) setUnsaved(true);
});

// Warn before leaving the page with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsavedChanges) return;
  e.preventDefault();
  e.returnValue = '';
});
