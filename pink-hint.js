(() => {
  "use strict";
  const FADE_MS = 180;
  const VISIBLE_MS = 5000;

  function initialize() {
    const panel = document.getElementById("fifth-screen-content");
    const anchor = document.getElementById("select-pink");
    const scene = document.querySelector(".scene");
    if (!panel || !anchor || !scene) return;
    const root = document.createElement("div");
    root.id = "pink-scroll-hint";
    root.className = "pink-hint";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.dataset.nodeId = "448:272";
    root.innerHTML = `<div class="pink-hint-backdrop" aria-hidden="true" data-node-id="448:273"></div>
      <div class="pink-hint-toast" role="status" aria-live="polite" data-node-id="448:265"><p data-node-id="448:266">Click on Pink to switch</p></div>
      <div class="pink-hint-dot pink-hint-dot-large" aria-hidden="true" data-node-id="448:271"><img src="assets/pink-hint-dot-large.svg" width="8.01194" height="8" alt=""></div>
      <div class="pink-hint-dot pink-hint-dot-small" aria-hidden="true" data-node-id="448:267"><img src="assets/pink-hint-dot-small.svg" width="4.00597" height="4" alt=""></div>
      <span class="pink-hint-choice" aria-hidden="true" data-node-id="448:240">Pink</span>`;
    panel.append(root);
    let seen = false;
    let timer = null;
    let fadeTimer = null;
    let frame = null;
    let closing = null;
    let finishClosing = null;
    let generation = 0;

    function align() {
      const source = anchor.getBoundingClientRect();
      const canvas = scene.getBoundingClientRect();
      const scale = canvas.width / 1920;
      if (!scale || !source.width) return;
      root.style.setProperty("--pink-hint-x", ((source.left + source.width / 2 - canvas.left) / scale) + "px");
      root.style.setProperty("--pink-hint-y", ((source.top - canvas.top) / scale) + "px");
      root.style.setProperty("--pink-hint-width", (source.width / scale) + "px");
      root.style.setProperty("--pink-hint-height", (source.height / scale) + "px");
    }
    function dismiss() {
      generation++;
      clearTimeout(timer);
      clearTimeout(fadeTimer);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = timer = fadeTimer = null;
      root.classList.remove("is-visible");
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      const resolve = finishClosing;
      closing = finishClosing = null;
      resolve?.();
    }
    function hide() {
      if (root.hidden) return Promise.resolve();
      if (closing) return closing;
      generation++;
      clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = timer = null;
      root.classList.remove("is-visible");
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FADE_MS;
      closing = new Promise(resolve => { finishClosing = resolve; });
      fadeTimer = setTimeout(dismiss, duration);
      return closing;
    }
    function showOnce() {
      if (seen || panel.hidden || document.documentElement.dataset.state === "review") return false;
      seen = true;
      const entry = ++generation;
      align();
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
      // Start from a painted zero opacity so entry remains a plain fade.
      void root.offsetWidth;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (generation === entry && !root.hidden) root.classList.add("is-visible");
      });
      timer = setTimeout(() => { void hide(); }, VISIBLE_MS);
      return true;
    }
    window.addEventListener("resize", () => { if (!root.hidden) align(); });
    window.HermesPinkHint = Object.freeze({ showOnce, hide, dismiss, isVisible: () => !root.hidden });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
