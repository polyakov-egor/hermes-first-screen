(() => {
  "use strict";

  // Reversible trial for the first forward transition only. These offsets
  // split the measured horizontal steps between duplicated source frames.
  const ENABLED = true;
  const START_SECONDS = 5;
  const END_SECONDS = 5.2;
  const OFFSETS = Object.freeze([0, -3, 0, -3, 0, -2.5, 0, -2, 0, -2.5, 0, -2, 0]);
  const active = new WeakMap();

  function begin(video, isCurrent) {
    active.get(video)?.();
    const settings = () => window.HermesSettings?.getValues() || { smoothing: true, smoothingStrength: 1 };
    if (!ENABLED || new URLSearchParams(window.location.search).get("smooth") === "0" ||
        !settings().smoothing || settings().smoothingStrength === 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        typeof video.requestVideoFrameCallback !== "function") return () => {};

    const previous = video.style.translate;
    let request = null;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (request !== null) video.cancelVideoFrameCallback(request);
      request = null;
      video.style.translate = previous;
      delete video.dataset.firstCueOffset;
      ["pause", "seeking", "error", "emptied"].forEach(name => video.removeEventListener(name, stop));
      if (active.get(video) === stop) active.delete(video);
    };
    active.set(video, stop);
    const observe = (_now, metadata) => {
      request = null;
      const current = settings();
      if (stopped || !isCurrent() || video.seeking || !current.smoothing ||
          metadata.mediaTime >= END_SECONDS - 0.000001) {
        stop();
        return;
      }
      const frame = Math.round((metadata.mediaTime - START_SECONDS) * 60);
      const offset = (OFFSETS[frame] ?? 0) * current.smoothingStrength;
      video.style.translate = offset + "px 0px";
      video.dataset.firstCueOffset = String(offset);
      request = video.requestVideoFrameCallback(observe);
    };
    ["pause", "seeking", "error", "emptied"].forEach(name => video.addEventListener(name, stop));
    video.style.translate = "0px 0px";
    video.dataset.firstCueOffset = "0";
    request = video.requestVideoFrameCallback(observe);
    return stop;
  }

  window.HermesFirstCueSmoothing = Object.freeze({ begin });
})();
