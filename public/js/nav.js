/**
 * Menu button for the header nav on small screens (the CSS shows the button and hides the nav below 1024px).
 * Closes on Escape and on a click outside the menu.
 */
(function () {
  const button = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!button || !nav) return;

  const isOpen = () => nav.classList.contains('open');

  function setOpen(open) {
    nav.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  button.addEventListener('click', () => setOpen(!isOpen()));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) {
      setOpen(false);
      button.focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !nav.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
})();
