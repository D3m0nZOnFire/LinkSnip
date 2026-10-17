/**
 * Team invite banner (views/partials/team-invites.ejs): Accept opens the team, Decline reloads the page.
 */
(function () {
  'use strict';

  document.querySelectorAll('.team-invite [data-invite-id]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const response = await fetch(`/api/team-invites/${button.dataset.inviteId}/${button.dataset.action}`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (data.success && button.dataset.action === 'accept') window.location.href = `/teams/${data.teamId}`;
      else if (data.success) window.location.reload();
      else { window.alert(data.error || 'Something went wrong.'); button.disabled = false; }
    });
  });
})();
