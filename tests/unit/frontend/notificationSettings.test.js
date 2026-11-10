/**
 * @jest-environment jsdom
 */

// Settings → Notifications (public/js/notificationSettings.js): the checkboxes become { event: { inApp, mail } };
// disabled mail checkboxes (no mail possible) are left out so the stored choice stays.

document.body.innerHTML = `
  <form id="notificationsForm">
    <input type="checkbox" data-notification-event="blocked" data-channel="inApp" checked>
    <input type="checkbox" data-notification-event="blocked" data-channel="mail">
    <input type="checkbox" data-notification-event="unblocked" data-channel="inApp">
    <input type="checkbox" data-notification-event="unblocked" data-channel="mail" checked disabled>
    <input type="checkbox" data-notification-event="odd" data-channel="sms" checked>
  </form>`;
const { collectPreferences } = require('../../../public/js/notificationSettings');

it('reads one entry per event with each enabled channel', () => {
  expect(collectPreferences(document.getElementById('notificationsForm'))).toEqual({
    blocked: { inApp: true, mail: false },
    unblocked: { inApp: false }
  });
});
