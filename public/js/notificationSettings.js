/**
 * Settings → Notifications (views/settings.ejs #notificationsForm): one checkbox per event and channel
 * ([data-notification-event] + [data-channel] inApp | mail), saved with PUT /api/user/notification-preferences.
 * Disabled checkboxes (no mail possible) are left out, so their stored choice stays.
 */
(function () {
  'use strict';

  /** { event: { inApp?, mail? } } from the form's checkboxes. */
  function collectPreferences(form) {
    const preferences = {};
    form.querySelectorAll('input[data-notification-event]').forEach(input => {
      if (input.disabled) return;
      const { notificationEvent: event, channel } = input.dataset;
      if (channel !== 'inApp' && channel !== 'mail') return;
      preferences[event] = { ...(preferences[event] || {}), [channel]: input.checked };
    });
    return preferences;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { collectPreferences };

  const form = typeof document !== 'undefined' && document.getElementById('notificationsForm');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('saveNotificationsBtn');
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/user/notification-preferences', {
        method: 'PUT', body: JSON.stringify({ preferences: collectPreferences(form) })
      });
      showToast('Notification settings saved');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });
})();
