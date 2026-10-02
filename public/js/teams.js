/**
 * Teams list (views/teams.ejs): creating a team (POST /api/teams), then opening it.
 */
(function () {
  'use strict';

  const form = document.getElementById('createTeamForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const error = document.getElementById('createTeamError');
    error.textContent = '';
    button.disabled = true;
    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: document.getElementById('teamName').value })
      });
      const data = await response.json();
      if (data.success) window.location.href = `/teams/${data.team.id}`;
      else error.textContent = data.error || 'Could not create the team.';
    } catch (e) {
      error.textContent = 'Request failed. Please try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
