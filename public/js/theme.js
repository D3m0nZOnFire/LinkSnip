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
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    const isDark = theme === 'dark';
    toggleBtn.innerHTML = isDark
      ? `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      `
      : `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      `;

    toggleBtn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
    toggleBtn.setAttribute('title', isDark ? 'Switch to light theme' : 'Switch to dark theme');
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

    // Set up toggle button
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', toggleTheme);
    }

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
