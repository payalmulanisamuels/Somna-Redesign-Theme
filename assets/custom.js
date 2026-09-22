document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
  block
    .querySelector(".subscription_group:last-child input[type='radio']")
    ?.click();
});


document.addEventListener('submit', function(e) {
    const form = e.target.closest('[data-ajax-form]');
    if (!form) return;

    e.preventDefault();
    const btn = form.querySelector('.hz-upsell-add-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding...';

    const formData = new FormData(form);
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
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      }, 1500);
        // Trigger Horizon / Shopify Section Rendering API / Cart Drawer Refresh
      if (window.cart && typeof window.cart.refresh === 'function') {
        window.cart.refresh();
      } else {
        // Dispatch standard Shopify cart update event or re-render drawer section
        document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', {
          bubbles: true,
          detail: { cart: data }
        }));
        // Fallback reload/open drawer dispatch if custom theme hook differs
        const drawer = document.querySelector('theme-drawer');
        if (drawer && typeof drawer.open === 'function') {
          drawer.open();
        } else {
          window.location.reload();
        }
      }
     
    })
    .catch(error => {
      console.error('AJAX add-to-cart error:', error);
      btn.disabled = false;
      btn.textContent = originalText;
    });
  });