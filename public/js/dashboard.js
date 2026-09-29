/**
 * Dashboard Actions (Edit, Delete, etc.)
 */

// Global variable to store current editing URL ID
let currentEditingUrlId = null;

// Global variable to store tag selector instance
let editTagSelector = null;

// ========================================
// Bulk Selection
// ========================================

const selectedUrls = new Set();
let selectionModeActive = false;

function toggleSelectionMode() {
  selectionModeActive = !selectionModeActive;
  const checkboxes = document.querySelectorAll('.url-select-checkbox');
  const bar = document.getElementById('bulkActionsBar');
  const btn = document.getElementById('toggleSelectBtn');

  if (selectionModeActive) {
    checkboxes.forEach(cb => cb.style.display = 'inline-block');
    bar.style.display = 'block';
    if (btn) btn.textContent = 'Cancel Select';
    document.body.style.paddingBottom = '70px';
  } else {
    exitSelectionMode();
  }
}

function exitSelectionMode() {
  selectionModeActive = false;
  selectedUrls.clear();
  document.querySelectorAll('.url-select-checkbox').forEach(cb => {
    cb.style.display = 'none';
    cb.checked = false;
  });
  const selectAll = document.getElementById('selectAllCheckbox');
  if (selectAll) selectAll.checked = false;
  const bar = document.getElementById('bulkActionsBar');
  if (bar) bar.style.display = 'none';
  const btn = document.getElementById('toggleSelectBtn');
  if (btn) btn.textContent = 'Select';
  document.body.style.paddingBottom = '';
  updateBulkBar();
}

function toggleUrlSelection(id, checkbox) {
  if (checkbox.checked) {
    selectedUrls.add(id);
  } else {
    selectedUrls.delete(id);
  }
  updateBulkBar();
}

function selectAll(checked) {
  document.querySelectorAll('.url-select-checkbox').forEach(cb => {
    const card = cb.closest('[data-url-id]');
    if (!card || card.style.display === 'none') return;
    cb.checked = checked;
    const id = parseInt(card.getAttribute('data-url-id'));
    if (checked) { selectedUrls.add(id); } else { selectedUrls.delete(id); }
  });
  updateBulkBar();
}

function updateBulkBar() {
  const count = selectedUrls.size;
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = count + ' selected';
  const deleteBtn = document.getElementById('bulkDeleteBtn');
  if (deleteBtn) deleteBtn.disabled = count === 0;
}

async function bulkDelete() {
  const count = selectedUrls.size;
  if (count === 0) return;
  const confirmed = await confirmAction(
    `Delete ${count} URL${count > 1 ? 's' : ''}? This cannot be undone.`,
    'Delete Selected URLs'
  );
  if (!confirmed) return;

  const deleteBtn = document.getElementById('bulkDeleteBtn');
  setButtonLoading(deleteBtn, true);
  try {
    const result = await apiRequest('/api/urls/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: Array.from(selectedUrls) })
    });
    showToast(`Deleted ${result.deleted} URL${result.deleted !== 1 ? 's' : ''} successfully!`);
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showToast('Error deleting URLs: ' + error.message, 'error');
    setButtonLoading(deleteBtn, false);
  }
}

// Open edit modal and populate with current data
async function editUrl(id) {
  currentEditingUrlId = id;

  try {
    // Fetch current URL data
    const url = await apiRequest(`/api/urls/${id}`);

    // Populate form fields
    document.getElementById('editLongUrl').value = url.longUrl;
    document.getElementById('editCustomSlug').value = url.slug;
    document.getElementById('editMaxUses').value = url.maxUses || '';

    // Populate tags using tag selector
    if (editTagSelector) {
      const tagNames = url.tags && url.tags.length > 0 ? url.tags.map(t => t.name).join(',') : '';
      editTagSelector.setValue(tagNames);
    }

    // Calculate days until expiration
    if (url.expiresAt) {
      const now = new Date();
      const expiry = new Date(url.expiresAt);
      const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      document.getElementById('editExpirationDays').value = daysUntilExpiry > 0 ? daysUntilExpiry : '';
    } else {
      document.getElementById('editExpirationDays').value = '';
    }

    // Populate scheduling fields
    // activateAt is stored as "2025-11-21T21:16:00.000Z" but we want "2025-11-21T21:16" for input
    if (url.activateAt) {
      document.getElementById('editActivateDateTime').value = url.activateAt.substring(0, 16);
    } else {
      document.getElementById('editActivateDateTime').value = '';
    }

    if (url.deactivateAt) {
      document.getElementById('editDeactivateDateTime').value = url.deactivateAt.substring(0, 16);
    } else {
      document.getElementById('editDeactivateDateTime').value = '';
    }

    // Show current stats
    document.getElementById('currentClicks').textContent = url.clicks;
    document.getElementById('currentCreated').textContent = formatDate(url.createdAt);

    // Show/hide password protection status
    const passwordStatusDiv = document.getElementById('currentPasswordStatus');
    if (url.password) {
      passwordStatusDiv.style.display = 'block';
    } else {
      passwordStatusDiv.style.display = 'none';
    }

    // Reset password fields
    document.getElementById('editPassword').value = '';
    document.getElementById('removePassword').checked = false;

    // Open modal
    openModal('editUrlModal');
  } catch (error) {
    showToast('Error loading URL data: ' + error.message, 'error');
  }
}

// Save edited URL
async function saveUrlEdit() {
  if (!currentEditingUrlId) return;

  const longUrl = document.getElementById('editLongUrl').value.trim();
  const customSlug = document.getElementById('editCustomSlug').value.trim();
  const maxUses = document.getElementById('editMaxUses').value;
  const expirationDays = document.getElementById('editExpirationDays').value;
  const tags = editTagSelector ? editTagSelector.getValue() : '';
  const password = document.getElementById('editPassword').value.trim();
  const removePassword = document.getElementById('removePassword').checked;
  const activateDateTime = document.getElementById('editActivateDateTime').value;
  const deactivateDateTime = document.getElementById('editDeactivateDateTime').value;

  if (!longUrl) {
    showToast('Long URL is required', 'error');
    return;
  }

  const saveBtn = document.getElementById('saveUrlBtn');
  setButtonLoading(saveBtn, true);

  try {
    const body = {
      longUrl: longUrl,
      customSlug: customSlug || null,
      maxUses: maxUses ? parseInt(maxUses) : null,
      expirationDays: expirationDays ? parseInt(expirationDays) : null,
      tags: tags || '',
      activateDateTime: activateDateTime || null,
      deactivateDateTime: deactivateDateTime || null
    };

    // Handle password updates
    if (removePassword) {
      body.removePassword = true;
    } else if (password) {
      body.password = password;
    }

    await apiRequest(`/api/urls/${currentEditingUrlId}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    showToast('URL updated successfully!');
    closeModal('editUrlModal');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error updating URL: ' + error.message, 'error');
    setButtonLoading(saveBtn, false);
  }
}

// Delete URL function
async function deleteUrl(id) {
  const confirmed = await confirmAction(
    'Are you sure you want to delete this URL? This action cannot be undone.',
    'Delete URL'
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/urls/${id}`, {
      method: 'DELETE'
    });

    showToast('URL deleted successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error deleting URL: ' + error.message, 'error');
  }
}

// Copy short URL from table
function copyShortUrl(slug) {
  const baseUrl = window.location.origin;
  copyToClipboard(`${baseUrl}/s/${slug}`);
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
  // Initialize tag selector for edit modal
  if (typeof TagSelector !== 'undefined') {
    editTagSelector = new TagSelector('tagSelectorEdit', {
      placeholder: 'Add tags...',
      onChange: function(selectedTags) {
        // Update hidden input with comma-separated tags
        const hiddenInput = document.getElementById('editTags');
        if (hiddenInput) {
          hiddenInput.value = selectedTags.join(',');
        }
      }
    });
  }

  // Add click handlers for copy functionality on short URLs
  document.querySelectorAll('.url-link').forEach(link => {
    link.addEventListener('dblclick', function(e) {
      e.preventDefault();
      copyToClipboard(this.href);
    });
  });

  // Cancel edit modal
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function() {
      closeModal('editUrlModal');
    });
  }

  // Save edit button
  const saveUrlBtn = document.getElementById('saveUrlBtn');
  if (saveUrlBtn) {
    saveUrlBtn.addEventListener('click', saveUrlEdit);
  }
});