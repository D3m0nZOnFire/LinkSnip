/**
 * URL Creation Form Logic
 */

document.addEventListener('DOMContentLoaded', function() {
  const form = document.querySelector('form[action="/create"]');
  const copyButton = document.querySelector('[data-copy-url]');
  
  // Form submission with loading state
  if (form) {
    form.addEventListener('submit', function(e) {
      const submitButton = form.querySelector('button[type="submit"]');
      setButtonLoading(submitButton, true);
    });
  }
  
  // Copy short URL functionality
  if (copyButton) {
    copyButton.addEventListener('click', function() {
      const shortUrl = document.getElementById('shortUrl');
      if (shortUrl) {
        copyToClipboard(shortUrl.textContent, copyButton);
      }
    });
  }
  
  // URL validation
  const longUrlInput = document.getElementById('longUrl');
  if (longUrlInput) {
    longUrlInput.addEventListener('blur', function() {
      const value = this.value.trim();
      if (value && !isValidUrl(value)) {
        this.setCustomValidity('Please enter a valid URL (include http:// or https://)');
      } else {
        this.setCustomValidity('');
      }
    });
  }
  
  // Custom slug validation
  const customSlugInput = document.getElementById('customSlug');
  if (customSlugInput) {
    customSlugInput.addEventListener('input', function() {
      // Only allow URL-safe characters
      this.value = this.value.replace(/[^A-Za-z0-9_-]/g, '');
    });
  }
});

// URL validation helper
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}