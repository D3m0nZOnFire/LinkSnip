/**
 * Public item pages (link/paste info, paste, file, bundle): [data-copy] buttons copy their value (the short link)
 * and say so; [data-copy-from] copies the text of another element (a paste's content).
 */
(function () {
  'use strict';

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy], [data-copy-from]');
    if (!button) return;
    const source = button.dataset.copyFrom ? document.getElementById(button.dataset.copyFrom) : null;
    const text = source ? (source.value !== undefined ? source.value : source.textContent) : button.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
      const label = button.querySelector('[data-copy-label]') || null;
      const original = label ? label.textContent : null;
      if (label) label.textContent = 'Copied';
      button.classList.add('copied');
      if (typeof showToast === 'function') showToast('Copied');
      setTimeout(() => {
        button.classList.remove('copied');
        if (label) label.textContent = original;
      }, 1500);
    } catch (_) {
      if (typeof showToast === 'function') showToast('Could not copy', 'error');
    }
  });
})();
