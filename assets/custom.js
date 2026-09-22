document.querySelectorAll(".shopify_subscriptions_app_block").forEach(block => {
  block
    .querySelector(".subscription_group:last-child input[type='radio']")
    ?.click();
});