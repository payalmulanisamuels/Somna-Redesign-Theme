// document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
//   block
//     .querySelector(".subscription_group:last-child input[type='radio']")
//     ?.click();
// });

import { CartLinesUpdateEvent } from '@shopify/events';

// Cart drawer upsell "Add" buttons (snippets/cart-upsell-card.liquid)
// One request does everything: /cart/add.js also renders the cart drawer and the updated cart JSON
// (sections/somna-cart-json.liquid), so there's no follow-up /cart.js round trip before the drawer updates.
const CART_JSON_SECTION = 'somna-cart-json';
let upsellAddInFlight = false;

/** Updated cart from the add response's sections, or null if it's missing/unreadable. */
const cartFromSections = (sections) => {
  const html = sections?.[CART_JSON_SECTION];
  if (!html) return null;
  try {
    const json = new DOMParser().parseFromString(html, 'text/html').querySelector('script')?.textContent;
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-ajax-form]');
  if (!form) return;

  e.preventDefault();
  const btn = form.querySelector('.hz-upsell-add-btn');
  // One upsell add at a time: overlapping adds would morph the drawer with an out-of-date render
  if (upsellAddInFlight || btn?.disabled) return;
  upsellAddInFlight = true;
  if (btn) btn.disabled = true;

  const formData = new FormData(form);
  const variantId = String(formData.get('id'));
  const quantity = Number(formData.get('quantity') || 1);

  // Re-render the cart drawer / cart page, plus the cart JSON, in the same request
  const sectionIds = [...document.querySelectorAll('cart-items-component')]
    .map((el) => el.dataset.sectionId)
    .filter(Boolean);
  formData.append('sections', [...sectionIds, CART_JSON_SECTION].join(','));

  const deferred = CartLinesUpdateEvent.createPromise();
  form.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'product',
      lines: [{ merchandiseId: variantId, quantity }],
      promise: deferred.promise,
    })
  );

  try {
    const data = await fetch(Theme.routes.cart_add_url, {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    }).then((response) => response.json());

    // Fallback (e.g. on an add error, which returns no sections): fetch the cart as before
    const cart =
      cartFromSections(data.sections) ??
      (await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } }).then((r) => r.json()));

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: {
        didError: Boolean(data.status),
        items: cart.items,
        itemCount: quantity,
        sections: data.sections,
        source: 'cart-upsell',
      },
    });

    if (data.status) console.error('Upsell add-to-cart error:', data.description || data.message);
  } catch (error) {
    console.error('Upsell add-to-cart error:', error);
    deferred.reject(error);
  } finally {
    upsellAddInFlight = false;
    if (btn && btn.isConnected) btn.disabled = false;
  }
});


if(document.querySelector(".hz-banner-btn")){
  document.querySelectorAll(".hz-banner-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
        e.preventDefault()
      document
        .querySelector("product-form-component .add-to-cart-button")
        ?.click();
    });
  });
}

/* ==========================================================================
   Somna motion: calm reveal on scroll (styles in assets/somna-motion.css)
   - Marks only content that starts BELOW the screen, so the hero / LCP and
     anything visible on load are never hidden.
   - Skips the first section, header, footer, dialogs (cart drawer, popups),
     product forms, sliders and anything that already uses transform.
   - Each element animates once, then its classes are removed again.
   - Off for prefers-reduced-motion; re-runs in the theme editor.
   ========================================================================== */
(() => {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Cards and grid items (staggered when they enter together)
  const GROUP_ITEMS = [
    'product-card',
    '.collection-card',
    '.bundle-card',
    '.step-card',
    '.somna-offer',
    '.somna-sleep-bundle__card',
    'accordion-custom',
    '.layout-panel-flex--row > .group-block',
  ];
  // Single pieces of content
  const SINGLE_ITEMS = [
    '.text-block',
    '.image-block',
    '.custom-header',
    '.hz-slider-viewport',
    '.hz-bundle-container',
    '.comp-container',
    '.steps-subheading-bottom',
  ];
  const SELECTOR = [...GROUP_ITEMS, ...SINGLE_ITEMS].join(',');
  const SKIP = [
    'header',
    'footer',
    'dialog',
    '[role="dialog"]',
    'theme-drawer',
    'slideshow-component',
    'layered-slideshow-component',
    'marquee-component',
    'media-gallery',
    'product-form-component',
    'variant-picker',
    'sticky-add-to-cart',
    '.hz-slider-track',
    '.details-content',
    '.shopify-app-block',
    '[data-no-motion]',
  ].join(',');
  const DONE_AFTER = 1800; // ms safety net if transitionend never fires

  const finish = (el) => {
    el.classList.remove('sm-reveal', 'sm-reveal--image', 'sm-in');
    el.style.removeProperty('--sm-i');
  };

  const show = (el, index) => {
    if (!el.classList.contains('sm-reveal') || el.classList.contains('sm-in')) return;
    if (index) el.style.setProperty('--sm-i', String(index));
    el.classList.add('sm-in');
    const onEnd = (event) => {
      if (event.target !== el || event.propertyName !== 'opacity') return;
      el.removeEventListener('transitionend', onEnd);
      finish(el);
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(() => finish(el), DONE_AFTER + index * 70);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const perParent = new Map();
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const parent = entry.target.parentElement;
        const index = perParent.get(parent) || 0;
        perParent.set(parent, index + 1);
        show(entry.target, Math.min(index, 5));
      }
    },
    { rootMargin: '0px', threshold: 0 }
  );

  const canAnimate = (el) => {
    const style = getComputedStyle(el);
    if (
      style.transform !== 'none' ||
      style.translate !== 'none' ||
      style.scale !== 'none' ||
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      parseFloat(style.opacity) !== 1
    ) {
      return false;
    }
    // A moving element becomes the reference box for absolutely positioned children; skip those so nothing jumps
    if (style.position === 'static') {
      for (const child of el.querySelectorAll('*')) {
        const position = getComputedStyle(child).position;
        if (position === 'absolute' || position === 'fixed') return false;
      }
    }
    return true;
  };

  const init = (scope) => {
    const main = document.getElementById('MainContent');
    if (!main || !scope) return;
    const firstSection = main.querySelector(':scope > .shopify-section');
    const viewportHeight = window.innerHeight;
    const root = main.contains(scope) || scope === main ? scope : main;

    for (const el of root.querySelectorAll(SELECTOR)) {
      const section = el.closest('.shopify-section');
      if (!section || section === firstSection || !main.contains(section)) continue;
      if (section.querySelector('product-form-component')) continue; // main product / featured product
      if (el.closest(SKIP)) continue;
      if (el.parentElement?.closest('.sm-reveal')) continue; // parent already animates
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.top < viewportHeight) continue; // visible on load or above: leave as is
      if (!canAnimate(el)) continue;
      el.classList.add('sm-reveal');
      if (el.matches('.image-block')) el.classList.add('sm-reveal--image');
      observer.observe(el);
    }
  };

  const revealAll = (scope) => {
    scope?.querySelectorAll('.sm-reveal:not(.sm-in)').forEach((el) => {
      observer.unobserve(el);
      show(el, 0);
    });
  };

  init(document.getElementById('MainContent'));

  // Theme editor: set up re-rendered sections, show selected ones straight away
  document.addEventListener('shopify:section:load', (event) => init(event.target));
  document.addEventListener('shopify:section:select', (event) => revealAll(event.target));
  document.addEventListener('shopify:block:select', (event) => revealAll(event.target.closest('.shopify-section')));
})();


/* ==========================================================================
   Somna motion: extra reveal on scroll (added; nothing above is changed)
   Same fade-up as the reveal above (styles: .sm-reveal in assets/somna-motion.css),
   for content the reveal above leaves out, on every page:
   - the banner text ("It's simple. Breathe through your nose.")
   - FAQ / accordion rows (the check above skips them because of their +/- icons)
   - the "Shop the essentials" heading and cards
   - any heading, text, image, card or column it skipped for the same icon reason
   Only content that starts below the screen is hidden, so the hero / LCP and
   anything visible on load are never affected. Each element animates once and
   its classes are removed again. Off for prefers-reduced-motion.
   Light on PageSpeed: one IntersectionObserver, set up after the page has loaded
   (in idle time), no scroll listeners, and only opacity / translate change.
   ========================================================================== */
(() => {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ITEMS = [
    '.layered-slideshow__content .group-block-content > :not(.somna-float)',
    'accordion-custom',
    '.somna-ess__title',
    '.somna-ess__card',
    '.custom-header',
    '.text-block',
    '.image-block',
    'product-card',
    '.collection-card',
    '.bundle-card',
    '.somna-sleep-bundle__card',
    '.layout-panel-flex--row > .group-block',
  ].join(',');
  const SKIP = [
    'header',
    'footer',
    'dialog',
    '[role="dialog"]',
    'theme-drawer',
    'slideshow-component',
    'marquee-component',
    'media-gallery',
    'product-form-component',
    'variant-picker',
    'sticky-add-to-cart',
    '.hz-slider-track',
    '.details-content',
    '.shopify-app-block',
    '[data-no-motion]',
  ].join(',');

  const finish = (el) => {
    el.classList.remove('sm-reveal', 'sm-in');
    el.style.removeProperty('--sm-i');
  };

  const show = (el, index) => {
    if (!el.classList.contains('sm-reveal') || el.classList.contains('sm-in')) return;
    if (index) el.style.setProperty('--sm-i', String(index));
    el.classList.add('sm-in');
    const onEnd = (event) => {
      if (event.target !== el || event.propertyName !== 'opacity') return;
      el.removeEventListener('transitionend', onEnd);
      finish(el);
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(() => finish(el), 2000 + index * 150);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const perParent = new Map();
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const parent = entry.target.parentElement;
        const index = perParent.get(parent) || 0;
        perParent.set(parent, index + 1);
        show(entry.target, Math.min(index, 5));
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0 }
  );

  // Safe to move: not already moving, not fixed/sticky, and no positioned child that is
  // placed against something outside it (that child would shift while it moves)
  const canAnimate = (el) => {
    const style = getComputedStyle(el);
    if (
      style.transform !== 'none' ||
      style.translate !== 'none' ||
      style.scale !== 'none' ||
      style.animationName !== 'none' ||
      style.position === 'fixed' ||
      style.position === 'sticky' ||
      parseFloat(style.opacity) !== 1
    ) {
      return false;
    }
    if (style.position === 'static') {
      for (const child of el.querySelectorAll('*')) {
        const position = getComputedStyle(child).position;
        if (position === 'fixed') return false;
        if (position === 'absolute' && !el.contains(child.offsetParent)) return false;
      }
    }
    return true;
  };

  const init = (scope) => {
    const main = document.getElementById('MainContent');
    if (!main || !scope) return;
    const firstSection = main.querySelector(':scope > .shopify-section');
    const viewportHeight = window.innerHeight;
    const root = main.contains(scope) || scope === main ? scope : main;

    for (const el of root.querySelectorAll(ITEMS)) {
      if (el.classList.contains('sm-reveal') || el.closest('.sm-reveal')) continue; // already handled
      const section = el.closest('.shopify-section');
      if (!section || section === firstSection || !main.contains(section)) continue;
      if (section.querySelector('product-form-component')) continue;
      if (el.closest(SKIP)) continue;
      if (el.parentElement?.closest('.sm-reveal')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.top < viewportHeight) continue; // visible on load or above
      if (!canAnimate(el)) continue;
      el.classList.add('sm-reveal');
      observer.observe(el);
    }
  };

  const start = () => init(document.getElementById('MainContent'));
  const later = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 200));
  if (document.readyState === 'complete') later(start);
  else window.addEventListener('load', () => later(start), { once: true });

  // Theme editor: re-rendered sections get set up again; selected ones show straight away
  document.addEventListener('shopify:section:load', (event) => init(event.target));
  document.addEventListener('shopify:section:select', (event) =>
    event.target.querySelectorAll('.sm-reveal:not(.sm-in)').forEach((el) => {
      observer.unobserve(el);
      show(el, 0);
    })
  );
})();
