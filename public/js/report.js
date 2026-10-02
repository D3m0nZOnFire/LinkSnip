/**
 * The report box (views/partials/report-modal.ejs): opened by any [data-report-button], sends POST /api/reports.
 * After a report (or "already reported") the buttons read "Reported", remembered in localStorage per item.
 */
(function () {
  'use strict';

  const modal = document.getElementById('reportModal');
  if (!modal) return;
  const report = { type: modal.dataset.reportType, id: Number(modal.dataset.reportId) };
  const KEY = `reported_${report.type}_${report.id}`;
  const form = document.getElementById('reportForm');
  const error = document.getElementById('reportError');
  const done = document.getElementById('reportSuccess');
  const submit = document.getElementById('reportSubmit');
  const fields = form.querySelector('.report-fields');

  const remembered = () => { try { return !!localStorage.getItem(KEY); } catch (_) { return false; } };
  const remember = () => { try { localStorage.setItem(KEY, '1'); } catch (_) { /* private mode */ } };

  function markAsReported() {
    document.querySelectorAll('[data-report-button]').forEach(button => { button.disabled = true; });
    document.querySelectorAll('[data-report-label]').forEach(label => { label.textContent = 'Reported'; });
  }

  function open() {
    form.reset();
    fields.hidden = false;
    error.hidden = true;
    done.hidden = true;
    submit.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Send report';
    modal.classList.add('active');
    setTimeout(() => document.getElementById('reportReason').focus(), 50);
  }

  function close() {
    modal.classList.remove('active');
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-report-button]')) open();
    else if (event.target.closest('[data-report-close]') || event.target === modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('active')) close();
  });

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Send report';
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const reason = document.getElementById('reportReason').value;
    if (!reason) return showError('Choose a reason.');
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...report, reason, description: document.getElementById('reportDescription').value })
      });
      const data = await response.json().catch(() => ({}));
      if (data.success) {
        done.textContent = data.message || 'Thanks, the report was sent.';
        done.hidden = false;
        fields.hidden = true;
        submit.hidden = true;
        remember();
        markAsReported();
        setTimeout(close, 2000);
      } else if (data.error && /already reported/i.test(data.error)) {
        remember();
        markAsReported();
        close();
      } else {
        showError(data.error || 'The report could not be sent.');
      }
    } catch (_) {
      showError('Network error. Please try again.');
    }
  });

  if (remembered()) markAsReported();
})();
