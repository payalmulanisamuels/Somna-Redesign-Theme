import { Component } from '@theme/component';
import { trapFocus, removeTrapFocus } from '@theme/focus';
import { onAnimationEnd, removeWillChangeOnAnimationEnd } from '@theme/utilities';

/**
 * A custom element that manages the main menu drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDetailsElement} details - The details element.
 * @property {HTMLDivElement} menuDrawer - The slideable drawer panel containing the menu.
 *
 * @extends {Component<Refs>}
 */
class HeaderDrawer extends Component {
  requiredRefs = ['details', 'menuDrawer'];

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('keyup', this.#onKeyUp);
    this.#setupAnimatedElementListeners();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('keyup', this.#onKeyUp);
  }

  /**
   * Close the main menu drawer when the Escape key is pressed
   * @param {KeyboardEvent} event
   */
  #onKeyUp = (event) => {
    if (event.key !== 'Escape') return;

    this.#close(this.#getDetailsElement(event));
  };

  /**
   * @returns {boolean} Whether the main menu drawer is open
   */
  get isOpen() {
    return this.refs.details.hasAttribute('open');
  }

  /**
   * Get the closest details element to the event target
   * @param {Event | undefined} event
   * @returns {HTMLDetailsElement}
   */
  #getDetailsElement(event) {
    if (!(event?.target instanceof Element)) return this.refs.details;

    return event.target.closest('details') ?? this.refs.details;
  }

  /**
   * Toggle the main menu drawer
   */
  toggle(event) {
    // Somna: while the closing animation runs the menu is still [open] but no longer .menu-open.
    // Treat that as closed so a tap on the hamburger re-opens it straight away, and stop the
    // <summary>'s own toggle from closing the <details> under us.
    if (this.isOpen && !this.refs.details.classList.contains('menu-open')) {
      event?.preventDefault?.();
      return this.open();
    }

    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Open the closest drawer or the main menu drawer
   * @param {string} [target]
   * @param {Event} [event]
   */
  open(target, event) {
    const details = this.#getDetailsElement(event);
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'true');

    this.preventInitialAccordionAnimations(details);
    requestAnimationFrame(() => {
      const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');

      if (details === this.refs.details && drawer instanceof HTMLElement) this.#setRevealOrigin(drawer);

      // The drawer was display: none until [open]. Force a style flush so its closed state is
      // computed first; otherwise the browser can skip the opening transition and show it instantly.
      drawer?.getBoundingClientRect();
      details.classList.add('menu-open');

      if (target) {
        this.refs.menuDrawer.classList.add('menu-drawer--has-submenu-opened');
      }

      // Wait for the drawer animation to complete before trapping focus
      onAnimationEnd(drawer || details, () => trapFocus(details), { subtree: false });
    });
  }

  /**
   * Somna: the main drawer is a card that grows out of the header bar (see "Mobile menu" in custom.css).
   * 1. The header's `contain: layout` makes it the fixed drawer's containing block, so store the
   *    header's offset from the viewport for the CSS to cancel out.
   * 2. Store how far the header bar is from the card's top and bottom edges; the closed clip-path
   *    uses these so the card starts (and ends) as exactly the header bar.
   * @param {HTMLElement} drawer
   */
  #setRevealOrigin(drawer) {
    const style = getComputedStyle(drawer);
    const placed = drawer.getBoundingClientRect();
    // Viewport position minus the resolved `top`/`left` = where the containing block starts
    drawer.style.setProperty('--somna-cb-top', `${placed.top - parseFloat(style.top)}px`);
    drawer.style.setProperty('--somna-cb-left', `${placed.left - parseFloat(style.left)}px`);

    const bar = (this.closest('.header__row') ?? this).getBoundingClientRect();
    const panel = drawer.getBoundingClientRect();

    drawer.style.setProperty('--somna-reveal-top', `${Math.max(0, bar.top - panel.top)}px`);
    drawer.style.setProperty('--somna-reveal-bottom', `${Math.max(0, panel.bottom - bar.bottom)}px`);
  }

  /**
   * Go back or close the main menu drawer
   * @param {Event} [event]
   */
  back(event) {
    this.#close(this.#getDetailsElement(event));
  }

  /**
   * Close the main menu drawer
   */
  close() {
    this.#close(this.refs.details);
  }

  /**
   * Close the closest menu or submenu that is open
   *
   * @param {HTMLDetailsElement} details
   */
  #close(details) {
    const summary = details.querySelector('summary');

    if (!summary) return;

    summary.setAttribute('aria-expanded', 'false');
    details.classList.remove('menu-open');
    this.refs.menuDrawer.classList.remove('menu-drawer--has-submenu-opened');

    // Wait for the .menu-drawer element's transition, not the entire details subtree
    // This avoids waiting for child accordion/resource-card animations which can cause issues on Firefox
    const drawer = details.querySelector('.menu-drawer, .menu-drawer__submenu');

    onAnimationEnd(
      drawer || details,
      () => {
        // Re-opened before the closing animation finished (see toggle): leave it open
        if (details.classList.contains('menu-open')) return;

        reset(details);
        if (details === this.refs.details) {
          removeTrapFocus();
          const openDetails = this.querySelectorAll('details[open]:not(accordion-custom > details)');
          openDetails.forEach(reset);
        } else {
          trapFocus(this.refs.details);
        }
      },
      { subtree: false }
    );
  }

  /**
   * Attach animationend event listeners to all animated elements to remove will-change after animation
   * to remove the stacking context and allow submenus to be positioned correctly
   */
  #setupAnimatedElementListeners() {
    const allAnimated = this.querySelectorAll('.menu-drawer__animated-element');
    allAnimated.forEach((element) => {
      element.addEventListener('animationend', removeWillChangeOnAnimationEnd);
    });
  }

  /**
   * Temporarily disables accordion animations to prevent unwanted transitions when the drawer opens.
   * Adds a no-animation class to accordion content elements, then removes it after 100ms to
   * re-enable animations for user interactions.
   * @param {HTMLDetailsElement} details - The details element containing the accordions
   */
  preventInitialAccordionAnimations(details) {
    const content = details.querySelectorAll('accordion-custom .details-content');

    content.forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add('details-content--no-animation');
      }
    });
    setTimeout(() => {
      content.forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.remove('details-content--no-animation');
        }
      });
    }, 100);
  }
}

if (!customElements.get('header-drawer')) {
  customElements.define('header-drawer', HeaderDrawer);
}

/**
 * Reset an open details element to its original state
 *
 * @param {HTMLDetailsElement} element
 */
function reset(element) {
  element.classList.remove('menu-open');
  element.removeAttribute('open');
  element.querySelector('summary')?.setAttribute('aria-expanded', 'false');
}
