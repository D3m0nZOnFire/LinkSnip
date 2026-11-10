/**
 * Notifications page (views/notifications.ejs): "Mark all as read" for the ones on other pages.
 * Opening the page already marks the ones it shows as read (server side).
 */
(function () {
  'use strict';

  const button = document.getElementById('markAllReadBtn');
  if (!button) return;

  button.addEventListener('click', async () => {
    setButtonLoading(button, true);
    try {
      await apiRequest('/api/notifications/read-all', { method: 'POST' });
      location.reload();
    } catch (error) {
      showToast(error.message, 'error');
      setButtonLoading(button, false);
    }
  });
})();
