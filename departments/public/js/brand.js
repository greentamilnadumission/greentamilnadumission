// Shows the GTM logo (img/gtm-logo.png) where the page has one, and keeps the leaf mark
// as a fallback until the logo file is in place.
(function () {
  'use strict';
  function init() {
    document.querySelectorAll('img.brand-logo').forEach(img => {
      const mark = img.parentElement && img.parentElement.querySelector('.brand-mark');
      const show = () => { img.hidden = false; if (mark) mark.style.display = 'none'; };
      if (img.complete && img.naturalWidth > 0) show();
      else img.addEventListener('load', show, { once: true });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
