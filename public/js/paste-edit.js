// Paste editor (/pastes/:id/edit): tags, the size line, the save bar and saving through PATCH /api/pastes/:id.
(function () {
  const editor = document.getElementById('pasteEditor');
  if (!editor) return;
  const pasteId = editor.dataset.pasteId;
  const $ = (id) => document.getElementById(id);
  let unsaved = false;

  function setUnsaved(value) {
    unsaved = value;
    $('saveBar').dataset.state = value ? 'dirty' : 'clean';
    $('saveStatus').textContent = value ? 'Unsaved changes' : 'No unsaved changes';
  }

  function showSize() {
    const text = $('peContent').value;
    const lines = text === '' ? 0 : text.split('\n').length;
    const kb = new Blob([text]).size / 1024;
    $('peSize').textContent = `${lines} ${lines === 1 ? 'line' : 'lines'} · ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }

  const preset = ($('peTags').value || '').split(',').map((s) => s.trim()).filter(Boolean);
  new TagSelector('peTagSelectorMount', {
    placeholder: 'Add tags…',
    selectedTags: preset,
    onChange: (tags) => {
      $('peTags').value = tags.join(',');
      setUnsaved(true);
    }
  });

  editor.addEventListener('input', (e) => {
    if (e.target.matches('input, textarea')) setUnsaved(true);
    if (e.target.id === 'peContent') showSize();
  });
  editor.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"], input[type="date"]')) setUnsaved(true);
  });
  showSize();

  async function save() {
    const button = $('peSaveBtn');
    const body = {
      title: $('peTitle').value,
      language: $('peLanguage').value,
      content: $('peContent').value,
      expiresAt: $('peExpiresAt').value || null,
      maxViews: $('peMaxViews').value || null,
      tags: $('peTags').value
    };
    const remove = $('peRemovePassword');
    const password = $('pePassword').value;
    if (remove && remove.checked) body.removePassword = '1';
    else if (password) body.password = password;

    setButtonLoading(button, true);
    try {
      await apiRequest(`/api/pastes/${pasteId}`, { method: 'PATCH', body: JSON.stringify(body) });
      setUnsaved(false);
      editor.querySelector('.page-title').textContent = body.title.trim() || 'Untitled paste';
      // The password section says whether there is one: show it as saved
      if (body.password || body.removePassword) return window.location.reload();
      showToast('Saved');
    } catch (error) {
      showToast(error.message || 'Could not save the paste', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  $('peSaveBtn').addEventListener('click', save);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!unsaved) return;
    e.preventDefault();
    e.returnValue = '';
  });
})();
