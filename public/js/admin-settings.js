/**
 * Admin → Settings (views/admin-settings.ejs): reads the settings form and saves it with PUT /api/admin/settings.
 * The Roles tab is public/js/rolesEditor.js.
 */
function readForm() {
  const values = {};
  document.querySelectorAll('#settingsForm [data-key]').forEach(input => {
    const key = input.dataset.key;
    if (input.dataset.type === 'boolean') {
      values[key] = input.checked;
    } else if (input.value.trim() === '' && input.dataset.nullable === 'true') {
      values[key] = null;
    } else {
      values[key] = Number(input.value);
    }
  });
  return values;
}

async function saveSettings(event) {
  event.preventDefault();
  const button = document.getElementById('saveSettingsBtn');
  const status = document.getElementById('settingsStatus');
  const errors = document.getElementById('settingsErrors');
  status.textContent = '';
  errors.innerHTML = '';
  button.disabled = true;

  try {
    const response = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(readForm())
    });
    const data = await response.json();

    if (data.success) {
      const count = Object.keys(data.changed).length;
      status.textContent = count ? `Saved ${count} change${count === 1 ? '' : 's'}.` : 'No changes.';
    } else {
      (data.errors || ['Could not save settings.']).forEach(message => {
        const li = document.createElement('li');
        li.textContent = message;
        errors.appendChild(li);
      });
    }
  } catch (e) {
    const li = document.createElement('li');
    li.textContent = 'Request failed. Please try again.';
    errors.appendChild(li);
  } finally {
    button.disabled = false;
  }
}

document.getElementById('settingsForm')?.addEventListener('submit', saveSettings);
