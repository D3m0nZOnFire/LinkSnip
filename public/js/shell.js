/**
 * The page frame (views/partials/layout-start.ejs): the sidebar as a drawer below 1024px, and the user menu.
 * Both close on Escape and on a click outside.
 */
(function () {
  'use strict';

  // ─── Sidebar drawer ────────────────────────────────────────────────────────
  const sidebar = document.getElementById('sidebar');
  const toggles = document.querySelectorAll('[data-sidebar-toggle]');
  const backdrop = document.querySelector('.sidebar-backdrop');
  const isOpen = () => document.body.classList.contains('sidebar-open');

  function setDrawer(open, { focus = true } = {}) {
    if (!sidebar) return;
    document.body.classList.toggle('sidebar-open', open);
    if (backdrop) backdrop.hidden = !open;
    toggles.forEach(button => {
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    if (!focus) return;
    if (open) {
      const first = sidebar.querySelector('a, button');
      if (first) first.focus();
    } else if (toggles[0]) {
      toggles[0].focus();
    }
  }

  toggles.forEach(button => button.addEventListener('click', () => setDrawer(!isOpen())));
  document.querySelectorAll('[data-sidebar-close]').forEach(el => el.addEventListener('click', () => setDrawer(false)));
  // Back to the wide layout: no drawer state left behind
  window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
    if (event.matches && isOpen()) setDrawer(false, { focus: false });
  });

  // ─── User menu ─────────────────────────────────────────────────────────────
  const menus = [...document.querySelectorAll('[data-user-menu]')].map(root => ({
    root,
    button: root.querySelector('.user-button'),
    list: root.querySelector('[role="menu"]')
  }));

  function setMenu(menu, open, { focus = false } = {}) {
    menu.list.hidden = !open;
    menu.button.setAttribute('aria-expanded', String(open));
    if (open && focus) {
      const first = menu.list.querySelector('[role="menuitem"]');
      if (first) first.focus();
    }
  }

  menus.forEach(menu => {
    menu.button.addEventListener('click', () => setMenu(menu, menu.list.hidden));
    menu.button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setMenu(menu, true, { focus: true });
      }
    });
    // Up/down between the items
    menu.list.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const items = [...menu.list.querySelectorAll('[role="menuitem"]')];
      const at = items.indexOf(document.activeElement);
      const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    });
  });

  document.addEventListener('click', (event) => {
    menus.forEach(menu => {
      if (!menu.list.hidden && !menu.root.contains(event.target)) setMenu(menu, false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openMenu = menus.find(menu => !menu.list.hidden);
    if (openMenu) {
      setMenu(openMenu, false);
      openMenu.button.focus();
    } else if (isOpen()) {
      setDrawer(false);
    }
  });
})();
