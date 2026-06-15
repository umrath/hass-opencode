/*
 * Touch scrolling for ttyd/xterm.js on phones and tablets.
 *
 * OpenCode runs as a full-screen TUI with mouse reporting on, so xterm.js has
 * no scrollback to swipe and forwards touches to the application as mouse
 * events instead of scrolling. On a touch device the view is therefore stuck
 * and unusable. The desktop mouse wheel already scrolls OpenCode (xterm.js ->
 * tmux -> app), so we translate a one-finger vertical drag into the same wheel
 * events and dispatch them at the touch point, letting that proven path scroll
 * the application. Injected inline like clipboard.js (see Dockerfile).
 *
 * Desktop is untouched: the whole thing is a no-op on non-touch pointers.
 */
(function () {
  'use strict';

  if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;

  var STEP = 22; // pixels of drag per wheel "tick"

  function setup(term) {
    var root = term.element;
    if (!root) return;
    var lastY = null;
    var accum = 0;

    root.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { lastY = null; return; }
      lastY = e.touches[0].clientY;
      accum = 0;
    }, { passive: true });

    root.addEventListener('touchmove', function (e) {
      if (lastY === null || e.touches.length !== 1) return;
      if (e.cancelable) e.preventDefault(); // prevent ingress iframe from stealing drag
      var t = e.touches[0];
      accum += lastY - t.clientY; // finger up => reveal lower content => scroll down
      lastY = t.clientY;
      var ticks = (accum / STEP) | 0;
      if (!ticks) return;
      accum -= ticks * STEP;
      var target = document.elementFromPoint(t.clientX, t.clientY) || root;
      var dir = ticks > 0 ? 1 : -1;
      var n = Math.abs(ticks);
      for (var i = 0; i < n; i++) {
        target.dispatchEvent(new WheelEvent('wheel', {
          deltaY: dir * STEP,
          deltaMode: 0,
          clientX: t.clientX,
          clientY: t.clientY,
          bubbles: true,
          cancelable: true
        }));
      }
    }, { passive: false });

    function reset() { lastY = null; }
    root.addEventListener('touchend', reset, { passive: true });
    root.addEventListener('touchcancel', reset, { passive: true });
  }

  /* ttyd exposes the terminal as window.term once initialised; this script runs
     before that, so poll briefly (up to ~10s) — same pattern as clipboard.js. */
  var tries = 0;
  (function waitForTerm() {
    if (window.term && window.term.element) {
      try { setup(window.term); } catch (e) { /* never break the terminal */ }
    } else if (++tries < 200) {
      setTimeout(waitForTerm, 50);
    }
  })();
})();
