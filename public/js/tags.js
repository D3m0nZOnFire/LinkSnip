/**
 * Tags page (views/tags.ejs): edit (name, color) and delete. Rows carry data-tag-id/-name/-color.
 */
(function () {
  'use strict';

  const HEX = /^#[0-9A-Fa-f]{6}$/;
  let editing = null;

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  const picker = document.getElementById('editTagColor');
  const hex = document.getElementById('editTagColorHex');
  picker.addEventListener('input', () => { hex.value = picker.value; });
  hex.addEventListener('input', () => { if (HEX.test(hex.value)) picker.value = hex.value; });

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    const row = button && button.closest('tr[data-tag-id]');
    if (!row) return;
    const { tagId, tagName, tagColor } = row.dataset;

    if (button.dataset.action === 'edit') {
      editing = tagId;
      document.getElementById('editTagName').value = tagName;
      picker.value = HEX.test(tagColor) ? tagColor : '#34d399';
      hex.value = tagColor;
      openModal('editTagModal');
    } else if (button.dataset.action === 'delete') {
      const sure = await confirmAction(`Delete the tag "${tagName}"? It is removed from every item that has it.`, 'Delete tag');
      if (!sure) return;
      try {
        await apiRequest(`/api/tags/${tagId}`, { method: 'DELETE' });
        showToast('Tag deleted');
        setTimeout(() => location.reload(), 600);
      } catch (error) {
        showToast(error.message, 'error');
      }
    }
  });

  document.getElementById('editTagForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editing) return;
    const name = document.getElementById('editTagName').value.trim();
    const color = hex.value.trim();
    if (!name) return showToast('The name is required', 'error');
    if (!HEX.test(color)) return showToast('Use a color like #34d399', 'error');

    const save = document.getElementById('saveTagBtn');
    setButtonLoading(save, true);
    try {
      await apiRequest(`/api/tags/${editing}`, { method: 'PUT', body: JSON.stringify({ name, color }) });
      showToast('Tag saved');
      closeModal('editTagModal');
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      showToast(error.message, 'error');
      setButtonLoading(save, false);
    }
  });
})();
