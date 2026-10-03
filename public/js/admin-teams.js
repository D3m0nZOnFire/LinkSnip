/**
 * Admin → Teams (views/admin-teams.ejs): delete a team (its exact name confirms it).
 */
document.querySelectorAll('.delete-team').forEach(button => {
  button.addEventListener('click', async () => {
    const name = button.dataset.teamName;
    const typed = prompt(`Delete the team "${name}" and all its items? Type its name to confirm.`);
    if (typed === null) return;
    try {
      await apiRequest(`/api/teams/${button.dataset.teamId}`, { method: 'DELETE', body: JSON.stringify({ confirmName: typed }) });
      window.location.reload();
    } catch (error) {
      showToast(error.message || 'Could not delete the team.', 'error');
    }
  });
});
