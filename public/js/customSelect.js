/**
 * Custom dropdowns: every select[data-select] gets a button and a styled list (public/css/select.css). The native
 * <select> stays in the page, hidden: forms submit it, scripts read and set it (`select.value = …`, rebuilt options),
 * and picking an option fires its `change`. Loaded on every page (partials/head.ejs); selects added later (results
 * swapped in, modals) are picked up too.
 *
 * Options: data-color (a hex color: a dot), data-hint (gray text on the right).
 * Select: multiple (options toggle, the list stays open, Clear), data-placeholder (shown when nothing is picked),
 * data-select-search (a filter field), data-select-match="<input id>" (an Any | All switch for 2+ picks that writes
 * that input and fires the select's change).
 */
(function () {
  'use strict';

  const HEX = /^#[0-9a-f]{3,8}$/i;
  let counter = 0;
  let openInstance = null;
  const nextId = (prefix) => `cselect-${prefix}-${++counter}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function dot(color) {
    if (!HEX.test(color || '')) return null;
    const node = el('span', 'cselect-dot');
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('--dot-color', color);
    return node;
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  // A script setting value or selectedIndex fires no event: the setters tell an enhanced select's control
  function watchSetters() {
    if (watchSetters.done) return;
    watchSetters.done = true;
    ['value', 'selectedIndex'].forEach(name => {
      const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name);
      Object.defineProperty(HTMLSelectElement.prototype, name, {
        configurable: true,
        enumerable: native.enumerable,
        get() { return native.get.call(this); },
        set(value) {
          native.set.call(this, value);
          if (this.customSelect) this.customSelect.render();
        }
      });
    });
  }

  class CustomSelect {
    constructor(select) {
      this.select = select;
      this.multiple = select.multiple;
      this.typed = '';
      this.typedAt = 0;
      this.build();
      this.render();

      new MutationObserver(() => this.render()).observe(select, {
        childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['disabled', 'selected', 'label', 'data-color', 'data-hint']
      });
    }

    // ─── Building ───────────────────────────────────────────────────────────
    build() {
      const select = this.select;
      this.wrapper = el('div', 'cselect');
      if (this.multiple) this.wrapper.classList.add('cselect-multiple');
      select.parentNode.insertBefore(this.wrapper, select);

      this.button = el('button', `${select.className} cselect-button`.trim());
      this.button.type = 'button';
      this.button.setAttribute('aria-haspopup', 'listbox');
      this.button.setAttribute('aria-expanded', 'false');
      this.dots = el('span', 'cselect-dots');
      this.value = el('span', 'cselect-value');
      this.value.id = nextId('value');
      this.matchNote = el('span', 'cselect-match-note');
      const chevron = el('span', 'cselect-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = CHEVRON;
      this.button.append(this.dots, this.value, this.matchNote, chevron);

      this.popup = el('div', 'cselect-popup');
      this.popup.hidden = true;
      this.list = el('ul', 'cselect-list');
      this.list.id = nextId('list');
      this.list.setAttribute('role', 'listbox');
      this.list.tabIndex = -1;
      if (this.multiple) this.list.setAttribute('aria-multiselectable', 'true');
      this.button.setAttribute('aria-controls', this.list.id);

      if (select.hasAttribute('data-select-search')) {
        this.search = el('input', 'cselect-search'); // not .form-input: page rules for it would reach in here
        this.search.type = 'search';
        this.search.placeholder = 'Filter…';
        this.search.setAttribute('aria-label', 'Filter the options');
        this.search.setAttribute('aria-controls', this.list.id);
        this.search.autocomplete = 'off';
        this.popup.appendChild(this.search);
        this.search.addEventListener('input', () => this.filter());
        this.search.addEventListener('keydown', (event) => this.onListKey(event, true));
      }

      const matchInput = select.dataset.selectMatch && document.getElementById(select.dataset.selectMatch);
      if (this.multiple && matchInput) {
        this.matchInput = matchInput;
        this.matchBar = el('div', 'cselect-match');
        this.matchBar.setAttribute('role', 'group');
        this.matchBar.setAttribute('aria-label', 'Show items with');
        this.matchBar.appendChild(el('span', 'cselect-match-label', 'Match'));
        const segments = el('span', 'cselect-segments');
        [['any', 'Any'], ['all', 'All']].forEach(([value, label]) => {
          const option = el('button', 'cselect-segment', label);
          option.type = 'button';
          option.dataset.match = value;
          option.title = value === 'any' ? 'Items with any of these tags' : 'Items with all of these tags';
          option.addEventListener('click', () => this.setMatch(value));
          segments.appendChild(option);
        });
        this.matchBar.appendChild(segments);
        this.popup.appendChild(this.matchBar);
      }

      this.popup.appendChild(this.list);
      this.empty = el('p', 'cselect-empty', 'No matches');
      this.empty.hidden = true;
      this.popup.appendChild(this.empty);

      if (this.multiple) {
        const footer = el('div', 'cselect-footer');
        this.clearButton = el('button', 'cselect-clear', 'Clear');
        this.clearButton.type = 'button';
        this.clearButton.addEventListener('click', () => this.clear());
        footer.appendChild(this.clearButton);
        this.popup.appendChild(footer);
      }

      this.wrapper.append(select, this.button, this.popup);
      select.classList.add('cselect-native');
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      select.addEventListener('focus', () => this.button.focus());

      // The page's <label for> names the button, and clicking it focuses the button
      const label = select.labels && select.labels[0];
      if (label) {
        if (!label.id) label.id = nextId('label');
        this.button.setAttribute('aria-labelledby', `${label.id} ${this.value.id}`);
        label.addEventListener('click', (event) => { event.preventDefault(); this.button.focus(); });
      } else if (select.getAttribute('aria-label')) {
        this.button.setAttribute('aria-label', select.getAttribute('aria-label'));
      }
      if (select.title) this.button.title = select.title;

      this.button.addEventListener('click', () => (this.isOpen() ? this.close() : this.open()));
      this.button.addEventListener('keydown', (event) => this.onButtonKey(event));
      this.list.addEventListener('keydown', (event) => this.onListKey(event, false));
      this.list.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus where it is
      this.list.addEventListener('click', (event) => {
        const item = event.target.closest('[role="option"]');
        if (item) this.choose(item);
      });
      this.list.addEventListener('mousemove', (event) => {
        const item = event.target.closest('[role="option"]');
        if (item && item.getAttribute('aria-disabled') !== 'true') this.setActive(item, false);
      });
    }

    // ─── Showing the select's state ─────────────────────────────────────────
    options() {
      return [...this.select.options];
    }

    render() {
      const select = this.select;
      this.button.disabled = select.disabled;

      // The list: one item per option, groups as headings
      this.list.textContent = '';
      this.items = [];
      let group = null;
      let groupNode = null;
      this.options().forEach((option, index) => {
        const parent = option.parentElement && option.parentElement.tagName === 'OPTGROUP' ? option.parentElement : null;
        if (parent !== group) {
          group = parent;
          groupNode = null;
          if (parent) {
            groupNode = el('li', 'cselect-group');
            groupNode.setAttribute('role', 'group');
            const heading = el('div', 'cselect-group-label', parent.label);
            heading.id = nextId('group');
            groupNode.setAttribute('aria-labelledby', heading.id);
            const inner = el('ul', 'cselect-group-list');
            inner.setAttribute('role', 'presentation');
            groupNode.append(heading, inner);
            this.list.appendChild(groupNode);
          }
        }
        const item = el('li', 'cselect-option');
        item.id = nextId('option');
        item.setAttribute('role', 'option');
        item.dataset.value = option.value;
        item.dataset.index = String(index);
        item.setAttribute('aria-selected', String(option.selected));
        if (option.disabled || (parent && parent.disabled)) item.setAttribute('aria-disabled', 'true');
        const check = el('span', 'cselect-check');
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = CHECK;
        item.appendChild(check);
        const swatch = dot(option.dataset.color);
        if (swatch) item.appendChild(swatch);
        item.appendChild(el('span', 'cselect-label', option.label || option.textContent));
        if (option.dataset.hint) item.appendChild(el('span', 'cselect-hint', option.dataset.hint));
        (groupNode ? groupNode.querySelector('.cselect-group-list') : this.list).appendChild(item);
        this.items.push(item);
      });

      this.renderButton();
      if (this.search) this.filter(false);
      if (this.isOpen()) {
        const active = this.activeId && document.getElementById(this.activeId);
        if (!active) this.setActive(this.firstSelectedItem() || this.visibleItems()[0], false);
      }
    }

    renderButton() {
      this.renderButtonContent();
      if (this.isOpen()) this.place(); // the button may have grown or shrunk
    }

    renderButtonContent() {
      const picked = this.options().filter(option => option.selected);
      this.dots.textContent = '';
      if (this.multiple) {
        const names = picked.map(option => option.label || option.textContent);
        let text = this.select.dataset.placeholder || 'None';
        if (names.length === 1) text = names[0];
        else if (names.length === 2) text = `${names[0]}, ${names[1]}`;
        else if (names.length > 2) text = `${names[0]} +${names.length - 1}`;
        this.value.textContent = text;
        picked.slice(0, 3).forEach(option => {
          const swatch = dot(option.dataset.color);
          if (swatch) this.dots.appendChild(swatch);
        });
        this.wrapper.classList.toggle('has-value', picked.length > 0);
        if (this.matchBar) {
          this.matchBar.hidden = picked.length < 2;
          const match = this.matchInput.value === 'all' ? 'all' : 'any';
          this.matchBar.querySelectorAll('[data-match]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.match === match));
          });
          this.matchNote.textContent = picked.length >= 2 ? (match === 'all' ? '· all' : '· any') : '';
        }
        if (this.clearButton) this.clearButton.disabled = picked.length === 0;
      } else {
        const option = picked[0];
        this.value.textContent = option ? (option.label || option.textContent) : (this.select.dataset.placeholder || '');
        const swatch = option && dot(option.dataset.color);
        if (swatch) this.dots.appendChild(swatch);
      }
    }

    // ─── Opening and closing ────────────────────────────────────────────────
    isOpen() {
      return this.button.getAttribute('aria-expanded') === 'true';
    }

    open() {
      if (this.select.disabled || this.isOpen()) return;
      if (openInstance && openInstance !== this) openInstance.close(false);
      openInstance = this;
      this.render();
      this.popup.hidden = false;
      this.button.setAttribute('aria-expanded', 'true');
      this.wrapper.classList.add('is-open');
      this.place();
      this.setActive(this.firstSelectedItem() || this.visibleItems()[0], true);
      (this.search || this.list).focus();
      requestAnimationFrame(() => this.popup.classList.add('is-visible'));
    }

    close(refocus = true) {
      if (!this.isOpen()) return;
      this.popup.hidden = true;
      this.popup.classList.remove('is-visible', 'opens-up');
      this.button.setAttribute('aria-expanded', 'false');
      this.wrapper.classList.remove('is-open');
      if (this.search && this.search.value) {
        this.search.value = '';
        this.filter(false);
      }
      if (openInstance === this) openInstance = null;
      if (refocus) this.button.focus();
    }

    // Under the button (above it when there is no room), inside the window, fixed so no scroll box clips it
    place() {
      const popup = this.popup;
      const box = this.button.getBoundingClientRect();
      const width = Math.min(Math.max(box.width, 200), window.innerWidth - 16);
      popup.style.setProperty('--cselect-width', `${width}px`);
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      popup.style.setProperty('--cselect-left', `${left}px`);
      const below = window.innerHeight - box.bottom;
      const up = below < Math.min(popup.scrollHeight || 280, 320) + 16 && box.top > below;
      popup.classList.toggle('opens-up', up);
      popup.style.setProperty('--cselect-top', up ? 'auto' : `${box.bottom + 4}px`);
      popup.style.setProperty('--cselect-bottom', up ? `${window.innerHeight - box.top + 4}px` : 'auto');
      popup.style.setProperty('--cselect-max-height', `${Math.max(160, (up ? box.top : below) - 16)}px`);
    }

    // ─── Moving and choosing ────────────────────────────────────────────────
    visibleItems() {
      return this.items.filter(item => !item.hidden && item.getAttribute('aria-disabled') !== 'true');
    }

    firstSelectedItem() {
      return this.visibleItems().find(item => item.getAttribute('aria-selected') === 'true');
    }

    setActive(item, scroll = true) {
      this.items.forEach(other => other.classList.toggle('is-active', other === item));
      this.activeId = item ? item.id : null;
      [this.list, this.search].filter(Boolean).forEach(node => {
        if (item) node.setAttribute('aria-activedescendant', item.id);
        else node.removeAttribute('aria-activedescendant');
      });
      if (item && scroll) item.scrollIntoView({ block: 'nearest' });
    }

    active() {
      return this.activeId ? document.getElementById(this.activeId) : null;
    }

    move(step) {
      const items = this.visibleItems();
      if (!items.length) return;
      const index = items.indexOf(this.active());
      const next = index === -1 ? (step > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, index + step));
      this.setActive(items[next]);
    }

    choose(item) {
      if (!item || item.getAttribute('aria-disabled') === 'true') return;
      const option = this.select.options[Number(item.dataset.index)];
      if (this.multiple) {
        option.selected = !option.selected;
        this.renderButton();
        item.setAttribute('aria-selected', String(option.selected));
        this.setActive(item, false);
        this.changed();
        return;
      }
      const changed = !option.selected;
      if (changed) {
        this.select.selectedIndex = Number(item.dataset.index);
        this.changed();
      }
      this.close();
    }

    clear() {
      const picked = this.options().filter(option => option.selected);
      if (!picked.length) return;
      picked.forEach(option => { option.selected = false; });
      this.render();
      this.changed();
    }

    setMatch(value) {
      if (this.matchInput.value === value) return;
      this.matchInput.value = value;
      this.renderButton();
      this.changed();
    }

    changed() {
      this.select.dispatchEvent(new Event('input', { bubbles: true }));
      this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    filter(resetActive = true) {
      const query = this.search.value.trim().toLowerCase();
      this.items.forEach(item => {
        item.hidden = !!query && !item.querySelector('.cselect-label').textContent.toLowerCase().includes(query);
      });
      this.list.querySelectorAll('.cselect-group').forEach(group => {
        group.hidden = ![...group.querySelectorAll('[role="option"]')].some(item => !item.hidden);
      });
      this.empty.hidden = this.items.some(item => !item.hidden);
      if (resetActive) this.setActive(this.visibleItems()[0], false);
    }

    // ─── Keyboard ───────────────────────────────────────────────────────────
    onButtonKey(event) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.open();
        if (event.key === 'ArrowUp') this.move(-1);
      }
    }

    onListKey(event, fromSearch) {
      switch (event.key) {
        case 'ArrowDown': event.preventDefault(); this.move(1); break;
        case 'ArrowUp': event.preventDefault(); this.move(-1); break;
        case 'Home': if (fromSearch) return; event.preventDefault(); this.setActive(this.visibleItems()[0]); break;
        case 'End': if (fromSearch) return; event.preventDefault(); this.setActive(this.visibleItems().slice(-1)[0]); break;
        case 'PageDown': event.preventDefault(); this.move(8); break;
        case 'PageUp': event.preventDefault(); this.move(-8); break;
        case 'Enter': event.preventDefault(); this.choose(this.active()); break;
        case ' ':
          if (fromSearch) return; // a space typed into the filter
          event.preventDefault();
          this.choose(this.active());
          break;
        case 'Escape': event.preventDefault(); event.stopPropagation(); this.close(); break;
        case 'Tab': this.close(false); break;
        default:
          if (!fromSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            this.typeAhead(event.key);
          }
      }
    }

    // Typing jumps to the next option starting with what was typed (letters typed quickly add up)
    typeAhead(char) {
      const now = Date.now();
      this.typed = now - this.typedAt < 600 ? this.typed + char.toLowerCase() : char.toLowerCase();
      this.typedAt = now;
      const items = this.visibleItems();
      const start = items.indexOf(this.active());
      const ordered = this.typed.length === 1 ? [...items.slice(start + 1), ...items.slice(0, start + 1)] : [...items.slice(start), ...items.slice(0, start)];
      const startsWith = (text) => ordered.find(item => item.querySelector('.cselect-label').textContent.trim().toLowerCase().startsWith(text));
      let hit = startsWith(this.typed);
      if (!hit && this.typed.length > 1) {
        this.typed = char.toLowerCase();
        hit = [...items.slice(start + 1), ...items.slice(0, start + 1)].find(item => item.querySelector('.cselect-label').textContent.trim().toLowerCase().startsWith(this.typed));
      }
      if (hit) this.setActive(hit);
    }
  }

  // ─── Page wiring ──────────────────────────────────────────────────────────
  function enhance(select) {
    if (!select || select.dataset.selectReady) return null;
    listenOnce();
    select.dataset.selectReady = '1';
    const instance = new CustomSelect(select);
    select.customSelect = instance;
    return instance;
  }

  // Clicks outside close the open list; it follows the button when the page scrolls or resizes
  let listening = false;
  function listenOnce() {
    if (listening) return;
    listening = true;
    watchSetters();
    const outside = (event) => {
      if (openInstance && !openInstance.wrapper.contains(event.target)) openInstance.close(false);
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('touchstart', outside, { passive: true });
    window.addEventListener('resize', () => openInstance && openInstance.place());
    window.addEventListener('scroll', (event) => {
      if (openInstance && !openInstance.popup.contains(event.target)) openInstance.place();
    }, true);
  }

  let observing = false;
  function enhanceAll(root = document) {
    root.querySelectorAll('select[data-select]').forEach(enhance);
    if (observing || !document.body) return;
    observing = true;
    new MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches('select[data-select]')) enhance(node);
          else node.querySelectorAll('select[data-select]').forEach(enhance);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { enhance, enhanceAll, CustomSelect };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => enhanceAll());
  } else {
    enhanceAll();
  }
})();
