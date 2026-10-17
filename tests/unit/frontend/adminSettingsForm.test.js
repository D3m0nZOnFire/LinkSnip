/**
 * @jest-environment jsdom
 */

// Admin → Settings (public/js/admin-settings.js): the form becomes { key: value } with each field's type.

document.body.innerHTML = `
  <form id="settingsForm">
    <input type="checkbox" data-key="features.teams" data-type="boolean" checked>
    <input type="number" data-key="pastes.maxSizeKB" data-type="integer" value="512">
    <input type="number" data-key="files.globalMaxFileSizeMB" data-type="integer" data-nullable="true" value="">
    <input type="text" data-key="legal.contact" data-type="string" value="  abuse@example.com  ">
  </form>`;
const { readForm } = require('../../../public/js/admin-settings');

it('reads booleans, numbers, empty nullable numbers and text', () => {
  expect(readForm()).toEqual({
    'features.teams': true,
    'pastes.maxSizeKB': 512,
    'files.globalMaxFileSizeMB': null,
    'legal.contact': 'abuse@example.com'
  });
});

it('an emptied text field saves as empty text', () => {
  document.querySelector('[data-key="legal.contact"]').value = '';
  expect(readForm()['legal.contact']).toBe('');
});
