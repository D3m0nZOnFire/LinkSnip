/**
 * Account settings (views/settings.ejs): username, password, deleting the account.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  $('usernameForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const newUsername = $('newUsername').value.trim();
    const currentPassword = $('usernamePassword').value;
    if (!newUsername) return showToast('Enter the new username', 'error');
    if (!currentPassword) return showToast('Enter your current password', 'error');

    const button = $('saveUsernameBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/user/username', { method: 'PUT', body: JSON.stringify({ newUsername, currentPassword }) });
      showToast('Username changed');
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      showToast(error.message, 'error');
      setButtonLoading(button, false);
    }
  });

  $('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentPassword = $('currentPassword').value;
    const newPassword = $('newPassword').value;
    const minimum = $('newPassword').minLength; // the server's rule, from the minlength attribute
    if (!currentPassword || !newPassword || !$('confirmPassword').value) return showToast('Fill in all three fields', 'error');
    if (minimum > 0 && newPassword.length < minimum) return showToast(`The new password needs at least ${minimum} characters`, 'error');
    if (newPassword !== $('confirmPassword').value) return showToast('The new passwords don\'t match', 'error');

    const button = $('savePasswordBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/user/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
      showToast('Password changed');
      event.target.reset();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  $('deleteAccountBtn').addEventListener('click', () => {
    $('deletePassword').value = '';
    $('deleteAccountError').textContent = '';
    openModal('deleteAccountModal');
    setTimeout(() => $('deletePassword').focus(), 50);
  });

  $('deleteAccountForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('deletePassword').value;
    if (!password) {
      $('deleteAccountError').textContent = 'Enter your password.';
      return;
    }
    const button = $('confirmDeleteAccountBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/user/account', { method: 'DELETE', body: JSON.stringify({ password }) });
      window.location.href = '/';
    } catch (error) {
      $('deleteAccountError').textContent = error.message;
      setButtonLoading(button, false);
    }
  });
})();
