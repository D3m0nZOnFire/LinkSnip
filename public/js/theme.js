/**
 * Theme Management System for LinkSnip
 * Handles light/dark theme switching with localStorage persistence and system preference detection
 */

(function() {
  'use strict';

  const THEME_KEY = 'linksnip-theme';
  const THEME_ATTR = 'data-theme';

  /**
   * Get system theme preference
   * @returns {string} 'light' or 'dark'
   */
  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  /**
   * Get current theme (from localStorage or system preference)
   * @returns {string} 'light' or 'dark'
   */
  function getCurrentTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return getSystemTheme();
  }

  /**
   * Apply theme to document
   * @param {string} theme - 'light' or 'dark'
   */
  function applyTheme(theme) {
    const root = document.documentElement;
    root.setAttribute(THEME_ATTR, theme);

    // Update datetime input color-scheme
    let style = document.getElementById('theme-color-scheme-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'theme-color-scheme-style';
      document.head.appendChild(style);
    }

    style.textContent = `
      input[type="datetime-local"].form-input,
      input[type="date"].form-input,
      input[type="time"].form-input,
      .panel-datetime-input {
        color-scheme: ${theme};
      }
    `;

    // Update toggle button icon
    updateToggleButton(theme);
  }

  /**
   * Update theme toggle button icon
   * @param {string} theme - Current theme
   */
  function updateToggleButton(theme) {
    const isDark = theme === 'dark';
    const icon = isDark
      ? `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
        </svg>
      `
      : `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;
    const label = isDark ? 'Light mode' : 'Dark mode';

    // Every theme button: the header's icon button and the item in the user menu
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const iconSlot = button.querySelector('[data-theme-icon]');
      if (iconSlot) iconSlot.innerHTML = icon;
      const labelSlot = button.querySelector('[data-theme-label]');
      if (labelSlot) labelSlot.textContent = label;
      else button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  /**
   * Toggle theme between light and dark
   */
  function toggleTheme() {
    const currentTheme = getCurrentTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, newTheme);
    applyTheme(newTheme);
  }

  /**
   * Initialize theme system
   */
  function initTheme() {
    // Apply initial theme
    const theme = getCurrentTheme();
    applyTheme(theme);

    // Theme buttons ([data-theme-toggle]), wherever they are
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-theme-toggle]')) toggleTheme();
    });

    // Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        // Only auto-switch if user hasn't set a preference
        if (!localStorage.getItem(THEME_KEY)) {
          applyTheme(e.matches ? 'light' : 'dark');
        }
      });
    }
  }

  // Initialize immediately (before DOMContentLoaded to prevent flash)
  if (document.readyState === 'loading') {
    // Apply theme ASAP to prevent flash
    document.documentElement.setAttribute(THEME_ATTR, getCurrentTheme());
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }

  // Export for potential use elsewhere
  window.LinkSnipTheme = {
    toggle: toggleTheme,
    get: getCurrentTheme,
    set: (theme) => {
      if (theme !== 'light' && theme !== 'dark') {
        console.warn('Invalid theme:', theme);
        return;
      }
      localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme);
    }
  };
})();
