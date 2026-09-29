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
function renderIconHTML(name, size) {
  if (!isDashboardIcon(name)) {
    return `<ion-icon name="${name || 'link-outline'}"></ion-icon>`;
  }
  const themedSrc = getDashboardIconURL(name);
  const fallbackSrc = `${DASHBOARD_ICONS_CDN}/${name}.svg`;
  return `<img src="${themedSrc}" data-icon="${name}" style="width:${size};height:${size};" alt="" onerror="this.onerror=null;this.src='${fallbackSrc}'">`;
}

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
        ${renderIconHTML(icon.name, '2rem')}
        <span>${icon.label}</span>
      </div>
    `).join('');
  }

  const cached = getCachedDashboardIcons();
  if (cached) {
    populateGrid(cached);
  } else {
    grid.innerHTML = '<div style="text-align:center;padding:2rem;grid-column:1/-1;color:var(--muted-foreground);">Loading icons…</div>';
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

    item.style.display = matches ? 'flex' : 'none';
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
    slot.innerHTML = renderIconHTML(iconName, '2rem');
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

// Make functions global for inline onclick handlers
window.closeIconPicker = closeIconPicker;

// Update all dashboard icon images when the site theme changes
new MutationObserver(() => {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const suffix = theme === 'dark' ? '-light' : '-dark';
  document.querySelectorAll('img[data-icon]').forEach(img => {
    const name = img.dataset.icon;
    const fallbackSrc = `${DASHBOARD_ICONS_CDN}/${name}.svg`;
    img.onerror = function() { this.onerror = null; this.src = fallbackSrc; };
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
    gradientPickers.style.display = e.target.value === 'gradient' ? 'block' : 'none';
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
      hasUnsavedChanges = false;  // Clear unsaved changes flag
      alert('Bio page updated successfully!');
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (error) {
    console.error('Save error:', error);
    alert('Failed to save bio page');
  }
});

// Add social link
document.getElementById('addSocialLinkBtn')?.addEventListener('click', () => {
  const container = document.getElementById('socialLinksContainer');
  const index = document.querySelectorAll('.social-link-item').length;

  // Remove "no links" message if exists
  const noLinksMsg = container.querySelector('p');
  if (noLinksMsg) {
    noLinksMsg.remove();
  }

  const itemHtml = `
    <div class="social-link-item" data-index="${index}" style="margin-bottom: 1rem; padding: 1rem; background: var(--secondary); border-radius: 8px;">
      <div style="display: flex; gap: 1rem; align-items: start;">
        <div class="form-group" style="flex: 0 0 auto; margin-bottom: 0;">
          <label class="form-label">Icon</label>
          <button type="button" class="icon-picker-trigger" data-icon-value="link-outline">
            <span class="icon-preview-slot">
              <ion-icon name="link-outline" class="social-icon-preview" style="font-size: 2rem;"></ion-icon>
            </span>
            <ion-icon name="chevron-down-outline" class="chevron-icon"></ion-icon>
          </button>
          <input type="hidden" class="social-icon" value="link-outline">
        </div>
        <div class="form-group" style="flex: 1; margin-bottom: 0;">
          <label class="form-label">Platform (optional)</label>
          <input
            type="text"
            class="form-input social-platform"
            placeholder="e.g., Twitter, Instagram (optional)"
          >
        </div>
        <div class="form-group" style="flex: 2; margin-bottom: 0;">
          <label class="form-label">URL</label>
          <input
            type="url"
            class="form-input social-url"
            placeholder="https://..."
          >
        </div>
        <button
          type="button"
          class="btn-icon-only remove-social-link"
          style="margin-top: 1.75rem;"
          title="Remove"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', itemHtml);
});

// Remove social link (event delegation)
document.getElementById('socialLinksContainer')?.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.remove-social-link');
  if (removeBtn) {
    const item = removeBtn.closest('.social-link-item');
    item.remove();
  }
});

// Toggle URL on bio page
async function toggleUrlOnBioPage(urlId, isChecked) {
  try {
    const response = await fetch(`/api/bio/urls/${urlId}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();

    if (!response.ok) {
      alert(`Error: ${data.error}`);
      // Revert checkbox
      const checkbox = document.getElementById(`url-${urlId}`);
      if (checkbox) checkbox.checked = !isChecked;
    }
  } catch (error) {
    console.error('Toggle error:', error);
    alert('Failed to update bio page');
    // Revert checkbox
    const checkbox = document.getElementById(`url-${urlId}`);
    if (checkbox) checkbox.checked = !isChecked;
  }
}

// Make function global for onclick handler
window.toggleUrlOnBioPage = toggleUrlOnBioPage;

// ============================================================================
// UNSAVED CHANGES WARNING
// ============================================================================

// Track changes to any form field
function markAsChanged() {
  hasUnsavedChanges = true;
}

// Listen for changes on all form inputs
document.addEventListener('input', (e) => {
  if (e.target.matches('.form-input, .social-icon, .social-platform, .social-url')) {
    markAsChanged();
  }
});

// Listen for theme changes
document.getElementById('theme')?.addEventListener('change', markAsChanged);

// Mark as changed when adding/removing social links
const originalAddListener = document.getElementById('addSocialLinkBtn');
if (originalAddListener) {
  originalAddListener.addEventListener('click', markAsChanged);
}

// Mark as changed when removing social links
document.getElementById('socialLinksContainer')?.addEventListener('click', (e) => {
  if (e.target.closest('.remove-social-link')) {
    markAsChanged();
  }
});

// Mark as changed when toggling URLs
const originalToggleUrlOnBioPage = window.toggleUrlOnBioPage;
window.toggleUrlOnBioPage = function(...args) {
  markAsChanged();
  return originalToggleUrlOnBioPage.apply(this, args);
};

// Mark as changed when selecting icons
document.getElementById('iconPickerGrid')?.addEventListener('click', markAsChanged);

// Warn before leaving page if there are unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

// Warn when clicking navigation links
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');

  // Skip if no unsaved changes or clicking same page links
  if (!link || !hasUnsavedChanges) return;

  // Skip if it's a target="_blank" link
  if (link.target === '_blank') return;

  // Skip if it's the View Bio Page button
  if (link.href.includes('/bio/')) return;

  // Check if it's an internal navigation link
  const currentDomain = window.location.origin;
  if (link.href.startsWith(currentDomain) || link.href.startsWith('/')) {
    const userConfirmed = confirm('You have unsaved changes. Are you sure you want to leave this page?');
    if (!userConfirmed) {
      e.preventDefault();
    }
  }
});
