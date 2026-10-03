/**
 * Main utilities and shared functions
 */

// Toast notification system
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(400px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Copy to clipboard utility
function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text)
    .then(() => {
      if (button) {
        const originalHTML = button.innerHTML;
        button.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Copied!
        `;
        button.disabled = true;
        
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.disabled = false;
        }, 2000);
      } else {
        showToast('Copied to clipboard!');
      }
    })
    .catch(err => {
      console.error('Failed to copy:', err);
      showToast('Failed to copy to clipboard', 'error');
    });
}

// Confirm dialog — uses styled in-app modal when available (partials/confirm-modal), falls back to browser confirm
function confirmAction(message, title = 'Confirm Action', destructive = true, confirmLabel = null) {
  const modal = document.getElementById('confirmModal');
  if (!modal) {
    return Promise.resolve(confirm(message));
  }
  return new Promise((resolve) => {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;

    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    if (!confirmBtn.dataset.defaultLabel) confirmBtn.dataset.defaultLabel = confirmBtn.textContent;
    confirmBtn.textContent = confirmLabel || confirmBtn.dataset.defaultLabel;
    if (destructive) {
      confirmBtn.classList.add('btn-danger');
      confirmBtn.classList.remove('btn-primary');
    } else {
      confirmBtn.classList.remove('btn-danger');
      confirmBtn.classList.add('btn-primary');
    }

    function cleanup() {
      closeModal('confirmModal');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    }
    function onConfirm() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    const cancelBtn = document.getElementById('confirmModalCancelBtn');
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    openModal('confirmModal');
  });
}

// Format date utility
function formatDate(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-GB');
}

// Format date for datetime-local input (YYYY-MM-DDTHH:mm)
function formatDateTimeLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Format number utility
function formatNumber(num) {
  return num.toLocaleString();
}

// Loading state for buttons
function setButtonLoading(button, loading = true) {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = 'Loading...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

// API request wrapper
async function apiRequest(url, options = {}) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const response = await fetch(url, {
      headers,
      ...options
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// ========================================
// Modal Functions
// ========================================

// Buttons that open or close a modal: data-open-modal="id" / data-close-modal="id"
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open-modal]');
  if (opener) openModal(opener.dataset.openModal);
  const closer = e.target.closest('[data-close-modal]');
  if (closer) closeModal(closer.dataset.closeModal);
});

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  if (e.target.classList.contains('modal-overlay')) {
    closeModal(e.target.id);
  }
});

// Close modal with Escape key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const activeModal = document.querySelector('.modal-overlay.active');
    if (activeModal) {
      closeModal(activeModal.id);
    }
  }
});

// ========================================
// Password Toggle Functions
// ========================================

/**
 * Toggle password visibility
 * @param {HTMLInputElement} input - The password input element
 * @param {HTMLElement} button - The toggle button element
 */
function togglePasswordVisibility(input, button) {
  if (!input || !button) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  // Update button icon
  const iconSVG = button.querySelector('svg');
  if (iconSVG) {
    if (isPassword) {
      // Show "eye-off" icon (password is visible)
      iconSVG.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path>
      `;
    } else {
      // Show "eye" icon (password is hidden)
      iconSVG.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
      `;
    }
  }
}

/**
 * Wrap password inputs with toggle button
 * Call this function after DOM is loaded to auto-wrap password inputs
 */
function initPasswordToggles() {
  // Find all password inputs with the data-toggle-password attribute
  const passwordInputs = document.querySelectorAll('input[type="password"][data-toggle-password]');

  passwordInputs.forEach(input => {
    // Check if already wrapped
    if (input.parentElement.classList.contains('password-input-wrapper')) {
      return;
    }

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'password-input-wrapper';

    // Create toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'password-toggle-btn';
    toggleBtn.setAttribute('aria-label', 'Toggle password visibility');
    toggleBtn.innerHTML = `
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
      </svg>
    `;

    // Add click handler
    toggleBtn.addEventListener('click', () => togglePasswordVisibility(input, toggleBtn));

    // Wrap the input
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);
    wrapper.appendChild(toggleBtn);
  });
}

// Initialize password toggles when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPasswordToggles);
} else {
  initPasswordToggles();
}