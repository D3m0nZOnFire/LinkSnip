/**
 * Admin → Users (views/admin-users.ejs): create, edit, ban and delete accounts.
 */

let currentEditingUserId = null;

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

document.addEventListener('DOMContentLoaded', function() {
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
