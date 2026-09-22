document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
  block
    .querySelector(".subscription_group:last-child input[type='radio']")
    ?.click();
});

  document.addEventListener('submit', async function(e) {
    const form = e.target.closest('[data-upsell-form]');
    if (!form) return;

    e.preventDefault();
    const btn = form.querySelector('.hz-upsell-add-btn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Adding...';

    const formData = new FormData(form);
    const payload = {
      items: [{
        id: Number(formData.get('id')),
        quantity: Number(formData.get('quantity')) || 1
      }],
      sections: Array.from(document.querySelectorAll('cart-items-component'))
        .map(el => el.dataset.sectionId)
        .filter(Boolean)
        .join(',')
    };

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      
      btn.textContent = 'Added!';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
      }, 1500);

      // Refresh Horizon cart drawer / sections via Section Rendering API response or CustomEvent
      const cartDrawerComponent = document.querySelector('cart-drawer-component');
      if (cartDrawerComponent) {
        // Dispatch standard Horizon update/refresh signal or re-fetch cart drawer html
        fetch('/cart?section_id=cart-drawer-section')
          .then(res => res.text())
          .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newDrawerInner = doc.querySelector('.cart-drawer__inner');
            const currentDrawerInner = document.querySelector('.cart-drawer__inner');
            if (newDrawerInner && currentDrawerInner) {
              currentDrawerInner.replaceWith(newDrawerInner);
            }
          });
      }

      // Open drawer if closed
      const dialog = document.querySelector('#cart-drawer dialog');
      if (dialog && !dialog.open) {
        dialog.showModal();
      }

    } catch (err) {
      console.error('Upsell add error:', err);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });