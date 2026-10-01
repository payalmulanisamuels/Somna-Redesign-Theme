import { Component } from '@theme/component';
import { ThemeEvents, QuantitySelectorUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { onAnimationEnd } from '@theme/utilities';
import { StandardEvents, ProductSelectEvent, CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * @typedef {Object} ProductVariant
 * @property {string|number} [id] - Variant ID
 * @property {string} [title] - Variant title
 * @property {string} [name] - Variant name
 * @property {boolean} [available] - Whether variant is available
 * @property {Object} [featured_media] - Featured media object
 * @property {Object} [featured_media.preview_image] - Preview image data
 * @property {string} [featured_media.preview_image.src] - Image source URL
 * @property {string} [featured_media.alt] - Alt text for the image
 */

/**
 * @typedef {HTMLElement & {
 *   source: Element,
 *   destination: Element,
 *   useSourceSize: string | boolean
 * }} FlyToCart
 */

/**
 * @typedef {Object} StickyAddToCartRefs
 * @property {HTMLElement} stickyBar - The floating bar container
 * @property {HTMLButtonElement} addToCartButton - Sticky bar's button
 * @property {HTMLElement} quantityDisplay - Quantity display container
 * @property {HTMLElement} quantityNumber - Quantity number element
 * @property {HTMLImageElement} productImage - Product image element
 */

/**
 * Fired (bubbling) by the Buy Box subscription widget whenever the purchase option
 * or selling plan changes. See snippets/somna-subscription-widget.liquid.
 */
const PURCHASE_OPTION_EVENT = 'somna:purchase-option-change';

/**
 * @typedef {Object} PurchaseState
 * @property {'subscribe' | 'onetime'} mode - Purchase option selected in the Buy Box
 * @property {string} sellingPlanId - Selected native selling plan id ('' for one-time)
 */

/**
 * @typedef {Object} StickyPlanData
 * @property {string} price - Formatted subscription price
 * @property {string} perNight - Formatted subscription price per night
 * @property {string} label - Delivery wording, e.g. "Delivery every 60 days"
 */

/**
 * A custom element that manages a sticky add-to-cart bar.
 * Shows when the main buy buttons scroll out of view.
 *
 * Somna: when the bar renders the size dropdown (snippets/somna-sticky-options.liquid),
 * it mirrors the Buy Box purchase option (subscribe / one-time) and selling plan.
 * The Buy Box stays the source of truth: the state is read from the product form's
 * native `selling_plan` field — the value that is actually submitted to the cart.
 *
 * @extends {Component<StickyAddToCartRefs>}
 */
class StickyAddToCartComponent extends Component {
  requiredRefs = ['stickyBar', 'addToCartButton', 'quantityDisplay', 'quantityNumber'];

  /** @type {IntersectionObserver | null} */
  #buyButtonsIntersectionObserver = null;

  /** @type {IntersectionObserver | null} */
  #mainBottomObserver = null;

  /** @type {number | undefined} */
  #resetTimeout;

  /** @type {boolean} */
  #isStuck = false;

  /** @type {number | null} */
  #animationTimeout = null;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {HTMLButtonElement | null} */
  #targetAddToCartButton = null;

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {boolean} */
  #hiddenByBottom = false;

  /** @type {PurchaseState} */
  #purchaseState = { mode: 'onetime', sellingPlanId: '' };

  connectedCallback() {
    super.connectedCallback();

    // Fresh controller per connection: a re-rendered/re-attached element must not reuse an
    // already-aborted signal, and every listener below is removed together on disconnect.
    this.#abortController = new AbortController();

    this.#setupIntersectionObserver();

    const { signal } = this.#abortController;
    const target = this.closest('.shopify-section');
    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(StandardEvents.cartError, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate, { signal });

    // Somna: mirror the Buy Box purchase option. Listeners sit on the section / this element /
    // document (never on morphed children), so re-rendering the bar never duplicates them.
    target?.addEventListener(PURCHASE_OPTION_EVENT, this.#syncPurchaseState, { signal });
    target?.addEventListener('change', this.#handleBuyBoxChange, { signal });
    this.addEventListener('click', this.#handleStickyClick, { signal });
    document.addEventListener('click', this.#handleOutsideClick, { signal });
    document.addEventListener('keydown', this.#handleKeydown, { signal });
    this.#syncPurchaseState();

    this.#getInitialQuantity();

    // IntersectionObserver callbacks gate visibility on #isChatActive(), but
    // if the shopper scrolls before the Inbox bundle has upgraded
    // <shopify-chat>, the bar shows and nothing re-runs that check. Hide it
    // once the element is defined so the bar doesn't overlap the chat UI.
    customElements.whenDefined('shopify-chat').then(() => {
      if (signal.aborted) return;
      if (this.#isStuck && this.#isChatActive()) this.#hideStickyBar();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#mainBottomObserver?.disconnect();
    this.#abortController.abort();
    if (this.#animationTimeout) {
      clearTimeout(this.#animationTimeout);
    }
  }

  /**
   * Sets up the IntersectionObserver to watch the buy buttons visibility
   */
  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    const buyButtonsBlock = productForm.closest('.buy-buttons-block');
    if (!buyButtonsBlock) return;

    // In themes migrated from 2.0, the footer element doesn't exist
    const footer = document.querySelector('footer') ?? document.querySelector('[class*="footer-group"]');
    if (!footer) return;

    // Observer for buy buttons visibility
    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      // Only show sticky bar if buy buttons have been scrolled past (above viewport)
      if (!entry.isIntersecting && !this.#isStuck) {
        // Check if the element is above the viewport (scrolled past) or below (not yet reached)
        const rect = entry.target.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top < 0) {
          if (this.#isChatActive()) return;
          this.#showStickyBar();
        }
        // If rect.top >= 0, element is below viewport - don't show sticky bar yet
      } else if (entry.isIntersecting && this.#isStuck) {
        this.#hiddenByBottom = false;
        this.#hideStickyBar();
      }
    });

    // Observer for footer visibility - hides sticky bar at page bottom
    this.#mainBottomObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;

        if (entry.isIntersecting && this.#isStuck) {
          this.#hiddenByBottom = true;
          this.#hideStickyBar();
        } else if (!entry.isIntersecting && this.#hiddenByBottom) {
          // Footer out of view - check if we should show sticky bar again
          const rect = buyButtonsBlock.getBoundingClientRect();
          // Only show if buy buttons are above the viewport (scrolled past)
          if (rect.bottom < 0 || rect.top < 0) {
            this.#hiddenByBottom = false;
            if (!this.#isChatActive()) {
              this.#showStickyBar();
            }
          }
        }
      },
      {
        rootMargin: '200px 0px 0px 0px',
      }
    );

    this.#buyButtonsIntersectionObserver.observe(buyButtonsBlock);
    this.#mainBottomObserver.observe(footer);
    this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
  }

  // Public action handlers
  /**
   * Handles the add to cart button click in the sticky bar
   */
  handleAddToCartClick = async () => {
    if (!this.#targetAddToCartButton) return;
    this.#targetAddToCartButton.dataset.puppet = 'true';
    this.#targetAddToCartButton.click();
    const cartIcon = document.querySelector('.header-actions__cart-icon');

    if (this.refs.addToCartButton.dataset.added !== 'true') {
      this.refs.addToCartButton.dataset.added = 'true';
    }

    if (!cartIcon || !this.refs.addToCartButton || !this.refs.productImage) return;
    if (this.#resetTimeout) clearTimeout(this.#resetTimeout);

    const flyToCartElement = /** @type {FlyToCart} */ (document.createElement('fly-to-cart'));
    const sourceStyles = getComputedStyle(this.refs.productImage);

    flyToCartElement.classList.add('fly-to-cart--sticky');
    flyToCartElement.style.setProperty('background-image', `url(${this.refs.productImage.src})`);
    flyToCartElement.useSourceSize = 'true';
    flyToCartElement.source = this.refs.productImage;
    flyToCartElement.destination = cartIcon;

    document.body.appendChild(flyToCartElement);

    await onAnimationEnd([this.refs.addToCartButton, flyToCartElement]);
    this.#resetTimeout = setTimeout(() => {
      this.refs.addToCartButton.removeAttribute('data-added');
    }, 800);
  };

  /**
   * Handles product select events (variant selected and updated)
   * @param {ProductSelectEvent} event - The product select event
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    // Update variant ID from the event detail (variant:selected part)
    const { optionValueId } = event.detail ?? {};
    if (optionValueId) {
      this.dataset.currentVariantId = optionValueId;
    }

    // Wait for the promise to resolve with variant update data
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, productId, resource: variant } = detail;

        if (productId && productId !== this.dataset.productId) return;

        // Get the new sticky add to cart HTML from the server response
        const newStickyAddToCart = /** @type {HTMLElement | null} */ (html.querySelector('sticky-add-to-cart'));
        if (!newStickyAddToCart) return;

        const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
        if (!newStickyBar) return;

        // Store current visibility state before morphing
        const currentStuck = this.refs.stickyBar.getAttribute('data-stuck') || 'false';
        const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

        // Morph the entire sticky bar content
        morph(this.refs.stickyBar, newStickyBar, { childrenOnly: true });

        // Restore visibility state after morphing
        this.refs.stickyBar.setAttribute('data-stuck', currentStuck);
        this.dataset.variantAvailable = variantAvailable;

        // Update the dataset attributes with new variant info
        if (variant && variant.id) {
          this.dataset.currentVariantId = variant.id;
        }

        // Re-cache the target add to cart button after morphing
        const productForm = this.#getProductForm();
        if (productForm) {
          this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
        }

        if (variant == null) {
          this.#handleVariantUnavailable();
        }
        // Restore the current quantity display if needed
        this.#updateButtonText();
        // Re-apply the Buy Box purchase option to the freshly morphed markup
        this.#syncPurchaseState();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[sticky-add-to-cart] Event promise rejected:', error);
      });
  };

  /**
   * Updates the variant title based on selected options when the variant is unavailable
   */
  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = '';
    const variantTitleElement = this.querySelector('.sticky-add-to-cart__variant');
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    const selectedOptions = Array.from(variantPicker.querySelectorAll('input:checked'))
      .map((option) => /** @type {HTMLInputElement} */ (option).value)
      .filter((value) => value !== '')
      .join(' / ');
    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;
  };

  /**
   * Handles cart add complete (success or error) - resets puppet flag
   * @param {CartLinesUpdateEvent | CartErrorEvent} event - The cart event
   */
  #handleCartAddComplete = (event) => {
    // Reset the puppet flag only after the cart operation's promise settles,
    // not when the event is first dispatched (before the HTTP request completes).
    const resetPuppet = () => {
      if (this.#targetAddToCartButton) {
        this.#targetAddToCartButton.dataset.puppet = 'false';
      }
    };

    // CartLinesUpdateEvent has a promise; CartErrorEvent does not (error already happened).
    if ('promise' in event && event.promise instanceof Promise) {
      event.promise.finally(resetPuppet);
    } else {
      resetPuppet();
    }
  };

  /**
   * Handles quantity selector update events
   * @param {QuantitySelectorUpdateEvent} event - The quantity update event
   */
  #handleQuantityUpdate = (event) => {
    // Only respond to product page quantity selector updates, not cart drawer
    if (event.detail.cartLine) return;

    this.#currentQuantity = event.detail.quantity;
    this.#updateButtonText();
  };

  // Somna: Buy Box purchase option mirroring + size dropdown

  /**
   * Native selling plan fields change (radios / selects named `selling_plan`, the Buy Box
   * purchase option radios, or the frequency dropdown) → re-read the Buy Box state.
   * @param {Event} event
   */
  #handleBuyBoxChange = (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    if (this.contains(field) || field.closest('product-card')) return;
    if (field.name === 'selling_plan' || field.closest('.somna-custom-subscription-container')) {
      this.#syncPurchaseState();
    }
  };

  /**
   * Reads the purchase option from the Buy Box and applies it to the sticky bar.
   * Arrow function so it can be used directly as an event listener.
   */
  #syncPurchaseState = () => {
    if (!this.querySelector('[data-somna-sticky]')) return;
    this.#purchaseState = this.#readBuyBoxState();
    this.#applyPurchaseState();
  };

  /**
   * Source of truth: the native `selling_plan` field(s) that will be submitted with the
   * main product form. An enabled field with a value (checked, for radios) = subscription.
   * Works for the Somna widget (hidden input, disabled for one-time) and for Shopify's
   * native selling-plan radios / selects rendered by apps.
   * @returns {PurchaseState}
   */
  #readBuyBoxState() {
    const section = this.closest('.shopify-section');
    const productForm = this.#getProductForm()?.querySelector('form') ?? null;

    // Only fields that belong to the main product form (or to no form, e.g. app widgets that
    // copy their value into the form) — never quick-add / product-card forms.
    /** @type {Array<HTMLInputElement | HTMLSelectElement>} */
    const fields = Array.from(section?.querySelectorAll('[name="selling_plan"]') ?? []).filter(
      (field) =>
        (field instanceof HTMLInputElement || field instanceof HTMLSelectElement) &&
        !this.contains(field) &&
        !field.closest('product-card') &&
        (!productForm || field.form === productForm || field.form === null)
    );

    for (const field of fields) {
      if (field.disabled) continue;
      if (field instanceof HTMLInputElement && field.type === 'radio' && !field.checked) continue;
      if (field.value) return { mode: 'subscribe', sellingPlanId: field.value };
    }

    return { mode: 'onetime', sellingPlanId: '' };
  }

  /**
   * Writes the current purchase state into the sticky markup: mode attribute (CSS shows the
   * matching labels / button text), row prices, and the dropdown trigger summary.
   */
  #applyPurchaseState() {
    const { mode, sellingPlanId } = this.#purchaseState;
    this.dataset.purchaseMode = mode;

    /** @type {{ price: string, perNight: string, label: string } | null} */
    let selected = null;

    for (const row of this.querySelectorAll('[data-somna-sticky-row]')) {
      if (!(row instanceof HTMLElement)) continue;
      const values = this.#getRowValues(row);
      const perNightElement = row.querySelector('[data-somna-sticky-field="per-night"]');
      if (perNightElement) perNightElement.textContent = values.perNight;
      if (row.getAttribute('aria-selected') === 'true') selected = values;
    }

    if (!selected) return;
    const trigger = this.querySelector('[data-somna-sticky-toggle]');
    this.#setField(trigger, 'price', selected.price);
    this.#setField(trigger, 'per-night', selected.perNight);
    this.#setField(this.querySelector('[data-somna-sticky-panel]'), 'plan-label', selected.label);
  }

  /**
   * Prices for one size row in the current mode. In subscription mode the Buy Box's selling
   * plan is used; if this size doesn't offer that plan, its first native plan is used.
   * @param {HTMLElement} row
   * @returns {{ price: string, perNight: string, label: string }}
   */
  #getRowValues(row) {
    const oneTime = {
      price: row.dataset.onetimePrice ?? '',
      perNight: row.dataset.onetimePerNight ?? '',
      label: '',
    };
    if (this.#purchaseState.mode !== 'subscribe') return oneTime;

    /** @type {Record<string, StickyPlanData>} */
    let plans = {};
    try {
      plans = JSON.parse(row.dataset.plans || '{}');
    } catch (error) {
      return oneTime;
    }

    const plan = plans[this.#purchaseState.sellingPlanId] ?? Object.values(plans)[0];
    return plan ?? oneTime;
  }

  /**
   * @param {Element | null} scope
   * @param {string} field
   * @param {string} value
   */
  #setField(scope, field, value) {
    scope?.querySelectorAll(`[data-somna-sticky-field="${field}"]`).forEach((element) => {
      element.textContent = value;
    });
  }

  /**
   * Delegated clicks inside the sticky bar: dropdown toggle and size rows.
   * @param {MouseEvent} event
   */
  #handleStickyClick = (event) => {
    if (!(event.target instanceof Element)) return;

    if (event.target.closest('[data-somna-sticky-toggle]')) {
      this.#togglePanel();
      return;
    }

    const row = event.target.closest('[data-somna-sticky-row]');
    if (row instanceof HTMLButtonElement && !row.disabled) {
      this.#selectSize(row);
    }
  };

  /**
   * Selecting a size in the sticky bar selects the same option value in the Buy Box.
   * The Buy Box then runs its normal variant change, which re-renders this bar.
   * @param {HTMLElement} row
   */
  #selectSize(row) {
    this.#togglePanel(false);
    if (row.getAttribute('aria-selected') === 'true') return;

    const optionValueId = row.dataset.optionValueId;
    const section = this.closest('.shopify-section');
    const variantPicker = section?.querySelector(`variant-picker[data-product-id="${this.dataset.productId}"]`);
    if (!optionValueId || !variantPicker) return;

    const input = variantPicker.querySelector(`input[data-option-value-id="${optionValueId}"]`);
    if (input instanceof HTMLInputElement) {
      if (!input.checked) input.click();
      return;
    }

    // Dropdown-style variant pickers
    const option = variantPicker.querySelector(`option[data-option-value-id="${optionValueId}"]`);
    const select = option?.closest('select');
    if (option instanceof HTMLOptionElement && select) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * @param {boolean} [force] - true = open, false = close, undefined = toggle
   */
  #togglePanel(force) {
    const trigger = this.querySelector('[data-somna-sticky-toggle]');
    const panel = this.querySelector('[data-somna-sticky-panel]');
    if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) return;

    const open = force ?? panel.hidden;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  }

  /** @param {MouseEvent} event */
  #handleOutsideClick = (event) => {
    if (event.target instanceof Node && this.contains(event.target)) return;
    this.#togglePanel(false);
  };

  /** @param {KeyboardEvent} event */
  #handleKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const panel = this.querySelector('[data-somna-sticky-panel]');
    if (panel instanceof HTMLElement && !panel.hidden) {
      this.#togglePanel(false);
      const trigger = this.querySelector('[data-somna-sticky-toggle]');
      if (trigger instanceof HTMLElement) trigger.focus();
    }
  };

  /**
   * Shows the sticky bar with animation
   */
  #showStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = true;
    stickyBar.dataset.stuck = 'true';
  }

  /**
   * Hides the sticky bar with animation
   */
  #hideStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = false;
    stickyBar.dataset.stuck = 'false';
    this.#togglePanel(false);
  }

  // Helper methods
  /**
   * Checks whether the Shopify Chat is active on the page.
   * When active, the sticky bar must stay hidden to avoid overlapping the chat UI.
   *
   * <shopify-chat> is rendered unconditionally by chat-drawer.liquid, but
   * the "Ask anything" button only paints once the Inbox app has installed
   * and upgraded the element. Gate on the registration of the custom element
   * (the same signal chat-drawer.liquid uses via customElements.whenDefined)
   * so the inert placeholder on shops without Inbox doesn't suppress the
   * sticky bar.
   *
   * @returns {boolean}
   */
  #isChatActive() {
    if (!customElements.get('shopify-chat')) return false;
    return Boolean(document.querySelector('shopify-chat'));
  }

  /**
   * Gets the product form element
   * @returns {HTMLElement | null}
   */
  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest('.shopify-section');
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace('shopify-section-', '');
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  /**
   * Gets the initial quantity from the data attribute
   */
  #getInitialQuantity() {
    this.#currentQuantity = parseInt(this.dataset.initialQuantity || '1') || 1;
    this.#updateButtonText();
  }

  /**
   * Updates the button text to include quantity
   */
  #updateButtonText() {
    const { addToCartButton, quantityDisplay, quantityNumber } = this.refs;

    const available = !addToCartButton.disabled;

    // Update the quantity number
    quantityNumber.textContent = this.#currentQuantity.toString();

    // Show/hide the quantity display based on availability and quantity
    if (available && this.#currentQuantity > 1) {
      quantityDisplay.style.display = 'inline';
    } else {
      quantityDisplay.style.display = 'none';
    }
  }
}

if (!customElements.get('sticky-add-to-cart')) {
  customElements.define('sticky-add-to-cart', StickyAddToCartComponent);
}
