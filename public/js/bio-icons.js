/**
 * Bio page (views/bio-page.ejs): Dashboard Icons in the theme's variant (-light on dark, -dark on light); an icon
 * without one falls back to the plain file, once. Follows the theme toggle.
 */
(function () {
  'use strict';

  const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg';

  // Error events don't bubble: listen in the capture phase
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.icon || img.dataset.fallback) return;
    img.dataset.fallback = '1';
    img.src = `${CDN}/${img.dataset.icon}.svg`;
  }, true);

  function update() {
    const suffix = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? '-light' : '-dark';
    document.querySelectorAll('img[data-icon]').forEach(img => {
      delete img.dataset.fallback;
      img.src = `${CDN}/${img.dataset.icon}${suffix}.svg`;
    });
  }

  update();
  new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
