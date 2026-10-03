/**
 * Admin → Audit logs (views/admin-audit-logs.ejs): times in the reader's time zone, a log's details in a modal,
 * the maintenance buttons.
 */
(function () {
  document.querySelectorAll('time[data-local]').forEach(time => {
    const date = new Date(time.dateTime);
    if (Number.isNaN(date.getTime())) return;
    time.title = time.textContent;
    time.textContent = date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  });

  document.addEventListener('click', (e) => {
    const button = e.target.closest('.log-details[data-details]');
    if (!button) return;
    const details = button.dataset.details;
    let text = details;
    try { text = JSON.stringify(JSON.parse(details), null, 2); } catch (error) { /* not JSON: show as stored */ }
    document.getElementById('detailsContent').textContent = text;
    openModal('detailsModal');
  });

  const MAINTENANCE = {
    backup: { question: 'Back up the database now?', title: 'Back up database', label: 'Back up' },
    cleanup: { question: 'Delete the log entries older than the retention period now?', title: 'Clean up old entries', label: 'Clean up' }
  };

  document.querySelectorAll('[data-maintenance]').forEach(button => {
    button.addEventListener('click', async () => {
      const job = MAINTENANCE[button.dataset.maintenance];
      if (!(await confirmAction(job.question, job.title, false, job.label))) return;
      setButtonLoading(button, true);
      try {
        const data = await apiRequest(`/api/admin/maintenance/${button.dataset.maintenance}`, { method: 'POST' });
        showToast(data.message || 'Done');
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        showToast(error.message, 'error');
        setButtonLoading(button, false);
      }
    });
  });
})();
