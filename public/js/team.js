/**
 * Team page (views/team.ejs): roles, removing members, invites, rename, leave and delete.
 * Each action calls the team API; the page reloads to show the result.
 */
(function () {
  const page = document.getElementById('teamPage');
  if (!page) return;
  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });
  const teamId = page.dataset.teamId;
  const teamName = page.dataset.teamName;

  async function send(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    try {
      return await response.json();
    } catch (e) {
      return { success: false, error: `Request failed (${response.status}).` };
    }
  }

  function show(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message || '';
  }

  document.querySelectorAll('.member-role-select').forEach(select => {
    const original = select.value;
    select.addEventListener('change', async () => {
      show('membersError');
      const data = await send('PATCH', `/api/teams/${teamId}/members/${select.dataset.memberId}`, { role: select.value });
      if (data.success) window.location.reload();
      else { select.value = original; show('membersError', data.error); }
    });
  });

  document.querySelectorAll('.remove-member').forEach(button => {
    button.addEventListener('click', async () => {
      if (!confirm(`Remove ${button.dataset.username} from the team? The items they created stay.`)) return;
      const data = await send('DELETE', `/api/teams/${teamId}/members/${button.dataset.memberId}`);
      if (data.success) window.location.reload();
      else show('membersError', data.error);
    });
  });

  const inviteForm = document.getElementById('inviteForm');
  if (inviteForm) {
    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      show('inviteError');
      const data = await send('POST', `/api/teams/${teamId}/invites`, {
        username: document.getElementById('inviteUsername').value,
        role: document.getElementById('inviteRole').value
      });
      if (data.success) window.location.reload();
      else show('inviteError', data.error);
    });
  }

  document.querySelectorAll('.revoke-invite').forEach(button => {
    button.addEventListener('click', async () => {
      const data = await send('DELETE', `/api/team-invites/${button.dataset.inviteId}`);
      if (data.success) window.location.reload();
      else show('inviteError', data.error);
    });
  });

  const renameForm = document.getElementById('renameForm');
  if (renameForm) {
    renameForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      show('renameError');
      const data = await send('PATCH', `/api/teams/${teamId}`, { name: document.getElementById('renameInput').value });
      if (data.success) window.location.reload();
      else show('renameError', data.error);
    });
  }

  const leaveButton = document.getElementById('leaveTeamBtn');
  if (leaveButton) {
    leaveButton.addEventListener('click', async () => {
      if (!confirm(`Leave ${teamName}?`)) return;
      const data = await send('POST', `/api/teams/${teamId}/leave`);
      if (data.success) window.location.href = '/teams';
      else show('leaveError', data.error);
    });
  }

  const deleteButton = document.getElementById('deleteTeamBtn');
  if (deleteButton) {
    const input = document.getElementById('confirmTeamName');
    const confirmButton = document.getElementById('confirmDeleteBtn');
    deleteButton.addEventListener('click', () => {
      input.value = '';
      confirmButton.disabled = true;
      show('deleteError');
      openModal('deleteTeamModal');
      input.focus();
    });
    input.addEventListener('input', () => { confirmButton.disabled = input.value.trim() !== teamName; });
    document.getElementById('deleteTeamForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      confirmButton.disabled = true;
      const data = await send('DELETE', `/api/teams/${teamId}`, { confirmName: input.value });
      if (data.success) window.location.href = '/teams';
      else { show('deleteError', data.error); confirmButton.disabled = false; }
    });
  }
})();
