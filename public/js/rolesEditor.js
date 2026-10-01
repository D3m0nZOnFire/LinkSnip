/**
 * Admin → Settings → Roles
 *
 * Edits every role in one place: a table with a column per role on wide screens, one role at a time on phones.
 * Edits stay in the page until "Save roles" (PUT /api/admin/roles). Deleting and resetting a role are saved at once.
 * Every request sends the roles.json version the page started from; if the file was edited by hand in between,
 * the server answers 409 and the page asks for a reload.
 */
(function () {
  const ROLE_KEY = /^[a-z0-9][a-z0-9-]{0,31}$/;
  const ANONYMOUS = 'anonymous';
  const data = JSON.parse(document.getElementById('rolesData').textContent);

  const state = {
    version: data.version,
    defaultRole: data.defaultRole,
    roles: data.roles.map(role => ({ ...role, isNew: false })),
    selected: (data.roles.find(r => r.name === data.defaultRole) || data.roles[0]).name,
    dirty: false
  };

  const container = document.getElementById('rolesEditor');
  const defaultSelect = document.getElementById('defaultRole');
  const statusEl = document.getElementById('rolesStatus');
  const errorsEl = document.getElementById('rolesErrors');
  const narrow = window.matchMedia('(max-width: 760px)');

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node && typeof value !== 'string') node[key] = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  const findRole = (name) => state.roles.find(r => r.name === name);
  const assignable = () => state.roles.filter(r => r.name !== ANONYMOUS);
  const accountsText = (role) => role.name === ANONYMOUS
    ? 'Visitors without an account'
    : `${role.users} account${role.users === 1 ? '' : 's'}${role.name === state.defaultRole ? ' · default' : ''}`;

  function markDirty() {
    state.dirty = true;
    statusEl.textContent = 'Unsaved changes.';
  }

  function showErrors(list, messages, { reload = false } = {}) {
    list.replaceChildren(...messages.map(message => el('li', {}, message)));
    if (reload) {
      list.append(el('li', {}, el('button', {
        type: 'button', class: 'btn btn-small btn-secondary', onclick: () => window.location.reload()
      }, 'Reload page')));
    }
  }

  async function send(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: state.version, ...body })
    });
    let result;
    try {
      result = await response.json();
    } catch (e) {
      result = { success: false, errors: [`Request failed (${response.status}).`] };
    }
    return { status: response.status, result };
  }

  // ─── Controls shared by both layouts ───────────────────────────────────────

  function labelInput(role) {
    return el('input', {
      type: 'text', class: 'form-input role-label', value: role.label, maxlength: '60',
      'aria-label': `Name of the ${role.name} role`,
      oninput: (e) => {
        role.label = e.target.value;
        markDirty();
        renderDefaultSelect();
        const option = container.querySelector(`.role-picker option[value="${CSS.escape(role.name)}"]`);
        if (option) option.textContent = role.label || role.name;
      }
    });
  }

  function permissionInput(role, perm, className) {
    return el('input', {
      type: 'checkbox', class: className, checked: role.permissions[perm.name] === true,
      'aria-label': `${perm.name} for ${role.label || role.name}`,
      onchange: (e) => { role.permissions[perm.name] = e.target.checked; markDirty(); }
    });
  }

  function limitInput(role, limit) {
    const value = role.limits[limit.name];
    const number = el('input', {
      type: 'number', class: 'form-input', min: '0', step: '1', inputmode: 'numeric',
      value: value === null ? '' : String(value), disabled: value === null,
      'aria-label': `${limit.name} for ${role.label || role.name}`,
      oninput: (e) => {
        const text = e.target.value.trim();
        // Sent as typed when it isn't a whole number, so the server names the problem
        role.limits[limit.name] = /^\d+$/.test(text) ? Number(text) : text;
        markDirty();
      }
    });
    const unlimited = el('input', {
      type: 'checkbox', checked: value === null,
      onchange: (e) => {
        if (e.target.checked) {
          role.limits[limit.name] = null;
          number.value = '';
          number.disabled = true;
        } else {
          role.limits[limit.name] = 0;
          number.value = '0';
          number.disabled = false;
          number.focus();
        }
        markDirty();
      }
    });
    return el('div', { class: 'limit-control' }, number, el('label', {}, unlimited, 'Unlimited'));
  }

  function actionButton(role) {
    if (role.builtIn) {
      return el('button', {
        type: 'button', class: 'btn btn-small btn-secondary', onclick: () => resetRole(role),
        title: 'Back to the built-in permissions, limits and name'
      }, 'Reset');
    }
    return el('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: () => deleteRole(role) }, 'Delete');
  }

  function roleMeta(role) {
    return el('span', { class: 'role-meta' },
      el('code', {}, role.name), ' · ', accountsText(role),
      role.isNew ? el('span', { class: 'new-badge' }, ' · new, not saved') : null);
  }

  // ─── Layouts ───────────────────────────────────────────────────────────────

  function tableView() {
    const head = el('tr', {}, el('th', {}, 'Role'),
      state.roles.map(role => el('th', {}, labelInput(role), roleMeta(role), el('div', { class: 'role-actions' }, actionButton(role)))));

    const section = (title) => el('tr', { class: 'section-row' }, el('th', { colspan: String(state.roles.length + 1) }, title));
    const nameCell = (item) => el('td', {}, el('code', {}, item.name), el('span', { class: 'desc' }, item.description));

    const rows = [
      section('Permissions'),
      ...data.permissions.map(perm => el('tr', {}, nameCell(perm),
        state.roles.map(role => el('td', {}, permissionInput(role, perm))))),
      section('Limits'),
      ...data.limits.map(limit => el('tr', {}, nameCell(limit),
        state.roles.map(role => el('td', {}, limitInput(role, limit)))))
    ];

    return el('div', { class: 'roles-table-wrap' },
      el('table', { class: 'role-editor' }, el('thead', {}, head), el('tbody', {}, rows)));
  }

  function cardView() {
    const role = findRole(state.selected) || state.roles[0];
    state.selected = role.name;

    const picker = el('label', { class: 'role-picker' }, 'Edit',
      el('select', {
        class: 'form-input',
        onchange: (e) => { state.selected = e.target.value; render(); }
      }, state.roles.map(r => el('option', { value: r.name, selected: r.name === role.name }, r.label || r.name))));

    const row = (item, control) => el('div', { class: 'role-row' },
      el('div', {}, el('code', {}, item.name), el('span', { class: 'desc' }, item.description)), control);

    const card = el('div', { class: 'role-card' },
      el('div', { class: 'role-card-head' }, labelInput(role), roleMeta(role), el('div', {}, actionButton(role))),
      el('h4', {}, 'Permissions'),
      data.permissions.map(perm => row(perm, permissionInput(role, perm, 'switch'))),
      el('h4', {}, 'Limits'),
      data.limits.map(limit => row(limit, limitInput(role, limit))));

    return el('div', {}, picker, card);
  }

  function renderDefaultSelect() {
    defaultSelect.replaceChildren(...assignable().map(role =>
      el('option', { value: role.name, selected: role.name === state.defaultRole }, role.label || role.name)));
  }

  function render() {
    renderDefaultSelect();
    container.replaceChildren(narrow.matches ? cardView() : tableView());
  }

  defaultSelect.addEventListener('change', (e) => {
    state.defaultRole = e.target.value;
    markDirty();
    render();
  });
  narrow.addEventListener('change', render);

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    const button = document.getElementById('saveRolesBtn');
    errorsEl.replaceChildren();
    statusEl.textContent = '';
    button.disabled = true;

    const roles = {};
    for (const role of state.roles) {
      roles[role.name] = { label: role.label, permissions: role.permissions, limits: role.limits };
    }

    try {
      const { status, result } = await send('PUT', '/api/admin/roles', { defaultRole: state.defaultRole, roles });
      if (result.success) {
        state.version = result.version;
        state.dirty = false;
        state.roles.forEach(role => { role.isNew = false; });
        const count = Object.keys(result.changed).length + result.created.length;
        render();
        statusEl.textContent = count ? `Saved ${count} change${count === 1 ? '' : 's'}.` : 'No changes.';
      } else {
        statusEl.textContent = state.dirty ? 'Unsaved changes.' : '';
        showErrors(errorsEl, result.errors || ['Could not save the roles.'], { reload: status === 409 });
      }
    } catch (e) {
      showErrors(errorsEl, ['Request failed. Please try again.']);
    } finally {
      button.disabled = false;
    }
  }

  document.getElementById('saveRolesBtn').addEventListener('click', save);

  // ─── Reset (built-in roles) ────────────────────────────────────────────────

  async function resetRole(role) {
    if (!confirm(`Reset "${role.label}" to its built-in name, permissions and limits? This is saved right away.`)) return;
    errorsEl.replaceChildren();
    try {
      const { status, result } = await send('POST', `/api/admin/roles/${encodeURIComponent(role.name)}/reset`);
      if (!result.success) {
        showErrors(errorsEl, result.errors || ['Could not reset the role.'], { reload: status === 409 });
        return;
      }
      state.version = result.version;
      Object.assign(role, { label: result.role.label, permissions: result.role.permissions, limits: result.role.limits });
      render();
      showToast(`${role.label} reset to its built-in values`);
    } catch (e) {
      showErrors(errorsEl, ['Request failed. Please try again.']);
    }
  }

  // ─── Delete (custom roles) ─────────────────────────────────────────────────

  let deleting = null;
  const deleteForm = document.getElementById('deleteRoleForm');
  const deleteErrors = document.getElementById('deleteRoleErrors');
  const moveToSelect = document.getElementById('deleteRoleMoveTo');

  function deleteRole(role) {
    if (role.isNew) {
      state.roles = state.roles.filter(r => r !== role);
      if (state.defaultRole === role.name) state.defaultRole = data.defaultRole;
      render();
      return;
    }
    if (state.defaultRole === role.name) {
      showErrors(errorsEl, [`"${role.label}" is the default role. Choose another default role and save first.`]);
      return;
    }
    deleting = role;
    deleteErrors.replaceChildren();
    document.getElementById('deleteRoleName').textContent = role.label;
    document.getElementById('deleteRoleCount').textContent = role.users
      ? `${role.users} account${role.users === 1 ? ' has' : 's have'} this role. Where should ${role.users === 1 ? 'it' : 'they'} go?`
      : 'No account has this role. If one gets it before you confirm:';
    // Only roles that exist on the server can receive accounts
    moveToSelect.replaceChildren(...assignable().filter(r => r !== role && !r.isNew).map(r =>
      el('option', { value: r.name }, r.label || r.name)));
    deleteForm.querySelector('input[value="move"]').checked = true;
    openModal('deleteRoleModal');
  }

  moveToSelect.addEventListener('focus', () => { deleteForm.querySelector('input[value="move"]').checked = true; });

  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = deleting;
    const toDefault = deleteForm.querySelector('input[name="deleteRoleTarget"]:checked').value === 'default';
    const moveTo = toDefault ? null : moveToSelect.value;
    const button = deleteForm.querySelector('button[type="submit"]');
    deleteErrors.replaceChildren();
    button.disabled = true;

    try {
      const { status, result } = await send('DELETE', `/api/admin/roles/${encodeURIComponent(role.name)}`, { moveTo });
      if (!result.success) {
        showErrors(deleteErrors, result.errors || ['Could not delete the role.'], { reload: status === 409 });
        return;
      }
      state.version = result.version;
      state.roles = state.roles.filter(r => r !== role);
      const target = findRole(moveTo || state.defaultRole);
      if (target) target.users += result.moved;
      closeModal('deleteRoleModal');
      render();
      showToast(`${role.label} deleted${result.moved ? `, ${result.moved} account${result.moved === 1 ? '' : 's'} moved` : ''}`);
    } catch (err) {
      showErrors(deleteErrors, ['Request failed. Please try again.']);
    } finally {
      button.disabled = false;
    }
  });

  // ─── Add ───────────────────────────────────────────────────────────────────

  const addForm = document.getElementById('addRoleForm');
  const addErrors = document.getElementById('addRoleErrors');
  const newLabel = document.getElementById('newRoleLabel');
  const newKey = document.getElementById('newRoleKey');
  let keyEdited = false;

  const toKey = (label) => label.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

  document.getElementById('addRoleBtn').addEventListener('click', () => {
    addForm.reset();
    keyEdited = false;
    addErrors.replaceChildren();
    const base = findRole('user');
    document.getElementById('newRoleBase').textContent = base ? `"${base.label}"` : 'the user role';
    openModal('addRoleModal');
    newLabel.focus();
  });

  newLabel.addEventListener('input', () => { if (!keyEdited) newKey.value = toKey(newLabel.value); });
  newKey.addEventListener('input', () => { keyEdited = true; });

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = newLabel.value.trim();
    const key = newKey.value.trim();
    const problems = [];
    if (!label) problems.push('Give the role a name.');
    if (!ROLE_KEY.test(key)) problems.push('The key must be 1 to 32 lowercase letters, digits or dashes, not starting with a dash.');
    else if (findRole(key)) problems.push(`There is already a role with the key "${key}".`);
    if (problems.length) {
      showErrors(addErrors, problems);
      return;
    }

    const base = findRole('user') || state.roles[0];
    state.roles.push({
      name: key, label, builtIn: false, users: 0, isNew: true,
      permissions: { ...base.permissions }, limits: { ...base.limits }
    });
    state.selected = key;
    closeModal('addRoleModal');
    markDirty();
    render();
    statusEl.textContent = `"${label}" added. Save the roles to create it.`;
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });

  render();
})();
