/**
 * @jest-environment jsdom
 */
const TagSelector = require('../../../public/js/tagSelector');

// Tag names can hold any characters, and team members share tags: a name must always show as text, never as HTML
// (a team member, or a site admin editing someone's item, would run it).
const EVIL = '<img src=x onerror="window.pwned=1">';

function mount(options) {
  document.body.innerHTML = '<div id="mount"></div>';
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ name: EVIL, color: 'red;background:url(x)' }] });
  return new TagSelector('mount', options);
}

describe('TagSelector', () => {
  it('shows a selected tag name as text', () => {
    mount({ selectedTags: [EVIL] });
    expect(document.querySelector('#mount img')).toBeNull();
    expect(document.querySelector('.tag-selector-tag').textContent).toContain(EVIL);
  });

  it('removing it still works', () => {
    const selector = mount({ selectedTags: [EVIL, 'docs'] });
    document.querySelector('.tag-selector-tag-remove').click();
    expect(selector.getSelectedTags()).toEqual(['docs']);
  });

  it('a color that is not a hex color is not used', () => {
    const selector = mount({ selectedTags: ['docs'] });
    selector.allTags = [{ name: 'docs', color: 'red;background:url(x)' }];
    selector.renderSelectedTags();
    expect(document.querySelector('.tag-selector-tag').getAttribute('style') || '').not.toContain('url(');
  });
});
