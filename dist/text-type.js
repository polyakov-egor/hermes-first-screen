(() => {
  "use strict";

  const TYPE_SPEED_MS = 40;
  const TYPE_BUDGET_MS = 1000;
  const CURSOR_PERIOD_MS = 1000;
  const CURSOR_INITIAL_DELAY_MS = 300;
  const states = new WeakMap();
  const moving = new Set();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isReview = /^[1-6]$/.test(new URLSearchParams(location.search).get("review") || "");
  const segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;

  const instant = () => isReview || reducedMotion.matches;
  const visible = (state) => state.panel.isConnected && !state.panel.hidden &&
    state.panel.classList.contains("is-revealed");

  function cancel(state) {
    ++state.operation;
    clearTimeout(state.timer);
    state.timer = null;
    moving.delete(state);
    if (state.resolve) state.resolve();
    state.resolve = null;
  }

  function cursorAtRest(state) {
    if (!state.cursor) return;
    for (const property of ["left", "top"]) {
      const original = state.cursorStyle[property];
      if (original) state.cursor.style.setProperty(property, original.value, original.priority);
      else state.cursor.style.removeProperty(property);
    }
  }

  function status(state, name) {
    state.title.dataset.typeState = name;
  }

  function prepare(panel) {
    if (!(panel instanceof Element)) return null;
    let state = states.get(panel);
    if (state && state.title.isConnected && panel.contains(state.title)) return state;
    const title = panel.matches("[data-type-title]") ? panel : panel.querySelector("[data-type-title]");
    if (!title) return null;
    if (state) cancel(state);

    const cursor = panel.querySelector("[data-type-cursor]");
    const tokens = [];
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parts = segmenter ? [...segmenter.segment(node.data)] : Array.from(node.data).map(
        (segment, index, all) => ({ segment, index: all.slice(0, index).join("").length })
      );
      for (const part of parts) tokens.push({ node, start: part.index,
        end: part.index + part.segment.length, character: part.segment });
    }
    const cursorStyle = {};
    for (const property of ["left", "top"]) {
      const value = cursor?.style.getPropertyValue(property);
      if (value) cursorStyle[property] = { value, priority: cursor.style.getPropertyPriority(property) };
    }
    const computedCursor = cursor && getComputedStyle(cursor);
    state = { panel, title, cursor, tokens, cursorStyle, operation: 0, timer: null,
      resolve: null, count: 0, geometry: null,
      finalX: computedCursor ? parseFloat(computedCursor.left) : 0,
      finalY: computedCursor ? parseFloat(computedCursor.top) : 0 };
    states.set(panel, state);
    title.dataset.typeLength = String(tokens.length);
    title.dataset.typeProgress = "0";
    title.style.clipPath = "inset(0 100% 0 0)";
    status(state, "idle");
    if (cursor) cursor.dataset.typeVisible = "false";
    return state;
  }

  // Range measurement leaves the original heading, its block spans, kerning and
  // wrapping intact. Only its visible area changes; assistive technology always
  // receives the full original heading instead of a stream of partial words.
  function measure(state) {
    const box = state.title.getBoundingClientRect();
    const parentBox = (state.cursor?.offsetParent || state.panel).getBoundingClientRect();
    const scale = box.width / state.title.offsetWidth;
    if (!box.width || !Number.isFinite(scale) || scale <= 0 || !state.tokens.length) {
      throw new Error("The title must be visible before its letters can be measured");
    }
    const range = document.createRange();
    const letters = state.tokens.map((token) => {
      range.setStart(token.node, token.start);
      range.setEnd(token.node, token.end);
      const rect = range.getBoundingClientRect();
      return { left: (rect.left - box.left) / scale, right: (rect.right - box.left) / scale,
        top: (rect.top - box.top) / scale, height: rect.height / scale,
        panelRight: (rect.right - parentBox.left) / scale,
        panelTop: (rect.top - parentBox.top) / scale };
    });
    range.detach();
    if (letters.some((letter) => !Number.isFinite(letter.right) || !letter.height)) {
      throw new Error("The title contains an unmeasurable letter");
    }
    const final = letters[letters.length - 1];
    const lineHeight = parseFloat(getComputedStyle(state.title).lineHeight) || final.height;
    state.geometry = { letters, lineHeight,
      top: Math.min(...letters.map((letter) => letter.top)) - lineHeight,
      left: Math.min(0, ...letters.map((letter) => letter.left)) - 2,
      right: Math.max(state.title.offsetWidth, ...letters.map((letter) => letter.right)) + 2,
      cursorX: state.finalX - final.panelRight, cursorY: state.finalY - final.panelTop };
  }

  function render(state, count, cursorVisible = true) {
    state.count = Math.max(0, Math.min(state.tokens.length, count));
    state.title.dataset.typeProgress = String(state.count);
    if (state.cursor) state.cursor.dataset.typeVisible = cursorVisible ? "true" : "false";
    if (state.count === state.tokens.length) {
      state.title.style.clipPath = "none";
      cursorAtRest(state);
      return;
    }
    if (!state.count) state.title.style.clipPath = "inset(0 100% 0 0)";
    const geometry = state.geometry;
    if (!geometry) return;
    const letter = geometry.letters[Math.max(0, state.count - 1)];
    if (state.count) {
      // The full previous lines and the current line's typed prefix form one
      // staircase-shaped clip. No letter wrapper can change the final layout.
      // Font Range boxes extend above and below the trimmed capitals. The
      // original cursor is aligned to their ink, so it gives a safe line band
      // without slicing the bottom of the currently typed capitals.
      const lineTop = letter.top + geometry.cursorY - 4;
      const bottom = lineTop + geometry.lineHeight;
      const edge = letter.right + 0.25;
      const { left, right, top } = geometry;
      state.title.style.clipPath = `polygon(${left}px ${top}px,${right}px ${top}px,` +
        `${right}px ${lineTop}px,${edge}px ${lineTop}px,${edge}px ${bottom}px,${left}px ${bottom}px)`;
    }
    if (state.cursor) {
      const right = state.count ? letter.panelRight : letter.panelRight - (letter.right - letter.left);
      state.cursor.style.left = `${right + geometry.cursorX}px`;
      state.cursor.style.top = `${letter.panelTop + geometry.cursorY}px`;
    }
  }

  function fallback(state, error) {
    cancel(state);
    render(state, state.tokens.length);
    status(state, "shown");
    state.title.dataset.typeFallback = "true";
    console.warn("Hermes title animation kept the full heading:", error.message);
  }

  function delays(state, deleting) {
    const amount = deleting ? state.count : state.tokens.length - state.count;
    const values = Array.from({ length: amount }, () => deleting
      ? 25 + Math.random() * 5 : TYPE_SPEED_MS + (Math.random() - 0.5) * 32);
    const total = values.reduce((sum, value) => sum + value, 0);
    const scale = !deleting && total > TYPE_BUDGET_MS ? TYPE_BUDGET_MS / total : 1;
    return values.map((value) => value * scale);
  }

  function animate(state, deleting) {
    const operation = state.operation;
    const waits = delays(state, deleting);
    let step = 0;
    moving.add(state);
    return new Promise((resolve) => {
      state.resolve = resolve;
      const finish = () => {
        state.timer = null;
        state.resolve = null;
        moving.delete(state);
        status(state, deleting ? "empty" : "shown");
        if (deleting && state.cursor) state.cursor.dataset.typeVisible = "false";
        resolve();
      };
      const advance = () => {
        if (state.operation !== operation) return;
        if (!visible(state)) { cancel(state); return; }
        try {
          render(state, state.count + (deleting ? -1 : 1));
          if (++step >= waits.length) finish();
          else state.timer = setTimeout(advance, waits[step]);
        } catch (error) { fallback(state, error); }
      };
      if (!waits.length) finish();
      else state.timer = setTimeout(advance, waits[0]);
    });
  }

  function enter(panel, { immediate = false } = {}) {
    const state = prepare(panel);
    if (!state) return Promise.resolve();
    cancel(state);
    delete state.title.dataset.typeFallback;
    if (immediate || instant() || panel.dataset.screen === "6") {
      render(state, state.tokens.length);
      status(state, "shown");
      return Promise.resolve();
    }
    try {
      measure(state);
      render(state, 0);
      status(state, "typing");
      // A preload normally settles well before screen 2. If the font finishes
      // during typing, refresh only the still-current visible operation.
      const operation = state.operation;
      document.fonts?.ready.then(() => {
        if (state.operation !== operation || !moving.has(state) || !visible(state)) return;
        try { measure(state); render(state, state.count); } catch (error) { fallback(state, error); }
      });
      return animate(state, false);
    } catch (error) { fallback(state, error); return Promise.resolve(); }
  }

  function exit(panel) {
    const state = prepare(panel);
    if (!state) return Promise.resolve();
    cancel(state);
    if (instant() || !state.count || !visible(state)) {
      render(state, 0, false);
      status(state, "empty");
      return Promise.resolve();
    }
    try {
      measure(state);
      status(state, "erasing");
      return animate(state, true);
    } catch (error) {
      cancel(state);
      render(state, 0, false);
      status(state, "empty");
      return Promise.resolve();
    }
  }

  function reset(panel) {
    const state = prepare(panel);
    if (!state) return;
    cancel(state);
    state.geometry = null;
    render(state, 0, false);
    cursorAtRest(state);
    state.cursor?.style.removeProperty("--type-cursor-delay");
    status(state, "idle");
  }

  function transfer(fromPanel, toPanel) {
    const previous = prepare(fromPanel);
    const incoming = prepare(toPanel);
    if (!incoming) return;
    const blink = previous?.cursor?.querySelector(".title-cursor-blink");
    const animation = blink?.getAnimations().find((item) => item.animationName === "text-cursor-blink");
    if (animation && typeof animation.currentTime === "number" && incoming.cursor && !instant()) {
      const timingDelay = Number(animation.effect.getTiming().delay);
      const delay = Number.isFinite(timingDelay) ? timingDelay : CURSOR_INITIAL_DELAY_MS;
      const phase = Math.max(0, animation.currentTime - delay) % CURSOR_PERIOD_MS;
      incoming.cursor.style.setProperty("--type-cursor-delay", `${-phase}ms`);
    }
    if (previous) cancel(previous);
    cancel(incoming);
    render(incoming, incoming.tokens.length);
    status(incoming, "shown");
  }

  window.addEventListener("resize", () => {
    for (const state of moving) {
      if (!visible(state)) continue;
      try { measure(state); render(state, state.count); } catch (error) { fallback(state, error); }
    }
  }, { passive: true });

  window.HermesTitles = Object.freeze({ prepare, enter, exit, reset, transfer });
})();
