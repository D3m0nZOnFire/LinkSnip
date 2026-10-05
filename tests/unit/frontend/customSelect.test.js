/**
 * @jest-environment jsdom
 */

// public/js/customSelect.js: select[data-select] becomes a button + a styled list. The native <select> stays (hidden)
// and is kept in sync: forms submit it, page scripts read and set it, and picking fires its `change`.

const { enhance, enhanceAll } = require('../../../public/js/customSelect');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const key = (el, name, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra }));
const wrapperOf = (select) => select.closest('.cselect');
const buttonOf = (select) => wrapperOf(select).querySelector('.cselect-button');
const listOf = (select) => wrapperOf(select).querySelector('[role="listbox"]');
const optionsOf = (select) => [...listOf(select).querySelectorAll('[role="option"]')];
const optionEl = (select, value) => optionsOf(select).find(o => o.dataset.value === value);
const isOpen = (select) => buttonOf(select).getAttribute('aria-expanded') === 'true';
const activeOf = (select) => document.getElementById(listOf(select).getAttribute('aria-activedescendant'));

function setup(html) {
  document.body.innerHTML = html;
  const select = document.querySelector('select');
  enhance(select);
  return select;
}

const SORT = `
  <form id="f">
    <label for="sort">Sort</label>
    <select id="sort" name="sort" class="form-input" data-select>
      <option value="newest">Newest</option>
      <option value="oldest" selected>Oldest</option>
      <option value="gone" disabled>Gone</option>
      <option value="most">Most used</option>
    </select>
  </form>`;

const TAGS = `
  <form id="f">
    <input type="hidden" id="match" name="match" value="any">
    <select id="tags" name="tag" multiple data-select data-select-search data-select-match="match" data-placeholder="All tags">
      <option value="work" data-color="#34d399" data-hint="12">work</option>
      <option value="travel" data-color="#60a5fa" data-hint="4">travel</option>
      <option value="recipes" data-color="red; background: url(x)" data-hint="7">recipes</option>
      <option value="old">old</option>
    </select>
  </form>`;

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {}; // not in jsdom
});

describe('single select', () => {
  it('shows the chosen option on a button; the native select stays in the form, hidden', () => {
    const select = setup(SORT);
    const button = buttonOf(select);
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.textContent).toContain('Oldest');
    expect(button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.classList.contains('form-input')).toBe(true);
    expect(select.classList.contains('cselect-native')).toBe(true);
    expect(select.tabIndex).toBe(-1);
    expect(new FormData(document.getElementById('f')).get('sort')).toBe('oldest');
  });

  it('enhancing twice does nothing more', () => {
    const select = setup(SORT);
    enhance(select);
    expect(document.querySelectorAll('.cselect').length).toBe(1);
  });

  it('the label names the button, and clicking the label focuses it', () => {
    const select = setup(SORT);
    const button = buttonOf(select);
    const label = document.querySelector('label');
    expect(button.getAttribute('aria-labelledby').split(' ')).toContain(label.id);
    label.click();
    expect(document.activeElement).toBe(button);
  });

  it('opens on click and marks the chosen option', () => {
    const select = setup(SORT);
    buttonOf(select).click();
    expect(isOpen(select)).toBe(true);
    expect(wrapperOf(select).querySelector('.cselect-popup').hidden).toBe(false);
    expect(optionsOf(select).map(o => o.textContent.trim())).toEqual(['Newest', 'Oldest', 'Gone', 'Most used']);
    expect(optionEl(select, 'oldest').getAttribute('aria-selected')).toBe('true');
    expect(optionEl(select, 'newest').getAttribute('aria-selected')).toBe('false');
    expect(optionEl(select, 'gone').getAttribute('aria-disabled')).toBe('true');
  });

  it('picking an option sets the select, fires one bubbling change, closes and refocuses the button', () => {
    const select = setup(SORT);
    const changes = [];
    document.getElementById('f').addEventListener('change', (e) => changes.push(e.target));
    buttonOf(select).click();
    optionEl(select, 'most').click();
    expect(select.value).toBe('most');
    expect(changes).toEqual([select]);
    expect(isOpen(select)).toBe(false);
    expect(buttonOf(select).textContent).toContain('Most used');
    expect(document.activeElement).toBe(buttonOf(select));
  });

  it('picking the current option again fires no change', () => {
    const select = setup(SORT);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);
    buttonOf(select).click();
    optionEl(select, 'oldest').click();
    expect(onChange).not.toHaveBeenCalled();
    expect(isOpen(select)).toBe(false);
  });

  it('a disabled option cannot be picked', () => {
    const select = setup(SORT);
    buttonOf(select).click();
    optionEl(select, 'gone').click();
    expect(select.value).toBe('oldest');
    expect(isOpen(select)).toBe(true);
  });

  it('keyboard: arrows open and move (skipping disabled), Enter picks', () => {
    const select = setup(SORT);
    const button = buttonOf(select);
    key(button, 'ArrowDown');
    expect(isOpen(select)).toBe(true);
    expect(activeOf(select).dataset.value).toBe('oldest');
    key(listOf(select), 'ArrowDown');
    expect(activeOf(select).dataset.value).toBe('most');
    key(listOf(select), 'ArrowUp');
    expect(activeOf(select).dataset.value).toBe('oldest');
    key(listOf(select), 'Home');
    expect(activeOf(select).dataset.value).toBe('newest');
    key(listOf(select), 'End');
    expect(activeOf(select).dataset.value).toBe('most');
    key(listOf(select), 'Enter');
    expect(select.value).toBe('most');
    expect(isOpen(select)).toBe(false);
  });

  it('keyboard: Escape closes without a change, back on the button', () => {
    const select = setup(SORT);
    key(buttonOf(select), 'Enter');
    expect(isOpen(select)).toBe(true);
    key(listOf(select), 'ArrowDown');
    key(listOf(select), 'Escape');
    expect(isOpen(select)).toBe(false);
    expect(select.value).toBe('oldest');
    expect(document.activeElement).toBe(buttonOf(select));
  });

  it('keyboard: typing jumps to the option that starts with it', () => {
    const select = setup(SORT);
    key(buttonOf(select), 'ArrowDown');
    key(listOf(select), 'm');
    expect(activeOf(select).dataset.value).toBe('most');
    key(listOf(select), 'n');
    expect(activeOf(select).dataset.value).toBe('newest');
  });

  it('Tab and a click outside close it', () => {
    const select = setup(SORT);
    buttonOf(select).click();
    key(listOf(select), 'Tab');
    expect(isOpen(select)).toBe(false);
    buttonOf(select).click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(isOpen(select)).toBe(false);
  });

  it('only one list is open at a time', () => {
    document.body.innerHTML = '<select id="a" data-select><option>1</option></select><select id="b" data-select><option>2</option></select>';
    enhanceAll(document);
    const [a, b] = document.querySelectorAll('select');
    buttonOf(a).click();
    buttonOf(b).click();
    expect(isOpen(a)).toBe(false);
    expect(isOpen(b)).toBe(true);
  });

  it('follows a value set by a script', () => {
    const select = setup(SORT);
    select.value = 'newest';
    expect(buttonOf(select).textContent).toContain('Newest');
    select.selectedIndex = 3;
    expect(buttonOf(select).textContent).toContain('Most used');
    expect(select.value).toBe('most');
  });

  it('follows options rebuilt by a script', async () => {
    const select = setup(SORT);
    select.innerHTML = '<option value="x">Ex</option><option value="y" selected>Why</option>';
    await tick();
    expect(buttonOf(select).textContent).toContain('Why');
    buttonOf(select).click();
    expect(optionsOf(select).map(o => o.dataset.value)).toEqual(['x', 'y']);
  });

  it('follows the disabled state of the select', async () => {
    const select = setup(SORT);
    select.disabled = true;
    await tick();
    expect(buttonOf(select).disabled).toBe(true);
    select.disabled = false;
    await tick();
    expect(buttonOf(select).disabled).toBe(false);
  });

  it('focusing the select (a script does it) focuses the button', () => {
    const select = setup(SORT);
    select.focus();
    expect(document.activeElement).toBe(buttonOf(select));
  });

  it('shows option groups as headings', () => {
    const select = setup(`<select data-select>
      <optgroup label="Dark palettes"><option value="d1">Night</option></optgroup>
      <optgroup label="Light palettes"><option value="l1">Day</option></optgroup></select>`);
    buttonOf(select).click();
    const groups = [...listOf(select).querySelectorAll('[role="group"]')];
    expect(groups.map(g => g.querySelector('.cselect-group-label').textContent)).toEqual(['Dark palettes', 'Light palettes']);
    optionEl(select, 'l1').click();
    expect(select.value).toBe('l1');
  });

  it('puts option text in as text, never as HTML', () => {
    const select = setup('<select data-select><option value="x">&lt;img src=x onerror=alert(1)&gt;</option></select>');
    buttonOf(select).click();
    expect(wrapperOf(select).querySelector('img')).toBeNull();
    expect(optionEl(select, 'x').textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('multiple select (the tag filter)', () => {
  const pick = (select, value) => optionEl(select, value).click();

  it('shows the placeholder, then the picked names', () => {
    const select = setup(TAGS);
    const label = () => buttonOf(select).querySelector('.cselect-value').textContent;
    expect(label()).toBe('All tags');
    buttonOf(select).click();
    pick(select, 'work');
    expect(label()).toBe('work');
    pick(select, 'travel');
    expect(label()).toBe('work, travel');
    pick(select, 'old');
    expect(label()).toBe('work +2');
  });

  it('toggles options, stays open, and fires a change each time', () => {
    const select = setup(TAGS);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);
    buttonOf(select).click();
    pick(select, 'work');
    pick(select, 'travel');
    pick(select, 'work');
    expect([...select.selectedOptions].map(o => o.value)).toEqual(['travel']);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(isOpen(select)).toBe(true);
    expect(listOf(select).getAttribute('aria-multiselectable')).toBe('true');
    expect(optionEl(select, 'travel').getAttribute('aria-selected')).toBe('true');
    expect(new FormData(document.getElementById('f')).getAll('tag')).toEqual(['travel']);
  });

  it('Space and Enter toggle the active option from the keyboard', () => {
    const select = setup(TAGS);
    key(buttonOf(select), 'ArrowDown');
    key(wrapperOf(select).querySelector('.cselect-search'), ' ');
    expect(select.selectedOptions.length).toBe(0); // in the search field a space is typed, not a pick
    const list = listOf(select);
    list.focus();
    key(list, 'Home');
    key(list, ' ');
    expect([...select.selectedOptions].map(o => o.value)).toEqual(['work']);
    key(list, 'ArrowDown');
    key(list, 'Enter');
    expect([...select.selectedOptions].map(o => o.value)).toEqual(['work', 'travel']);
    expect(isOpen(select)).toBe(true);
  });

  it('Clear unticks everything with one change', () => {
    const select = setup(TAGS);
    buttonOf(select).click();
    pick(select, 'work');
    pick(select, 'old');
    const onChange = jest.fn();
    select.addEventListener('change', onChange);
    wrapperOf(select).querySelector('.cselect-clear').click();
    expect(select.selectedOptions.length).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows a color dot for a hex color only, and the hint', () => {
    const select = setup(TAGS);
    buttonOf(select).click();
    const dot = (value) => optionEl(select, value).querySelector('.cselect-dot');
    expect(dot('work').style.getPropertyValue('--dot-color')).toBe('#34d399');
    expect(dot('recipes')).toBeNull();
    expect(dot('old')).toBeNull();
    expect(optionEl(select, 'work').querySelector('.cselect-hint').textContent).toBe('12');
  });

  it('the button shows the dots of the picked tags', () => {
    const select = setup(TAGS);
    buttonOf(select).click();
    pick(select, 'work');
    pick(select, 'travel');
    const dots = [...buttonOf(select).querySelectorAll('.cselect-dot')];
    expect(dots.map(d => d.style.getPropertyValue('--dot-color'))).toEqual(['#34d399', '#60a5fa']);
  });

  it('the search field filters the options; arrows only visit what is shown', () => {
    const select = setup(TAGS);
    buttonOf(select).click();
    const search = wrapperOf(select).querySelector('.cselect-search');
    expect(document.activeElement).toBe(search);
    search.value = 'RE';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(optionsOf(select).filter(o => !o.hidden).map(o => o.dataset.value)).toEqual(['recipes']);
    expect(activeOf(select).dataset.value).toBe('recipes');
    key(search, 'ArrowDown');
    expect(activeOf(select).dataset.value).toBe('recipes');
    key(search, 'Enter');
    expect([...select.selectedOptions].map(o => o.value)).toEqual(['recipes']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(wrapperOf(select).querySelector('.cselect-empty').hidden).toBe(false);
  });

  it('the Any | All switch shows from two picks on, writes its input and fires the select\'s change', () => {
    const select = setup(TAGS);
    const match = document.getElementById('match');
    const bar = () => wrapperOf(select).querySelector('.cselect-match');
    buttonOf(select).click();
    pick(select, 'work');
    expect(bar().hidden).toBe(true);
    pick(select, 'travel');
    expect(bar().hidden).toBe(false);
    const onChange = jest.fn();
    select.addEventListener('change', onChange);
    const allButton = bar().querySelector('[data-match="all"]');
    allButton.click();
    expect(match.value).toBe('all');
    expect(allButton.getAttribute('aria-pressed')).toBe('true');
    expect(bar().querySelector('[data-match="any"]').getAttribute('aria-pressed')).toBe('false');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(buttonOf(select).querySelector('.cselect-value').textContent).toBe('work, travel');
    expect(buttonOf(select).textContent).toContain('all');
    allButton.click();
    expect(onChange).toHaveBeenCalledTimes(1); // already "all"
  });

  it('starts from what the page rendered (picked options, match all)', () => {
    document.body.innerHTML = TAGS.replace('value="any"', 'value="all"')
      .replace('value="work"', 'value="work" selected').replace('value="old"', 'value="old" selected');
    const select = document.querySelector('select');
    enhance(select);
    expect(buttonOf(select).querySelector('.cselect-value').textContent).toBe('work, old');
    buttonOf(select).click();
    expect(wrapperOf(select).querySelector('[data-match="all"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('enhancing the page', () => {
  it('enhanceAll takes every select[data-select] and leaves the others', () => {
    document.body.innerHTML = '<select data-select><option>1</option></select><select id="plain"><option>2</option></select>';
    enhanceAll(document);
    expect(document.querySelectorAll('.cselect').length).toBe(1);
    expect(document.getElementById('plain').closest('.cselect')).toBeNull();
  });

  it('selects added later (results swapped in, modals) are enhanced too', async () => {
    document.body.innerHTML = '<div id="results"></div>';
    enhanceAll(document);
    document.getElementById('results').innerHTML = '<select id="late" data-select><option>1</option></select>';
    await tick();
    expect(document.getElementById('late').closest('.cselect')).not.toBeNull();
  });
});
