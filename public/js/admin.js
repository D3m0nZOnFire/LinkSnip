/**
 * Admin Panel Actions
 */

// Global variable to store current editing URL ID
let currentEditingUrlId = null;
let currentEditingUserId = null;

// ========================================
// Type Filter Pills (All / Links / Bundles)
// ========================================

function setAdminFilter(filter) {
  ['all', 'links', 'bundles'].forEach(f => {
    const pill = document.getElementById('pill-' + f);
    if (pill) pill.classList.toggle('active', f === filter);
  });

  const items = document.querySelectorAll('#itemList > [data-type]');
  items.forEach(item => {
    if (filter === 'all') {
      item.style.display = '';
    } else {
      // 'links' matches data-type="link", 'bundles' matches data-type="bundle"
      const matchType = filter === 'links' ? 'link' : 'bundle';
      item.style.display = (item.dataset.type === matchType) ? '' : 'none';
    }
  });

  // Show per-type empty messages when filtered to that type with no items
  const noLinksMsg = document.getElementById('noLinksMsg');
  const noBundlesMsg = document.getElementById('noBundlesMsg');
  if (noLinksMsg) {
    const hasLinks = document.querySelectorAll('#itemList > [data-type="link"]').length > 0;
    noLinksMsg.style.display = (filter === 'links' && !hasLinks) ? 'block' : 'none';
  }
  if (noBundlesMsg) {
    const hasBundles = document.querySelectorAll('#itemList > [data-type="bundle"]').length > 0;
    noBundlesMsg.style.display = (filter === 'bundles' && !hasBundles) ? 'block' : 'none';
  }

  // Exit selection mode when switching filters to avoid stale selections
  if (selectionModeActive) exitSelectionMode();
}

// ========================================
// Bulk Selection
// ========================================

const selectedUrls = new Set();    // URL IDs
const selectedBundles = new Set(); // Bundle IDs
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
  selectedBundles.clear();
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
  const card = checkbox.closest('[data-url-id]');
  const type = card ? card.dataset.type : 'link';
  if (type === 'bundle') {
    if (checkbox.checked) selectedBundles.add(id); else selectedBundles.delete(id);
  } else {
    if (checkbox.checked) selectedUrls.add(id); else selectedUrls.delete(id);
  }
  updateBulkBar();
}

function selectAll(checked) {
  document.querySelectorAll('.url-select-checkbox').forEach(cb => {
    const card = cb.closest('[data-url-id]');
    if (!card || card.style.display === 'none') return;
    cb.checked = checked;
    const id = parseInt(card.getAttribute('data-url-id'));
    const type = card.dataset.type || 'link';
    if (type === 'bundle') {
      if (checked) selectedBundles.add(id); else selectedBundles.delete(id);
    } else {
      if (checked) selectedUrls.add(id); else selectedUrls.delete(id);
    }
  });
  updateBulkBar();
}

function updateBulkBar() {
  const count = selectedUrls.size + selectedBundles.size;
  const countEl = document.getElementById('selectedCount');
  if (countEl) countEl.textContent = count + ' selected';
  ['bulkDeleteBtn', 'bulkBlockBtn', 'bulkUnblockBtn'].forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (btn) btn.disabled = count === 0;
  });
}

async function bulkDelete() {
  const count = selectedUrls.size + selectedBundles.size;
  if (count === 0) return;
  const confirmed = await confirmAction(
    `Delete ${count} item${count > 1 ? 's' : ''}? This cannot be undone.`,
    'Delete Selected Items'
  );
  if (!confirmed) return;

  const deleteBtn = document.getElementById('bulkDeleteBtn');
  setButtonLoading(deleteBtn, true);
  try {
    let deleted = 0;
    if (selectedUrls.size > 0) {
      const result = await apiRequest('/api/urls/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedUrls) })
      });
      deleted += result.deleted || 0;
    }
    if (selectedBundles.size > 0) {
      const result = await apiRequest('/api/bundles/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedBundles) })
      });
      deleted += result.deleted || 0;
    }
    showToast(`Deleted ${deleted} item${deleted !== 1 ? 's' : ''} successfully!`);
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showToast('Error deleting items: ' + error.message, 'error');
    setButtonLoading(deleteBtn, false);
  }
}

async function bulkBlock() {
  const count = selectedUrls.size + selectedBundles.size;
  if (count === 0) return;
  const confirmed = await confirmAction(
    `Block ${count} item${count > 1 ? 's' : ''}? They will become inaccessible.`,
    'Block Selected Items'
  );
  if (!confirmed) return;

  const btn = document.getElementById('bulkBlockBtn');
  setButtonLoading(btn, true);
  try {
    let blocked = 0;
    if (selectedUrls.size > 0) {
      const result = await apiRequest('/api/admin/urls/bulk-block', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedUrls) })
      });
      blocked += result.blocked || 0;
    }
    if (selectedBundles.size > 0) {
      const result = await apiRequest('/api/admin/bundles/bulk-block', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedBundles) })
      });
      blocked += result.blocked || 0;
    }
    showToast(`Blocked ${blocked} item${blocked !== 1 ? 's' : ''} successfully!`);
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showToast('Error blocking items: ' + error.message, 'error');
    setButtonLoading(btn, false);
  }
}

async function bulkUnblock() {
  const count = selectedUrls.size + selectedBundles.size;
  if (count === 0) return;
  const confirmed = await confirmAction(
    `Unblock ${count} item${count > 1 ? 's' : ''}?`,
    'Unblock Selected Items',
    false
  );
  if (!confirmed) return;

  const btn = document.getElementById('bulkUnblockBtn');
  setButtonLoading(btn, true);
  try {
    let unblocked = 0;
    if (selectedUrls.size > 0) {
      const result = await apiRequest('/api/admin/urls/bulk-unblock', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedUrls) })
      });
      unblocked += result.unblocked || 0;
    }
    if (selectedBundles.size > 0) {
      const result = await apiRequest('/api/admin/bundles/bulk-unblock', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedBundles) })
      });
      unblocked += result.unblocked || 0;
    }
    showToast(`Unblocked ${unblocked} item${unblocked !== 1 ? 's' : ''} successfully!`);
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showToast('Error unblocking items: ' + error.message, 'error');
    setButtonLoading(btn, false);
  }
}

// ========================================
// Bundle Management Functions
// ========================================

async function blockBundle(id, slug) {
  const confirmed = await confirmAction(
    `Block bundle /b/${slug}? This will make it inaccessible to everyone.`,
    'Block Bundle'
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/bundles/${id}/block`, { method: 'POST' });
    showToast('Bundle blocked successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error blocking bundle: ' + error.message, 'error');
  }
}

async function unblockBundle(id, slug) {
  const confirmed = await confirmAction(
    `Unblock bundle /b/${slug}? This will make it accessible again.`,
    'Unblock Bundle',
    false
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/bundles/${id}/unblock`, { method: 'POST' });
    showToast('Bundle unblocked successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error unblocking bundle: ' + error.message, 'error');
  }
}

async function deleteBundleAdmin(id) {
  const confirmed = await confirmAction(
    'Are you sure you want to delete this bundle? This action cannot be undone.',
    'Delete Bundle'
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/bundles/${id}`, { method: 'DELETE' });
    showToast('Bundle deleted successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error deleting bundle: ' + error.message, 'error');
  }
}

// ========================================
// URL Management Functions
// ========================================

// Open edit modal and populate with current data
async function editUrl(id) {
  currentEditingUrlId = id;

  try {
    const url = await apiRequest(`/api/urls/${id}`);

    document.getElementById('editLongUrl').value = url.longUrl;
    document.getElementById('editCustomSlug').value = url.slug;
    document.getElementById('editMaxUses').value = url.maxUses || '';

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

// Block URL function
async function blockUrl(id, slug) {
  const confirmed = await confirmAction(
    `Block URL /s/${slug}? This will make it inaccessible to everyone.`,
    'Block URL'
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/urls/${id}/block`, {
      method: 'POST'
    });

    showToast('URL blocked successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error blocking URL: ' + error.message, 'error');
  }
}

// Unblock URL function
async function unblockUrl(id, slug) {
  const confirmed = await confirmAction(
    `Unblock URL /s/${slug}? This will make it accessible again.`,
    'Unblock URL',
    false
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/urls/${id}/unblock`, {
      method: 'POST'
    });

    showToast('URL unblocked successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error unblocking URL: ' + error.message, 'error');
  }
}

// ========================================
// User Management Functions
// ========================================

// Open edit user modal
async function editUser(id) {
  currentEditingUserId = id;

  try {
    const user = await apiRequest(`/api/admin/users/${id}`);

    document.getElementById('editUsername').value = user.username;
    document.getElementById('editUserEmail').value = user.email || '';
    document.getElementById('editUserRole').value = user.role || '';
    document.getElementById('editUserIsAdmin').checked = user.isAdmin;
    document.getElementById('editUserIsBanned').checked = user.isBanned || false;

    document.getElementById('userCreatedAt').textContent = formatDate(user.createdAt);
    document.getElementById('userUrlCount').textContent = user.urlCount || 0;

    openModal('editUserModal');
  } catch (error) {
    showToast('Error loading user data: ' + error.message, 'error');
  }
}

// Create a user (Admin → Users → Create user)
async function createUser(event) {
  event.preventDefault();
  const button = document.getElementById('createUserBtn');
  setButtonLoading(button, true);

  try {
    await apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('newUsername').value.trim(),
        email: document.getElementById('newUserEmail').value.trim() || null,
        password: document.getElementById('newUserPassword').value,
        role: document.getElementById('newUserRole').value || null,
        isAdmin: document.getElementById('newUserIsAdmin').checked
      })
    });

    showToast('User created');
    closeModal('createUserModal');
    setTimeout(() => location.reload(), 800);
  } catch (error) {
    showToast('Error creating user: ' + error.message, 'error');
    setButtonLoading(button, false);
  }
}

// Save edited user
async function saveUserEdit() {
  if (!currentEditingUserId) return;

  const username = document.getElementById('editUsername').value.trim();
  const email = document.getElementById('editUserEmail').value.trim();
  const role = document.getElementById('editUserRole').value;
  const isAdmin = document.getElementById('editUserIsAdmin').checked;
  const isBanned = document.getElementById('editUserIsBanned').checked;
  const newPassword = document.getElementById('editUserPassword').value;

  if (!username) {
    showToast('Username is required', 'error');
    return;
  }

  const saveBtn = document.getElementById('saveUserBtn');
  setButtonLoading(saveBtn, true);

  try {
    await apiRequest(`/api/admin/users/${currentEditingUserId}`, {
      method: 'PUT',
      body: JSON.stringify({
        username: username,
        email: email || null,
        role: role,
        isAdmin: isAdmin,
        isBanned: isBanned,
        password: newPassword || undefined
      })
    });

    showToast('User updated successfully!');
    closeModal('editUserModal');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error updating user: ' + error.message, 'error');
    setButtonLoading(saveBtn, false);
  }
}

// Delete user
async function deleteUser(id) {
  const confirmed = await confirmAction(
    'Are you sure you want to delete this user? All their URLs will also be deleted. This action cannot be undone.',
    'Delete User'
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/users/${id}`, {
      method: 'DELETE'
    });

    showToast('User deleted successfully!');
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast('Error deleting user: ' + error.message, 'error');
  }
}

// Ban/Unban user
async function toggleBanUser(id, currentlyBanned) {
  const action = currentlyBanned ? 'unban' : 'ban';
  const confirmed = await confirmAction(
    `Are you sure you want to ${action} this user?`,
    `${action.charAt(0).toUpperCase() + action.slice(1)} User`,
    !currentlyBanned
  );
  if (!confirmed) return;

  try {
    await apiRequest(`/api/admin/users/${id}/ban`, {
      method: 'POST',
      body: JSON.stringify({
        banned: !currentlyBanned
      })
    });

    showToast(`User ${action}ned successfully!`);
    setTimeout(() => location.reload(), 1000);
  } catch (error) {
    showToast(`Error ${action}ning user: ` + error.message, 'error');
  }
}

// ========================================
// Initialize
// ========================================

// ========================================
// Chronological Sort (interleave links + bundles)
// ========================================

function sortItemsByDate() {
  const list = document.getElementById('itemList');
  if (!list) return;
  const items = Array.from(list.children);
  items.sort((a, b) => {
    const da = new Date(a.dataset.createdAt || 0);
    const db = new Date(b.dataset.createdAt || 0);
    return db - da;
  });
  items.forEach(item => list.appendChild(item));
}

document.addEventListener('DOMContentLoaded', function() {
  sortItemsByDate();

  // Add double-click to copy functionality on short URLs
  document.querySelectorAll('.url-link').forEach(link => {
    link.addEventListener('dblclick', function(e) {
      e.preventDefault();
      copyToClipboard(this.href);
    });
  });
  
  // URL Edit Modal
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) {
    cancelEditBtn.addEventListener('click', function() {
      closeModal('editUrlModal');
    });
  }
  
  const saveUrlBtn = document.getElementById('saveUrlBtn');
  if (saveUrlBtn) {
    saveUrlBtn.addEventListener('click', saveUrlEdit);
  }
  
  // User Edit Modal
  const cancelUserEditBtn = document.getElementById('cancelUserEditBtn');
  if (cancelUserEditBtn) {
    cancelUserEditBtn.addEventListener('click', function() {
      closeModal('editUserModal');
    });
  }
  
  const saveUserBtn = document.getElementById('saveUserBtn');
  if (saveUserBtn) {
    saveUserBtn.addEventListener('click', saveUserEdit);
  }
});

// Export to CSV
function exportToCSV() {
  const rows = document.querySelectorAll('tbody tr');
  const csvData = [];
  
  csvData.push(['Short URL', 'Long URL', 'Creator', 'Clicks', 'Max Uses', 'Expires', 'Created', 'Status']);
  
  rows.forEach(row => {
    if (row.style.display !== 'none') {
      const cells = row.querySelectorAll('td');
      const rowData = [
        cells[0].textContent.trim(),
        cells[1].querySelector('a').href,
        cells[2].textContent.trim(),
        cells[3].textContent.trim(),
        cells[4].textContent.trim(),
        cells[5].textContent.trim(),
        cells[6].textContent.trim(),
        cells[7].textContent.trim()
      ];
      csvData.push(rowData);
    }
  });
  
  const csvString = csvData.map(row => 
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');
  
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linksnip-urls-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
  
  showToast('URLs exported to CSV!');
}