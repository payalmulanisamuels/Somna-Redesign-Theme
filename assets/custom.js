// document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
//   block
//     .querySelector(".subscription_group:last-child input[type='radio']")
//     ?.click();
// });

import { CartLinesUpdateEvent } from '@shopify/events';

document.addEventListener('submit', function(e) {
  const form = e.target.closest('[data-ajax-form]');
  if (!form) return;

  e.preventDefault();
  const btn = form.querySelector('.hz-upsell-add-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Adding...';

  const formData = new FormData(form);
  const variantId = formData.get('id');
  const quantity = Number(formData.get('quantity') || 1);

  fetch('/cart/add.js', {
    method: 'POST',
    body: formData,
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
  .then(response => response.json())
  .then(data => {
    btn.textContent = 'Added!';

    // Provide a valid backing promise for listeners awaiting event.promise
    const cartPromise = fetch('/cart.js', { headers: { Accept: 'application/json' } }).then(r => r.json());

    document.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: [{ merchandiseId: variantId, quantity }],
        promise: cartPromise
      })
    );

    document.querySelectorAll('cart-items-component').forEach(component => {
      component.fetchCartData?.();
    });

    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText;
    }, 1500);
  })
  .catch(error => {
    console.error('AJAX add-to-cart error:', error);
    btn.disabled = false;
    btn.textContent = originalText;
  });
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