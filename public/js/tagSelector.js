/**
 * Notion-style Multi-Select Tag Selector
 *
 * Features:
 * - Dropdown showing existing tags
 * - Search/filter as you type
 * - Multi-select capability
 * - Create new tags by typing and pressing Enter
 */

class TagSelector {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`TagSelector: Container with id "${containerId}" not found`);
      return;
    }

    this.options = {
      placeholder: options.placeholder || 'Add tags...',
      existingTags: options.existingTags || [],
      selectedTags: options.selectedTags || [],
      allowCreate: options.allowCreate !== false, // Default true
      maxTags: options.maxTags || null,
      onChange: options.onChange || (() => {}),
      ...options
    };

    this.allTags = [...this.options.existingTags];
    this.selectedTags = new Set(this.options.selectedTags);
    this.isOpen = false;

    this.init();
  }

  init() {
    this.render();
    this.attachEventListeners();

    // Load tags from API if user is logged in
    this.loadTagsFromAPI();
  }

  async loadTagsFromAPI() {
    try {
      const response = await fetch('/api/tags');
      if (response.ok) {
        const tags = await response.json();
        this.allTags = tags.map(t => ({
          name: t.name,
          color: t.color
        }));
        this.updateDropdown();
      }
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="tag-selector">
        <div class="tag-selector-input-wrapper">
          <div class="tag-selector-tags"></div>
          <input
            type="text"
            class="tag-selector-input"
            placeholder="${this.selectedTags.size === 0 ? this.options.placeholder : ''}"
            autocomplete="off"
          />
        </div>
        <div class="tag-selector-dropdown" style="display: none;">
          <div class="tag-selector-dropdown-list"></div>
        </div>
      </div>
    `;

    this.inputWrapper = this.container.querySelector('.tag-selector-input-wrapper');
    this.tagsContainer = this.container.querySelector('.tag-selector-tags');
    this.input = this.container.querySelector('.tag-selector-input');
    this.dropdown = this.container.querySelector('.tag-selector-dropdown');
    this.dropdownList = this.container.querySelector('.tag-selector-dropdown-list');

    this.renderSelectedTags();
    this.updateDropdown();
  }

  renderSelectedTags() {
    this.tagsContainer.textContent = '';
    this.selectedTags.forEach(tagName => {
      const tag = this.allTags.find(t => t.name === tagName) || { name: tagName };
      // Built from DOM nodes: tag names can hold any characters, and team members share them
      const tagElement = document.createElement('div');
      tagElement.className = 'tag-selector-tag';
      tagElement.style.setProperty('--tag-color', TagSelector.safeColor(tag.color));

      const label = document.createElement('span');
      label.textContent = tag.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-selector-tag-remove';
      remove.dataset.tag = tagName;
      remove.setAttribute('aria-label', `Remove ${tag.name}`);
      remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

      tagElement.append(label, remove);
      this.tagsContainer.appendChild(tagElement);
    });

    // Update placeholder visibility
    this.input.placeholder = this.selectedTags.size === 0 ? this.options.placeholder : '';
  }

  updateDropdown(filter = '') {
    const normalizedFilter = filter.toLowerCase().trim();

    // Filter tags that:
    // 1. Match the search filter
    // 2. Are not already selected
    const availableTags = this.allTags.filter(tag =>
      !this.selectedTags.has(tag.name) &&
      tag.name.toLowerCase().includes(normalizedFilter)
    );

    this.dropdownList.innerHTML = '';

    if (availableTags.length === 0 && normalizedFilter && this.options.allowCreate) {
      // Show "Create new tag" option
      const createOption = document.createElement('div');
      createOption.className = 'tag-selector-dropdown-item tag-selector-create-new';
      createOption.innerHTML = `
        <span>Create "<strong>${this.escapeHtml(normalizedFilter)}</strong>"</span>
      `;
      createOption.addEventListener('click', () => {
        this.addTag(normalizedFilter);
      });
      this.dropdownList.appendChild(createOption);
    } else if (availableTags.length === 0 && !normalizedFilter) {
      // Show "No tags available" message
      const emptyOption = document.createElement('div');
      emptyOption.className = 'tag-selector-dropdown-item tag-selector-empty';
      emptyOption.textContent = 'No tags available';
      this.dropdownList.appendChild(emptyOption);
    } else {
      // Show available tags
      availableTags.forEach(tag => {
        const option = document.createElement('div');
        option.className = 'tag-selector-dropdown-item';
        option.innerHTML = `
          <span class="tag-selector-dropdown-tag-color" style="background-color: ${TagSelector.safeColor(tag.color)};"></span>
          <span>${this.escapeHtml(tag.name)}</span>
        `;
        option.addEventListener('click', () => {
          this.addTag(tag.name);
        });
        this.dropdownList.appendChild(option);
      });

      // If filter doesn't match existing tags exactly, show create option
      if (normalizedFilter && this.options.allowCreate && !availableTags.some(t => t.name.toLowerCase() === normalizedFilter)) {
        const createOption = document.createElement('div');
        createOption.className = 'tag-selector-dropdown-item tag-selector-create-new';
        createOption.innerHTML = `
          <span>Create "<strong>${this.escapeHtml(normalizedFilter)}</strong>"</span>
        `;
        createOption.addEventListener('click', () => {
          this.addTag(normalizedFilter);
        });
        this.dropdownList.appendChild(createOption);
      }
    }
  }

  attachEventListeners() {
    // Input focus - open dropdown
    this.input.addEventListener('focus', () => {
      this.openDropdown();
    });

    // Input typing - filter dropdown
    this.input.addEventListener('input', (e) => {
      this.updateDropdown(e.target.value);
      if (!this.isOpen) this.openDropdown();
    });

    // Input keydown - handle Enter, Backspace, Escape
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const value = this.input.value.trim();
        if (value) {
          this.addTag(value);
        }
      } else if (e.key === 'Backspace' && this.input.value === '' && this.selectedTags.size > 0) {
        // Remove last tag
        const lastTag = Array.from(this.selectedTags).pop();
        this.removeTag(lastTag);
      } else if (e.key === 'Escape') {
        this.closeDropdown();
        this.input.blur();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusFirstDropdownItem();
      }
    });

    // Remove tag buttons
    this.container.addEventListener('click', (e) => {
      if (e.target.closest('.tag-selector-tag-remove')) {
        const tagName = e.target.closest('.tag-selector-tag-remove').dataset.tag;
        this.removeTag(tagName);
      }
    });

    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.closeDropdown();
      }
    });

    // Input wrapper click - focus input
    this.inputWrapper.addEventListener('click', (e) => {
      if (e.target === this.inputWrapper || e.target === this.tagsContainer) {
        this.input.focus();
      }
    });
  }

  addTag(tagName) {
    const normalized = tagName.toLowerCase().trim();

    if (!normalized) return;

    if (this.options.maxTags && this.selectedTags.size >= this.options.maxTags) {
      alert(`Maximum ${this.options.maxTags} tags allowed`);
      return;
    }

    if (this.selectedTags.has(normalized)) {
      // Already selected
      this.input.value = '';
      return;
    }

    // Add to selected tags
    this.selectedTags.add(normalized);

    // If tag doesn't exist in allTags, add it with default color
    if (!this.allTags.find(t => t.name === normalized)) {
      this.allTags.push({
        name: normalized,
        color: this.generateRandomColor()
      });
    }

    this.input.value = '';
    this.renderSelectedTags();
    this.updateDropdown();
    this.options.onChange(this.getSelectedTags());
  }

  removeTag(tagName) {
    this.selectedTags.delete(tagName);
    this.renderSelectedTags();
    this.updateDropdown(this.input.value);
    this.options.onChange(this.getSelectedTags());
  }

  openDropdown() {
    this.isOpen = true;
    this.dropdown.style.display = 'block';
    this.inputWrapper.classList.add('tag-selector-input-wrapper-focused');
  }

  closeDropdown() {
    this.isOpen = false;
    this.dropdown.style.display = 'none';
    this.inputWrapper.classList.remove('tag-selector-input-wrapper-focused');
  }

  focusFirstDropdownItem() {
    const firstItem = this.dropdownList.querySelector('.tag-selector-dropdown-item');
    if (firstItem) {
      firstItem.focus();
    }
  }

  getSelectedTags() {
    return Array.from(this.selectedTags);
  }

  setSelectedTags(tags) {
    this.selectedTags = new Set(tags.map(t => t.toLowerCase().trim()).filter(Boolean));
    this.renderSelectedTags();
    this.updateDropdown();
  }

  generateRandomColor() {
    const colors = [
      '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
      '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
      '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#34d399',
      '#fbbf24', '#fb923c', '#f472b6', '#c084fc', '#60a5fa', '#4ade80'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // A tag color as stored (#rrggbb), else a neutral grey: it goes into a style
  static safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#888888';
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Public method to get value in comma-separated format (for form submission)
  getValue() {
    return this.getSelectedTags().join(',');
  }

  // Public method to set value from comma-separated string
  setValue(value) {
    if (!value) {
      this.setSelectedTags([]);
      return;
    }
    const tags = value.split(',').map(t => t.trim()).filter(Boolean);
    this.setSelectedTags(tags);
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TagSelector;
}
