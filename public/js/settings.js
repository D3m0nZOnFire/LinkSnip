/**
 * User Settings Actions
 */

// Change username
async function changeUsername() {
  const newUsername = document.getElementById('newUsername').value.trim();
  const currentPassword = document.getElementById('usernamePassword').value;
  
  if (!newUsername) {
    showToast('Please enter a new username', 'error');
    return;
  }
  
  if (!currentPassword) {
    showToast('Please enter your current password', 'error');
    return;
  }
  
  const saveBtn = document.getElementById('saveUsernameBtn');
  setButtonLoading(saveBtn, true);
  
  try {
    await apiRequest('/api/user/username', {
      method: 'PUT',
      body: JSON.stringify({
        newUsername: newUsername,
        currentPassword: currentPassword
      })
    });
    
    showToast('Username updated successfully!');
    setTimeout(() => location.reload(), 1500);
  } catch (error) {
    showToast('Error updating username: ' + error.message, 'error');
    setButtonLoading(saveBtn, false);
  }
}

// Change password
async function changePassword() {
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast('All fields are required', 'error');
    return;
  }
  
  const minimum = document.getElementById('newPassword').minLength; // minlength from the server's rule
  if (minimum > 0 && newPassword.length < minimum) {
    showToast(`New password must be at least ${minimum} characters`, 'error');
    return;
  }
  
  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match', 'error');
    return;
  }
  
  const saveBtn = document.getElementById('savePasswordBtn');
  setButtonLoading(saveBtn, true);
  
  try {
    await apiRequest('/api/user/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: currentPassword,
        newPassword: newPassword
      })
    });
    
    showToast('Password updated successfully!');
    
    // Clear form
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    
    setButtonLoading(saveBtn, false);
  } catch (error) {
    showToast('Error updating password: ' + error.message, 'error');
    setButtonLoading(saveBtn, false);
  }
}

// Delete account
async function deleteAccount() {
  const password = prompt('Enter your password to confirm account deletion:');
  
  if (!password) return;
  
  if (!confirmAction('Are you absolutely sure? This will delete your account and all your URLs. This action cannot be undone.')) {
    return;
  }
  
  try {
    await apiRequest('/api/user/account', {
      method: 'DELETE',
      body: JSON.stringify({
        password: password
      })
    });
    
    showToast('Account deleted successfully. Redirecting...');
    setTimeout(() => {
      window.location.href = '/logout';
    }, 2000);
  } catch (error) {
    showToast('Error deleting account: ' + error.message, 'error');
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
  const saveUsernameBtn = document.getElementById('saveUsernameBtn');
  if (saveUsernameBtn) {
    saveUsernameBtn.addEventListener('click', changeUsername);
  }
  
  const savePasswordBtn = document.getElementById('savePasswordBtn');
  if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', changePassword);
  }
  
  const deleteAccountBtn = document.getElementById('deleteAccountBtn');
  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener('click', deleteAccount);
  }
});