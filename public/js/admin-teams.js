/**
 * Admin → Teams (views/admin-teams.ejs): delete a team in a dialog where its exact name has to be typed.
 */
(function () {
  const modal = document.getElementById('deleteTeamModal');
  if (!modal) return;
  const form = document.getElementById('deleteTeamForm');
  const input = document.getElementById('confirmTeamName');
  const confirmButton = document.getElementById('confirmDeleteTeamBtn');
  const error = document.getElementById('deleteTeamError');
  let team = null;

  document.querySelectorAll('.delete-team').forEach(button => {
    button.addEventListener('click', () => {
      team = { id: button.dataset.teamId, name: button.dataset.teamName };
      document.getElementById('deleteTeamTitle').textContent = `Delete ${team.name}`;
      document.getElementById('deleteTeamItems').textContent = button.dataset.teamItems || 'none';
      input.value = '';
      error.textContent = '';
      confirmButton.disabled = true;
      openModal('deleteTeamModal');
      input.focus();
    });
  });

  input.addEventListener('input', () => {
    confirmButton.disabled = !team || input.value.trim() !== team.name;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!team || confirmButton.disabled) return;
    confirmButton.disabled = true;
    try {
      await apiRequest(`/api/teams/${team.id}`, { method: 'DELETE', body: JSON.stringify({ confirmName: input.value.trim() }) });
      window.location.reload();
    } catch (err) {
      error.textContent = err.message || 'Could not delete the team.';
      confirmButton.disabled = false;
    }
  });
})();
