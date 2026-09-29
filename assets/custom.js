// document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
//   block
//     .querySelector(".subscription_group:last-child input[type='radio']")
//     ?.click();
// });

import { CartLinesUpdateEvent } from '@shopify/events';

// Cart drawer upsell "Add" buttons (snippets/cart-upsell-card.liquid)
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-ajax-form]');
  if (!form) return;

  e.preventDefault();
  const btn = form.querySelector('.hz-upsell-add-btn');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;

  const formData = new FormData(form);
  const variantId = String(formData.get('id'));
  const quantity = Number(formData.get('quantity') || 1);

  // Re-render the cart drawer / cart page in the same request
  const sectionIds = [...document.querySelectorAll('cart-items-component')]
    .map((el) => el.dataset.sectionId)
    .filter(Boolean);
  if (sectionIds.length) formData.append('sections', sectionIds.join(','));

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

    const cart = await fetch(`${Theme.routes.cart_url}.js`, { headers: { Accept: 'application/json' } }).then((r) =>
      r.json()
    );

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