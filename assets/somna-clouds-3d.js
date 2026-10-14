/* Somna – "Shop the essentials" 3D clouds (one top-left, one top-right)
   Builds a small layered cloud scene (CSS 3D transforms) inside each .somna-ess section.
   Decorative only: aria-hidden, no clicks, no layout change. Styles: assets/somna-motion-clouds.css */
(function () {
  var CLOUDS = [
    /* side, number of puffs, spread, size (em) */
    { side: 'left', n: 7, spread: 2.4, size: 3.6, seed: 7 },
    { side: 'right', n: 6, spread: 2, size: 3.1, seed: 23 }
  ];

  function seeded(seed) {
    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  function build(section) {
    if (section.querySelector(':scope > .sm-cloud3d')) return;
    var first = section.firstChild;
    CLOUDS.forEach(function (c) {
      var rnd = seeded(c.seed);
      var wrap = document.createElement('div');
      wrap.className = 'sm-cloud3d sm-cloud3d--' + c.side;
      wrap.setAttribute('aria-hidden', 'true');
      var world = document.createElement('div');
      world.className = 'sm-cloud3d__world';
      for (var i = 0; i < c.n; i++) {
        var p = document.createElement('span');
        p.className = 'sm-cloud3d__puff';
        var px = (rnd() * 2 - 1) * c.spread;
        var py = (rnd() * 2 - 1) * c.spread * 0.22;
        var pz = (rnd() * 2 - 1) * c.spread * 0.7;
        var s = c.size * (0.7 + rnd() * 0.5);
        p.style.cssText =
          '--sz:' + s.toFixed(2) + 'em;' +
          'translate:' + px.toFixed(2) + 'em ' + py.toFixed(2) + 'em ' + pz.toFixed(2) + 'em;' +
          'animation-delay:' + (-rnd() * 9).toFixed(1) + 's;' +
          'animation-duration:' + (7 + rnd() * 4).toFixed(1) + 's;';
        world.appendChild(p);
      }
      wrap.appendChild(world);
      section.append(wrap, first);
    });
  }

  function init() {
    document.querySelectorAll('.somna-ess').forEach(build);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  /* Theme editor: rebuild when the section is re-rendered */
  document.addEventListener('shopify:section:load', init);
})();
