/**
 * Admin → Analytics shares (views/admin-analytics-shares.ejs): revoke a share link.
 */
document.addEventListener('click', async (e) => {
  const button = e.target.closest('tr[data-link-id] [data-revoke]');
  if (!button) return;
  const row = button.closest('tr');
  const ok = await confirmAction(`Revoke the share link for ${row.dataset.path}? Anyone using it loses access.`, 'Revoke share link', true, 'Revoke');
  if (!ok) return;
  try {
    await apiRequest(`/api/share-links/${row.dataset.linkId}`, { method: 'DELETE' });
    row.remove();
    showToast('Share link revoked');
  } catch (error) {
    showToast(error.message || 'Could not revoke the link', 'error');
  }
});
