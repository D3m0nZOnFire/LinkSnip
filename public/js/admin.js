/**
 * Admin → Users (views/admin-users.ejs): filters, create, edit, ban and delete accounts.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let editingUserId = null;

  // A changed select applies the filters right away
  document.querySelectorAll('#filterForm [data-auto-submit]').forEach(select => {
    select.addEventListener('change', () => $('filterForm').submit());
  });

  async function editUser(id) {
    editingUserId = id;
    try {
      const user = await apiRequest(`/api/admin/users/${id}`);
      $('editUsername').value = user.username;
      $('editUserEmail').value = user.email || '';
      $('editUserPassword').value = '';
      $('editUserRole').value = user.role || '';
      $('editUserIsAdmin').checked = !!user.isAdmin;
      $('editUserIsBanned').checked = !!user.isBanned;
      $('userCreatedAt').textContent = formatDate(user.createdAt);
      $('userUrlCount').textContent = user.urlCount || 0;
      openModal('editUserModal');
    } catch (error) {
      showToast(`Could not load the user: ${error.message}`, 'error');
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    if (!editingUserId) return;
    const username = $('editUsername').value.trim();
    if (!username) return showToast('Username is required', 'error');

    const button = $('saveUserBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest(`/api/admin/users/${editingUserId}`, {
        method: 'PUT',
        body: JSON.stringify({
          username,
          email: $('editUserEmail').value.trim() || null,
          role: $('editUserRole').value,
          isAdmin: $('editUserIsAdmin').checked,
          isBanned: $('editUserIsBanned').checked,
          password: $('editUserPassword').value || undefined
        })
      });
      closeModal('editUserModal');
      showToast('User saved');
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      showToast(`Could not save: ${error.message}`, 'error');
      setButtonLoading(button, false);
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const button = $('createUserBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: $('newUsername').value.trim(),
          email: $('newUserEmail').value.trim() || null,
          password: $('newUserPassword').value,
          role: $('newUserRole').value || null,
          isAdmin: $('newUserIsAdmin').checked
        })
      });
      closeModal('createUserModal');
      showToast('User created');
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      showToast(`Could not create the user: ${error.message}`, 'error');
      setButtonLoading(button, false);
    }
  }

  async function setBanned(id, username, banned) {
    const ok = await confirmAction(
      banned ? `Ban ${username}? They can't log in until the ban is lifted.` : `Lift the ban on ${username}?`,
      banned ? 'Ban user' : 'Unban user', banned, banned ? 'Ban' : 'Unban');
    if (!ok) return;
    try {
      await apiRequest(`/api/admin/users/${id}/ban`, { method: 'POST', body: JSON.stringify({ banned }) });
      showToast(banned ? 'User banned' : 'Ban lifted');
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function deleteUser(id, username) {
    const ok = await confirmAction(
      `Delete ${username}? Their personal links, bundles, pastes and files are deleted too. Team items stay. This can't be undone.`,
      'Delete user');
    if (!ok) return;
    try {
      await apiRequest(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast('User deleted');
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  document.addEventListener('click', (e) => {
    const button = e.target.closest('tr[data-user-id] [data-action]');
    if (!button) return;
    const row = button.closest('tr');
    const id = Number(row.dataset.userId);
    const username = row.dataset.username;
    const action = button.dataset.action;
    if (action === 'edit') editUser(id);
    else if (action === 'ban' || action === 'unban') setBanned(id, username, action === 'ban');
    else if (action === 'delete') deleteUser(id, username);
  });

  $('editUserForm')?.addEventListener('submit', saveUser);
  $('createUserForm')?.addEventListener('submit', createUser);
})();
