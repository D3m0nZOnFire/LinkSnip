/**
 * Admin → Reports (views/admin-reports.ejs): decide on quarantined items and on single reports.
 */
(function () {
  const json = (method, body) => ({ method, body: JSON.stringify(body) });

  // Confirm, send, then reload (or show the error)
  async function send(url, options, question, { title = 'Confirm', destructive = true, label = null } = {}) {
    if (!(await confirmAction(question, title, destructive, label))) return;
    try {
      const data = await apiRequest(url, options);
      if (data.message && url.endsWith('/ban-user')) showToast(data.message);
      setTimeout(() => location.reload(), data.message ? 900 : 0);
    } catch (error) {
      showToast(error.message || 'Action failed', 'error');
    }
  }

  document.addEventListener('click', (e) => {
    const moderate = e.target.closest('[data-moderate]');
    if (moderate) {
      const row = moderate.closest('tr');
      const action = moderate.dataset.moderate;
      send(`/api/admin/moderation/${row.dataset.type}/${row.dataset.id}/${action}`, { method: 'POST' }, action === 'block'
        ? 'Block this for good? Visitors will no longer be able to open it.'
        : 'Clear it? Its pending reports are dismissed and the warning is lifted.',
      action === 'block' ? { title: 'Block item', label: 'Block' } : { title: 'Clear item', destructive: false, label: 'Clear' });
      return;
    }

    const button = e.target.closest('tr[data-report-id] [data-action]');
    if (!button) return;
    const row = button.closest('tr');
    const id = row.dataset.reportId;
    const path = row.dataset.path;
    switch (button.dataset.action) {
      case 'block':
        return send(`/api/admin/reports/${id}`, json('PUT', { action: 'block' }), `Block ${path}?`, { title: 'Block item', label: 'Block' });
      case 'unblock':
        return send(`/api/admin/reports/${id}`, json('PUT', { action: 'unblock' }), `Unblock ${path}?`, { title: 'Unblock item', destructive: false, label: 'Unblock' });
      case 'dismiss':
        return send(`/api/admin/reports/${id}`, json('PUT', { status: 'dismissed' }), 'Dismiss this report?', { title: 'Dismiss report', destructive: false, label: 'Dismiss' });
      case 'delete':
        return send(`/api/admin/reports/${id}`, { method: 'DELETE' }, 'Delete this report for good?', { title: 'Delete report' });
      case 'ban':
        return send(`/api/admin/reports/${id}/ban-user`, json('POST', { userId: Number(row.dataset.ownerId) }),
          `Ban ${row.dataset.owner}? This will:\n- block everything they own (links, bundles, pastes, files)\n- stop them from logging in\n- mark the report as blocked\n\nThe ban can be lifted on the Users page; their items stay blocked until unblocked.`,
          { title: 'Ban user', label: 'Ban' });
    }
  });
})();
