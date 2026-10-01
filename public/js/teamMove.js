/**
 * Dashboard: move an item into a team (personal dashboard, a modal to pick the team) or out of it (team dashboard,
 * back to its creator). Buttons carry data-move-in / data-move-out, data-type and data-id.
 */
(function () {
  async function move(type, id, teamId) {
    const response = await fetch(`/api/items/${type}/${id}/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId })
    });
    try {
      return await response.json();
    } catch (e) {
      return { success: false, error: `Request failed (${response.status}).` };
    }
  }

  let pending = null;
  const form = document.getElementById('moveToTeamForm');
  const error = document.getElementById('moveTeamError');

  document.addEventListener('click', async (event) => {
    const into = event.target.closest('[data-move-in]');
    const out = event.target.closest('[data-move-out]');
    if (into && form) {
      event.stopPropagation();
      pending = { type: into.dataset.type, id: into.dataset.id };
      error.textContent = '';
      openModal('moveToTeamModal');
    } else if (out) {
      event.stopPropagation();
      if (!confirm('Move this item out of the team? It goes back to the personal items of whoever created it.')) return;
      const data = await move(out.dataset.type, out.dataset.id, null);
      if (data.success) window.location.reload();
      else alert(data.error || 'Could not move the item.');
    }
  });

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const teamId = Number(document.getElementById('moveTeamSelect').value);
      const data = await move(pending.type, pending.id, teamId);
      if (data.success) window.location.href = `/dashboard?team=${teamId}`;
      else error.textContent = data.error || 'Could not move the item.';
    });
  }
})();
