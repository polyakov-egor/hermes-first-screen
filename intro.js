(() => {
  "use strict";

  const REVEAL_AT_SECONDS = 4;
  const SCREEN_CUES = Object.freeze([5, 8.07, 11.14, 14.12, 23.20, 32.12]);
  // The return asset reverses source frames 1392 down through 300 at 60 fps.
  // These times identify the matching pose of each main-video screen cue.
  const RETURN_CUES = Object.freeze([1092 / 60, 908 / 60, 724 / 60, 545 / 60, 0]);
  const IDLE_STATES = Object.freeze(["ended", "second", "third", "fourth", "fifth", "sixth"]);
  const WALK_SCREEN = 5;
  const WALK_ENTRY_SECONDS = 19.16;
  const WALK_TAG_DELAY_MS = 3000;
  const PINK_TAG_DELAY_MS = 4500;
  const WALK_START_FRAME = 1149;
  const WALK_END_FRAME = 1392;
  const WALK_FRAME_COUNT = WALK_END_FRAME - WALK_START_FRAME;
  const SCREEN_COUNT = SCREEN_CUES.length;
  const NAVIGABLE_SCREEN_COUNT = WALK_SCREEN;
  const PINK_SCREEN = 6;
  // The character transition and first white-jacket walk play once on main.
  // The native repeating walk takes over only at 32.12 s, after 28.20–32.12.
  const PINK_ENTRY_SECONDS = SCREEN_CUES[PINK_SCREEN - 1];
  const PINK_FRAME_COUNT = 294;
  const FRAME_SECONDS = 1 / 60;
  const HALF_FRAME_SECONDS = FRAME_SECONDS / 2;
  const EXIT_WAIT_LIMIT_MS = 500;
  const WHEEL_THRESHOLD = 40;
  const GESTURE_PAUSE_MS = 220;
  const MEDIA_WAIT_LIMIT_MS = 10000;
  const MEDIA_LOAD_WAIT_LIMIT_MS = 60000;

  const FLOW_DEFAULTS = Object.freeze({
    cues: SCREEN_CUES, returns: RETURN_CUES, brownStart: WALK_ENTRY_SECONDS, pinkEntry: PINK_ENTRY_SECONDS
  });

  function initializeIntro() {
    const intro = document.getElementById("intro-video");
    const backward = document.getElementById("reverse-video");
    const walk = document.getElementById("walk-loop-video");
    const pinkWalk = document.getElementById("pink-walk-loop-video");
    const header = document.getElementById("site-header");
    const featureCaption = document.getElementById("feature-about-caption");
    const panels = [
      "screen-content", "second-screen-content", "third-screen-content", "fourth-screen-content", "fifth-screen-content", "sixth-screen-content"
    ].map((id, index) => document.querySelector('.screen-content[data-screen="' + (index + 1) + '"]') ||
      document.getElementById(id));
    const firstContent = panels[0];
    const playButton = document.getElementById("play-intro");
    const status = document.getElementById("video-status");

    if (!(intro instanceof HTMLVideoElement) || !firstContent) return;

    const settings = window.HermesSettings;
    let values = settings?.getValues?.() ?? {
      cue1: 5, cue2: 8.07, cue3: 11.14, cue4: 14.12, cue5: 23.2, cue6: 32.12,
      brownStart: 19.16, pinkEnd: 37.02, speed: 1, x: 0, y: 0, scale: 1
    };
    let SCREEN_CUES = FLOW_DEFAULTS.cues.slice();
    let RETURN_CUES = FLOW_DEFAULTS.returns.slice();
    let WALK_ENTRY_SECONDS = FLOW_DEFAULTS.brownStart;
    let PINK_ENTRY_SECONDS = FLOW_DEFAULTS.pinkEntry;
    const PINK_ORIGIN_SECONDS = 1927 / 60;
    const TIMELINE_END_SECONDS = 37.02;
    let transportMode = "flow";
    let controlEpoch = 0;
    let controlBusy = false;
    let manualPlaybackActive = false;
    let activeVideo = intro;
    const playbackHandles = new Set();
    const pendingMediaWaits = new Set();

    const videos = [intro, backward, walk, pinkWalk].filter((video) => video instanceof HTMLVideoElement);
    const sources = new Map([
      [intro, "assets/helmet-sequence.mp4"],
      [backward, "assets/helmet-return.mp4"],
      [walk, "assets/helmet-walk-loop.mp4"],
      [pinkWalk, "assets/helmet-pink-walk-loop.mp4"]
    ]);
    const review = new URLSearchParams(window.location.search).get("review");
    const reviewScreen = /^[1-6]$/.test(review || "") ? Number(review) : null;
    let introRevealed = false;
    let introFinished = false;
    let introFailed = false;
    let currentScreen = 1;
    let transitioning = false;
    let pendingScreen = null;
    let operation = 0;
    let startingIntro = false;
    const presentedFrames = new Map();
    const preparedSources = new Map();
    const walkTagEntries = new WeakMap();
    let buttonAction = null;
    let wheelAmount = 0;
    let lastWheelAt = -Infinity;
    let consumedWheelBurst = false;
    let promotion = 0;
    let walkingPlayback = null;
    let walkingSession = 0;
    let pinkSelected = false;
    let pinkHintSelectionPending = false;
    let pinkContentShown = false;
    let pinkTagDeadline = null;
    let pinkTagTimer = null;
    let pinkTagSession = 0;
    let pinkCameraFinished = false;
    let pinkCameraResume = SCREEN_CUES[WALK_SCREEN - 1];
    let pinkLoopResume = 0;
    let pinkPlayback = null;
    let pinkSession = 0;

    const setState = (state) => { document.documentElement.dataset.state = state; };
    const setScreen = (screen) => {
      currentScreen = screen;
      document.body.dataset.currentScreen = String(screen);
      document.documentElement.dataset.currentScreen = String(screen);
    };
    const announce = (message) => { if (status) status.textContent = message; };
    const hidePlayButton = () => {
      buttonAction = null;
      if (playButton) {
        playButton.hidden = true;
        playButton.disabled = false;
      }
    };
    const offerPlayback = (action, label) => {
      buttonAction = action;
      if (playButton) {
        playButton.textContent = label;
        playButton.disabled = false;
        playButton.hidden = false;
      }
    };
    const setAccessible = (element, visible) => {
      if (!element) return;
      element.inert = !visible;
      if (visible) {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("inert", "");
        element.setAttribute("aria-hidden", "true");
      }
    };
    function titleAction(method, ...args) {
      const engine = window.HermesTitles;
      if (!engine || typeof engine[method] !== "function" || !args[0]) return;
      try {
        const result = engine[method](...args);
        return result && typeof result.catch === "function" ? result.catch(() => {}) : result;
      } catch {
        // A missing/failed optional title engine must not interrupt video flow.
      }
    }

    function cancelWalkTag(panel, reset = false) {
      if (!panel || panel !== panels[WALK_SCREEN - 1]) return;
      const entry = walkTagEntries.get(panel);
      if (entry) clearTimeout(entry.timer);
      walkTagEntries.delete(panel);
      if (reset) {
        panel.classList.remove("is-walk-tag-revealed");
        panel.querySelectorAll("[data-walk-tag]").forEach((tag) => setAccessible(tag, false));
      }
    }

    function walkTagSnapshot(panel) {
      if (!panel || panel !== panels[WALK_SCREEN - 1]) return null;
      return {
        revealed: panel.classList.contains("is-walk-tag-revealed"),
        deadline: walkTagEntries.get(panel)?.deadline ?? performance.now() + WALK_TAG_DELAY_MS
      };
    }

    function revealWalkTag(panel) {
      if (!panel || panel !== panels[WALK_SCREEN - 1] || pinkSelected || panel.hidden ||
          !panel.classList.contains("is-revealed") || panel.classList.contains("is-exiting")) return;
      if (!panel.classList.contains("is-walk-tag-revealed")) panel.classList.add("is-walk-tag-revealed");
      panel.querySelectorAll("[data-walk-tag]").forEach((tag) => setAccessible(tag, true));
    }

    function scheduleWalkTag(panel, { immediate = false, restore = null } = {}, mountedAt = performance.now()) {
      if (!panel || panel !== panels[WALK_SCREEN - 1] || !panel.querySelector("[data-walk-tag]")) return;
      cancelWalkTag(panel);
      const entry = { deadline: restore?.deadline ?? mountedAt + WALK_TAG_DELAY_MS, timer: null };
      walkTagEntries.set(panel, entry);
      if (immediate || restore?.revealed || panel.classList.contains("is-walk-tag-revealed") ||
          entry.deadline <= performance.now()) {
        revealWalkTag(panel);
        return;
      }
      const revealWhenDue = () => {
        if (walkTagEntries.get(panel) !== entry || pinkSelected || currentScreen !== WALK_SCREEN ||
            panel.hidden || !panel.classList.contains("is-revealed") || panel.classList.contains("is-exiting")) return;
        const remaining = entry.deadline - performance.now();
        if (remaining > 0) {
          entry.timer = setTimeout(revealWhenDue, Math.ceil(remaining));
          return;
        }
        entry.timer = null;
        revealWalkTag(panel);
      };
      entry.timer = setTimeout(revealWhenDue, Math.ceil(Math.max(0, entry.deadline - performance.now())));
    }

    const resetPanel = (panel, hidden = false) => {
      if (!panel) return;
      if (panel === panels[WALK_SCREEN - 1]) window.HermesPinkHint?.dismiss();
      if (panel === panels[PINK_SCREEN - 1]) {
        clearTimeout(pinkTagTimer);
        pinkTagTimer = null;
        ++pinkTagSession;
        panel.classList.remove("is-pink-tag-revealed");
        panel.querySelectorAll("[data-color-tag]").forEach((tag) => setAccessible(tag, false));
      }
      titleAction("reset", panel);
      cancelWalkTag(panel, true);
      panel.classList.remove("is-revealed", "is-exiting", "is-subsequent-entry", "is-colour-entry", "is-colour-transition", "is-angle-tags-revealed");
      panel.querySelectorAll("[data-angle-tag]").forEach((tag) => setAccessible(tag, false));
      panel.querySelectorAll("[data-color-tag].is-exiting").forEach((tag) => tag.classList.remove("is-exiting"));
      panel.hidden = hidden;
      setAccessible(panel, false);
    };
    const showPanel = (panel, subsequent = false, options = {}) => {
      if (!panel) return;
      cancelWalkTag(panel, true);
      panel.hidden = false;
      panel.classList.remove("is-revealed", "is-exiting", "is-angle-tags-revealed");
      panel.querySelectorAll("[data-angle-tag]").forEach((tag) => setAccessible(tag, false));
      panel.classList.toggle("is-subsequent-entry", subsequent);
      // Flush the previous animation so the same panel can reveal again on return.
      void panel.offsetWidth;
      panel.classList.add("is-revealed");
      const mountedAt = performance.now();
      setAccessible(panel, true);
      scheduleWalkTag(panel, {
        immediate: reviewScreen !== null,
        restore: options.walkTagRestore ?? null
      }, mountedAt);
      void titleAction("enter", panel, {
        immediate: Boolean(options.immediate || reviewScreen !== null || panel.classList.contains("is-colour-entry"))
      });
    };
    const isAngleScreen = (screen) => screen >= 2 && screen <= 4;
    const revealAngleTags = (panel) => {
      if (!panel || panel.hidden || !panel.classList.contains("is-revealed") ||
          panel.classList.contains("is-exiting") || panel.classList.contains("is-angle-tags-revealed")) return;
      panel.classList.add("is-angle-tags-revealed");
      panel.querySelectorAll("[data-angle-tag]").forEach((tag) => setAccessible(tag, true));
    };
    const resetFeatureCaption = () => {
      if (!featureCaption) return;
      featureCaption.classList.remove("is-revealed", "is-exiting");
      featureCaption.hidden = true;
      setAccessible(featureCaption, false);
    };
    const showFeatureCaption = () => {
      if (!featureCaption) return;
      // Keep this one element unchanged while moving between screens 2–4.
      if (!featureCaption.hidden && featureCaption.classList.contains("is-revealed") &&
          !featureCaption.classList.contains("is-exiting")) return;
      featureCaption.hidden = false;
      featureCaption.classList.remove("is-revealed", "is-exiting");
      void featureCaption.offsetWidth;
      featureCaption.classList.add("is-revealed");
      setAccessible(featureCaption, true);
    };

    async function exitFeatureCaption(isCurrent) {
      if (!featureCaption || featureCaption.hidden) return;
      await exitPanel(featureCaption);
      requireCurrent(isCurrent);
      resetFeatureCaption();
    }

    function restoreFeatureContent(screen) {
      if (isAngleScreen(screen)) {
        showFeatureCaption();
        revealAngleTags(panels[screen - 1]);
      } else resetFeatureCaption();
    }

    const revealHeader = () => {
      if (!header || header.classList.contains("is-revealed")) return;
      header.classList.add("is-revealed");
      setAccessible(header, true);
    };
    const promote = (video) => {
      // Promotion happens only after a decoded frame is available. The previous
      // scene stays opaque underneath until the incoming opacity transition ends.
      const thisPromotion = ++promotion;
      activeVideo = video;
      video.classList.add("is-active");
      videos.forEach((candidate) => {
        candidate.classList.toggle("is-top", candidate === video);
      });
      const finishPromotion = () => {
        if (promotion !== thisPromotion) return;
        videos.forEach((candidate) => candidate.classList.toggle("is-active", candidate === video));
      };
      const animations = typeof video.getAnimations === "function" ? video.getAnimations() : [];
      const opacityTransitions = animations.filter((animation) => animation.transitionProperty === "opacity");
      if (!opacityTransitions.length) {
        finishPromotion();
        return Promise.resolve();
      }
      return Promise.allSettled(opacityTransitions.map((animation) => animation.finished)).then(finishPromotion);
    };
    const abortError = () => new DOMException("Playback cancelled", "AbortError");
    const requireCurrent = (isCurrent) => { if (!isCurrent()) throw abortError(); };

    function revealIntro() {
      if (introRevealed) return;
      introRevealed = true;
      revealHeader();
      showPanel(firstContent);
      setState(introFinished ? "ended" : "revealed");
      announce("");
    }

    function checkIntroTime(mediaTime) {
      if (!introRevealed && Number.isFinite(mediaTime) && mediaTime >= REVEAL_AT_SECONDS) revealIntro();
    }

    function reportIntroError(error) {
      introFailed = true;
      introFinished = true;
      pendingScreen = null;
      hidePlayButton();
      // Preserve the loading poster and make the first screen usable.
      revealIntro();
      setState("error");
      document.documentElement.dataset.mediaFailure = error?.name + ": " + error?.message;
      announce("Не удалось запустить видео. Нажмите кнопку, чтобы попробовать ещё раз.");
      offerPlayback(() => {
        introFailed = false;
        introFinished = false;
        introRevealed = false;
        startingIntro = false;
        panels.forEach((panel, index) => resetPanel(panel, index > 0));
        resetFeatureCaption();
        if (header) {
          header.classList.remove("is-revealed");
          setAccessible(header, false);
        }
        delete document.documentElement.dataset.mediaFailure;
        setState("loading");
        return playIntro();
      }, "Play intro");
    }

    function syncSettings(next) {
      values = { ...next };
      SCREEN_CUES = Array.from({ length: 6 }, (_, index) => Number(values["cue" + (index + 1)]));
      RETURN_CUES = SCREEN_CUES.slice(0, 5).map((cue) =>
        (WALK_END_FRAME - Math.floor(Math.max(5, Math.min(23.2, cue)) / FRAME_SECONDS + 0.00001)) * FRAME_SECONDS);
      WALK_ENTRY_SECONDS = values.brownStart;
      PINK_ENTRY_SECONDS = SCREEN_CUES[PINK_SCREEN - 1];
      videos.forEach((video) => {
        video.defaultPlaybackRate = values.speed;
        video.playbackRate = values.speed;
      });
      const media = document.querySelector(".scene-media");
      if (media) {
        if (values.x === 0 && values.y === 0 && values.scale === 1) media.style.removeProperty("transform");
        else media.style.transform = "translate(" + values.x + "px, " + values.y + "px) scale(" + values.scale + ")";
      }
    }

    function loopRange(video) {
      const brown = video === walk;
      const origin = brown ? WALK_START_FRAME * FRAME_SECONDS : PINK_ORIGIN_SECONDS;
      const duration = (brown ? WALK_FRAME_COUNT : PINK_FRAME_COUNT) * FRAME_SECONDS;
      const startSource = brown ? WALK_ENTRY_SECONDS : PINK_ENTRY_SECONDS;
      const endSource = brown ? SCREEN_CUES[WALK_SCREEN - 1] : values.pinkEnd;
      const start = Math.max(0, Math.min(duration - FRAME_SECONDS,
        Math.floor(startSource / FRAME_SECONDS + 0.00001) * FRAME_SECONDS - origin));
      const end = Math.max(start + FRAME_SECONDS, Math.min(duration,
        Math.ceil(endSource / FRAME_SECONDS - 0.00001) * FRAME_SECONDS - origin));
      return { start, end, full: start < 0.00001 && Math.abs(end - duration) < 0.00001 };
    }

    function clampLoopTime(video, time) {
      const range = loopRange(video);
      return Math.max(range.start, Math.min(range.end - 0.0001, time));
    }

    function createLoopPlayback(video, isCurrent) {
      const range = loopRange(video);
      video.loop = range.full;
      if (range.full) return playUntilCue(video, null, isCurrent);
      let cancelled = false;
      let child = null;
      let resolveStarted;
      let rejectStarted;
      let rejectFinished;
      const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
      const finished = new Promise((_resolve, reject) => { rejectFinished = reject; });
      void started.catch(() => {});
      void finished.catch(() => {});
      const valid = () => !cancelled && isCurrent();
      const handle = {
        started, finished,
        customLoop: true,
        isAlive: () => !cancelled,
        cancel() {
          if (cancelled) return;
          cancelled = true;
          child?.cancel();
          video.pause();
          rejectStarted(abortError());
          rejectFinished(abortError());
          playbackHandles.delete(handle);
        }
      };
      playbackHandles.add(handle);
      void (async () => {
        let first = true;
        try {
          while (valid()) {
            if (!first) await seekAndHold(video, range.start, valid);
            requireCurrent(valid);
            child = playUntilCue(video, range.end - 0.0001, valid);
            await child.started;
            requireCurrent(valid);
            if (first) resolveStarted();
            await child.finished;
            requireCurrent(valid);
            first = false;
          }
        } catch (error) {
          if (!cancelled) {
            cancelled = true;
            child?.cancel();
            video.pause();
            rejectStarted(error);
            rejectFinished(error);
            playbackHandles.delete(handle);
          }
        }
      })();
      return handle;
    }

    function prepareSeekableSource(video) {
      if (!(video instanceof HTMLVideoElement) || !sources.has(video)) {
        return Promise.reject(new Error("The video source is unavailable"));
      }
      const existing = preparedSources.get(video);
      if (existing) return existing;
      const originalSource = sources.get(video);
      const preparation = (async () => {
        // Hosted assets may lack Range/Content-Length. A complete Blob has a
        // known length and makes every cue seekable without replacing the
        // main video's source during any scroll or walking transition.
        const response = await fetch(originalSource, {
          credentials: "same-origin",
          signal: AbortSignal.timeout(MEDIA_LOAD_WAIT_LIMIT_MS)
        });
        if (!response.ok) throw new Error("Video request failed: " + response.status);
        const blob = await response.blob();
        if (!blob.size) throw new Error("The video source is empty");
        const blobSource = URL.createObjectURL(blob);
        video.dataset.mediaSource = originalSource;
        video.preload = "auto";
        video.src = blobSource;
        video.load();
        video.playbackRate = values.speed;
        return blobSource;
      })();
      preparedSources.set(video, preparation);
      void preparation.catch(() => {
        // A failed background fetch may be retried when the helper is needed.
        if (preparedSources.get(video) === preparation) preparedSources.delete(video);
      });
      return preparation;
    }

    function prefetchHelpers() {
      [backward, walk, pinkWalk].forEach((video) => {
        if (video instanceof HTMLVideoElement) void prepareSeekableSource(video).catch(() => {});
      });
    }

    async function playIntro() {
      if (introFinished || introFailed || startingIntro) return;
      startingIntro = true;
      const thisOperation = ++operation;
      const isCurrent = () => operation === thisOperation;
      let playback = null;
      hidePlayButton();
      try {
        await prepareSeekableSource(intro);
        requireCurrent(isCurrent);
        // Helpers download after the main asset is complete and do not delay
        // intro playback. Preparation is deduplicated again on actual use.
        prefetchHelpers();
        playback = playUntilCue(intro, SCREEN_CUES[0], isCurrent, checkIntroTime);
        await playback.started;
        requireCurrent(isCurrent);
        setState(introRevealed ? "revealed" : "playing");
        announce("");
        await playback.finished;
        requireCurrent(isCurrent);
        // The first pause is a cue in the same long video, never a file end.
        introFinished = true;
        startingIntro = false;
        checkIntroTime(SCREEN_CUES[0]);
        setState("ended");
        hidePlayButton();
        if (pendingScreen !== null) void transitionTo(pendingScreen);
      } catch (error) {
        if (!isCurrent()) return;
        startingIntro = false;
        if (error?.name === "NotAllowedError") {
          setState("blocked");
          announce("Нажмите кнопку, чтобы воспроизвести видео.");
          offerPlayback(playIntro, "Play intro");
        } else if (error?.name !== "AbortError") {
          reportIntroError(error);
        }
      } finally {
        if (playback) playback.cancel();
      }
    }

    function waitForMedia(video, eventName, ready) {
      if (video.error) return Promise.reject(new Error("Media failed to load"));
      if (ready()) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          video.removeEventListener(eventName, onReady);
          video.removeEventListener("error", onError);
          pendingMediaWaits.delete(cancel);
        };
        const cancel = () => { cleanup(); reject(abortError()); };
        pendingMediaWaits.add(cancel);
        const onReady = () => { if (ready()) { cleanup(); resolve(); } };
        const onError = () => { cleanup(); reject(new Error("Media failed to load")); };
        video.addEventListener(eventName, onReady);
        video.addEventListener("error", onError, { once: true });
        const limit = eventName === "loadedmetadata" || eventName === "loadeddata"
          ? MEDIA_LOAD_WAIT_LIMIT_MS : MEDIA_WAIT_LIMIT_MS;
        timer = setTimeout(() => { cleanup(); reject(new Error("Media did not become ready")); }, limit);
      });
    }

    function afterRenderingTurns() {
      return new Promise((resolve, reject) => {
        let request = null;
        const timer = setTimeout(() => {
          if (request !== null) cancelAnimationFrame(request);
          reject(new Error("A rendered frame was not confirmed"));
        }, MEDIA_WAIT_LIMIT_MS);
        request = requestAnimationFrame(() => {
          request = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
        });
      });
    }

    function frameCoversCue(mediaTime, cue) {
      // 8.07 s belongs to the 8.0667 s frame at 60 fps.
      return Number.isFinite(mediaTime) && mediaTime <= cue + 0.00001 &&
        cue < mediaTime + FRAME_SECONDS - 0.00001;
    }

    async function seekAndHold(video, cue, isCurrent) {
      requireCurrent(isCurrent);
      video.pause();
      await waitForMedia(video, "loadedmetadata", () => video.readyState >= 1);
      requireCurrent(isCurrent);
      if (Number.isFinite(video.duration) && cue > video.duration) {
        throw new Error("The requested video cue is unavailable");
      }

      let frameRequest = null;
      let resolveFrame;
      const frameConfirmed = new Promise((resolve) => { resolveFrame = resolve; });
      const supportsFrames = typeof video.requestVideoFrameCallback === "function";
      const watchSeekFrame = () => {
        frameRequest = video.requestVideoFrameCallback((_now, metadata) => {
          frameRequest = null;
          if (!isCurrent()) return;
          presentedFrames.set(video, metadata.mediaTime);
          if (frameCoversCue(metadata.mediaTime, cue)) resolveFrame();
          else watchSeekFrame();
        });
      };

      // Arm before seeking: a paused seek can present its frame before seeked.
      if (supportsFrames) watchSeekFrame();
      try {
        requireCurrent(isCurrent);
        video.currentTime = cue;
        await waitForMedia(video, "seeked", () => !video.seeking && Math.abs(video.currentTime - cue) < 0.001);
        await waitForMedia(video, "loadeddata", () => video.readyState >= 2);
        requireCurrent(isCurrent);
        if (supportsFrames && frameCoversCue(presentedFrames.get(video), cue)) resolveFrame();
        // A same-frame seek, or a video behind the opaque return helper, may
        // produce no new rVFC. seeked confirms target data was decoded; allow
        // two rendering turns in that case instead of waiting indefinitely.
        const renderConfirmed = afterRenderingTurns();
        void renderConfirmed.catch(() => {});
        await Promise.race([frameConfirmed, renderConfirmed]);
        requireCurrent(isCurrent);
        if (video.error) throw new Error("Media failed while confirming its cue");
        video.pause();
        if (Math.abs(video.currentTime - cue) >= 0.001) throw new Error("Video cue moved while paused");
      } finally {
        if (frameRequest !== null && supportsFrames) video.cancelVideoFrameCallback(frameRequest);
      }
    }

    async function prepareReturn(screen, isCurrent, frozenWalk = null) {
      if (!(backward instanceof HTMLVideoElement)) throw new Error("The return video is unavailable");
      await prepareSeekableSource(backward);
      requireCurrent(isCurrent);
      if (screen === WALK_SCREEN) {
        if (!frozenWalk || !(walk instanceof HTMLVideoElement)) throw new Error("The walking pose is unavailable");
        // Quantize the paused clock to its covering frame so the helper starts
        // on exactly the pose still visible in the walking video.
        await seekAndHold(walk, frozenWalk.time, isCurrent);
      }
      const start = frozenWalk ? frozenWalk.reverseCue : RETURN_CUES[screen - 1];
      await seekAndHold(backward, start, isCurrent);
      requireCurrent(isCurrent);
    }

    function playUntilCue(video, cue, isCurrent, onMediaTime = () => {}) {
      const supportsFrames = typeof video.requestVideoFrameCallback === "function";
      let frameRequest = null;
      let animationRequest = null;
      let startupTimer = null;
      let stopping = false;
      let settled = false;
      let accepted = false;
      let hasFrame = false;
      let resolveStarted;
      let rejectStarted;
      let resolveFinished;
      let rejectFinished;
      const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
      const finished = new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
      // A rejected play() can reject both promises before the caller awaits them.
      void started.catch(() => {});
      void finished.catch(() => {});

      const cleanup = () => {
        clearTimeout(startupTimer);
        if (frameRequest !== null && supportsFrames) video.cancelVideoFrameCallback(frameRequest);
        if (animationRequest !== null) cancelAnimationFrame(animationRequest);
        frameRequest = null;
        animationRequest = null;
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        playbackHandles.delete(handle);
        stopping = true;
        cleanup();
        video.pause();
        rejectStarted(error);
        rejectFinished(error);
      };
      const confirmStarted = () => {
        if (accepted && hasFrame && !settled && isCurrent()) {
          clearTimeout(startupTimer);
          resolveStarted();
        }
      };
      const stop = () => {
        if (stopping || settled) return;
        // Drop all playback callbacks before corrective seek. Nothing from the
        // first cue can later pause or seek a resumed forward phase.
        stopping = true;
        cleanup();
        video.pause();
        const hold = cue === null ? Promise.resolve() : seekAndHold(video, cue, isCurrent);
        void hold.then(() => {
          if (settled) return;
          requireCurrent(isCurrent);
          settled = true;
          playbackHandles.delete(handle);
          resolveStarted();
          resolveFinished();
        }).catch(fail);
      };
      const observe = (mediaTime, isPresentedFrame) => {
        if (stopping || settled || !isCurrent()) return;
        if (isPresentedFrame) {
          presentedFrames.set(video, mediaTime);
          hasFrame = true;
          confirmStarted();
        }
        onMediaTime(mediaTime);
        if (cue !== null && ((isPresentedFrame && frameCoversCue(mediaTime, cue)) ||
            mediaTime >= cue - (isPresentedFrame ? HALF_FRAME_SECONDS : 0))) stop();
      };
      const watchFrame = () => {
        if (stopping || settled || !isCurrent()) return;
        frameRequest = video.requestVideoFrameCallback((_now, metadata) => {
          frameRequest = null;
          observe(metadata.mediaTime, true);
          watchFrame();
        });
      };
      const watchAnimationFrame = () => {
        if (stopping || settled || !isCurrent()) return;
        animationRequest = requestAnimationFrame(() => {
          animationRequest = null;
          if (video.readyState >= 2) observe(video.currentTime, true);
          watchAnimationFrame();
        });
      };
      const onTimeUpdate = () => {
        // Clock events are a backstop if a frame callback is delayed by the
        // compositor. The corrective paused seek still makes the hold exact.
        observe(video.currentTime, !supportsFrames);
      };
      const onEnded = () => {
        if (cue !== null && video.currentTime < cue - HALF_FRAME_SECONDS) {
          fail(new Error("The video ended before its requested cue"));
        } else stop();
      };
      const onError = () => fail(new Error("Media failed to load"));

      const handle = { started, finished, cancel() { if (!settled) fail(abortError()); } };
      playbackHandles.add(handle);
      void (async () => {
        try {
          requireCurrent(isCurrent);
          if (video.error) throw new Error("Media failed to load");
          video.addEventListener("timeupdate", onTimeUpdate);
          video.addEventListener("ended", onEnded, { once: true });
          video.addEventListener("error", onError, { once: true });
          startupTimer = setTimeout(() => fail(new Error("Media did not present its first frame")), MEDIA_LOAD_WAIT_LIMIT_MS);
          if (supportsFrames) watchFrame();
          else watchAnimationFrame();
          // Forward uses this exact call on the same element, source and
          // currentTime held at its screen cue. No reset or media handoff occurs.
          await video.play();
          requireCurrent(isCurrent);
          accepted = true;
          clearTimeout(startupTimer);
          if (!hasFrame) startupTimer = setTimeout(() => fail(new Error("Media did not present its first frame")), MEDIA_WAIT_LIMIT_MS);
          confirmStarted();
        } catch (error) {
          fail(error);
        }
      })();

      return handle;
    }

    async function exitPanel(panel) {
      if (!panel) return;
      cancelWalkTag(panel);
      setAccessible(panel, false);
      panel.classList.remove("is-exiting");
      void panel.offsetWidth;
      panel.classList.add("is-exiting");
      const typedExit = panel.matches(".screen-content") && panel.querySelector("[data-type-title]")
        ? Promise.resolve(titleAction("exit", panel)) : Promise.resolve();
      // Other body content flickers out while the heading erases backwards.
      // Tag-only/shared-caption exits never invoke the title engine.
      const cssExit = (async () => {
        const animations = typeof panel.getAnimations === "function"
          ? panel.getAnimations({ subtree: true }).filter((animation) => animation.playState !== "finished" &&
            animation.effect?.getTiming().iterations !== Infinity)
          : [];
        if (animations.length) {
          let timer;
          await Promise.race([
            Promise.allSettled(animations.map((animation) => animation.finished)),
            new Promise((resolve) => { timer = setTimeout(resolve, EXIT_WAIT_LIMIT_MS); })
          ]);
          clearTimeout(timer);
        }
      })();
      await Promise.all([cssExit, typedExit]);
    }

    function captureWalkingPose() {
      if (!(walk instanceof HTMLVideoElement)) return null;
      walk.pause();
      const frame = Math.max(0, Math.min(WALK_FRAME_COUNT - 1,
        Math.floor(walk.currentTime / FRAME_SECONDS + 0.00001)));
      return {
        frame,
        time: frame * FRAME_SECONDS,
        reverseCue: (WALK_END_FRAME - (WALK_START_FRAME + frame)) * FRAME_SECONDS
      };
    }

    function stopWalking() {
      const frozen = captureWalkingPose();
      const playback = walkingPlayback;
      walkingPlayback = null;
      ++walkingSession;
      if (playback) playback.cancel();
      return frozen;
    }

    function watchWalkingFailure(playback, session, isCurrent) {
      const report = (error) => {
        if (error?.name === "AbortError" || walkingPlayback !== playback ||
            walkingSession !== session || !isCurrent() || transitioning || currentScreen !== WALK_SCREEN) return;
        window.HermesPinkHint?.dismiss();
        const frozen = stopWalking();
        const tagRestore = walkTagSnapshot(panels[WALK_SCREEN - 1]);
        cancelWalkTag(panels[WALK_SCREEN - 1]);
        setState("error");
        document.documentElement.dataset.mediaFailure = error?.name + ": " + error?.message;
        announce("Не удалось продолжить видео. Нажмите кнопку, чтобы попробовать ещё раз.");
        offerPlayback(() => retryWalking(frozen, tagRestore), "Play walk");
      };
      void playback.finished.then(() => report(new Error("The walking loop stopped")), report);
    }

    async function startWalking(time, isCurrent) {
      if (!(walk instanceof HTMLVideoElement)) throw new Error("The walking video is unavailable");
      if (walkingPlayback) stopWalking();
      requireCurrent(isCurrent);
      await prepareSeekableSource(walk);
      requireCurrent(isCurrent);
      walk.loop = loopRange(walk).full;
      await seekAndHold(walk, clampLoopTime(walk, time), isCurrent);
      requireCurrent(isCurrent);
      const session = ++walkingSession;
      const playback = createLoopPlayback(walk, isCurrent);
      walkingPlayback = playback;
      watchWalkingFailure(playback, session, isCurrent);
      await playback.started;
      requireCurrent(isCurrent);
      await promote(walk);
      requireCurrent(isCurrent);
      return playback;
    }

    async function holdMainBehindWalking(playback, isCurrent) {
      // The opaque native loop owns the visible scene. Main stays ready at the
      // end of the walking section for the future character transition.
      await Promise.race([
        seekAndHold(intro, SCREEN_CUES[WALK_SCREEN - 1], isCurrent),
        playback.finished.then(() => { throw new Error("The walking loop stopped"); })
      ]);
      requireCurrent(isCurrent);
      if (walkingPlayback !== playback || walk.error ||
          (playback.customLoop ? !playback.isAlive() : walk.paused)) {
        throw new Error("The walking loop is not playing");
      }
    }

    async function retryWalking(frozen, tagRestore = null) {
      if (pinkSelected || transitioning || currentScreen !== WALK_SCREEN || !(walk instanceof HTMLVideoElement)) return;
      const thisOperation = ++operation;
      const isCurrent = () => operation === thisOperation;
      transitioning = true;
      hidePlayButton();
      try {
        if (walk.error) walk.load();
        const playback = await startWalking(frozen?.time ?? 0, isCurrent);
        await holdMainBehindWalking(playback, isCurrent);
        requireCurrent(isCurrent);
        delete document.documentElement.dataset.mediaFailure;
        if (tagRestore) scheduleWalkTag(panels[WALK_SCREEN - 1], { restore: tagRestore });
        setState(IDLE_STATES[WALK_SCREEN - 1]);
        transitioning = false;
      } catch (error) {
        if (!isCurrent()) return;
        stopWalking();
        cancelWalkTag(panels[WALK_SCREEN - 1]);
        transitioning = false;
        setState("error");
        announce("Не удалось продолжить видео. Нажмите кнопку, чтобы попробовать ещё раз.");
        offerPlayback(() => retryWalking(frozen, tagRestore), "Play walk");
      }
    }

    function stopPinkWalking() {
      if (!(pinkWalk instanceof HTMLVideoElement)) return pinkLoopResume;
      pinkWalk.pause();
      const frame = Math.max(0, Math.min(PINK_FRAME_COUNT - 1,
        Math.floor(pinkWalk.currentTime / FRAME_SECONDS + 0.00001)));
      const playback = pinkPlayback;
      pinkPlayback = null;
      ++pinkSession;
      if (playback) playback.cancel();
      return frame * FRAME_SECONDS;
    }

    function showPinkContent() {
      if (pinkContentShown) return;
      const previous = panels[WALK_SCREEN - 1];
      const incoming = panels[PINK_SCREEN - 1];
      if (!incoming) throw new Error("The Pink screen is unavailable");
      titleAction("transfer", previous, incoming);
      resetPanel(previous, true);
      incoming.classList.add("is-colour-entry");
      incoming.querySelectorAll("[data-color-tag]").forEach((tag) => setAccessible(tag, false));
      setScreen(PINK_SCREEN);
      // Shared content stays solid; the new tag waits for the click deadline.
      showPanel(incoming, true, { immediate: true });
      pinkContentShown = true;
    }

    function revealPinkTag() {
      const panel = panels[PINK_SCREEN - 1];
      if (!pinkSelected || currentScreen !== PINK_SCREEN || !panel || panel.hidden ||
          !panel.classList.contains("is-revealed")) return;
      panel.classList.add("is-pink-tag-revealed");
      panel.querySelectorAll("[data-color-tag]").forEach((tag) => setAccessible(tag, true));
    }

    function schedulePinkTag() {
      if (!Number.isFinite(pinkTagDeadline)) return;
      clearTimeout(pinkTagTimer);
      const session = ++pinkTagSession;
      const revealWhenDue = () => {
        if (session !== pinkTagSession || !pinkSelected) return;
        const remaining = pinkTagDeadline - performance.now();
        if (remaining > 0) {
          pinkTagTimer = setTimeout(revealWhenDue, Math.ceil(remaining));
          return;
        }
        pinkTagTimer = null;
        revealPinkTag();
      };
      pinkTagTimer = setTimeout(revealWhenDue, Math.ceil(Math.max(0, pinkTagDeadline - performance.now())));
    }

    function reportPinkError(error) {
      // Pink is a one-way selection. A failure freezes a valid scene on screen
      // six and offers a retry; it cannot restore Brown or enable navigation.
      ++operation;
      intro.pause();
      if (!pinkCameraFinished && Number.isFinite(intro.currentTime)) {
        pinkCameraResume = Math.max(SCREEN_CUES[WALK_SCREEN - 1],
          Math.min(PINK_ENTRY_SECONDS, intro.currentTime));
      }
      if (pinkPlayback) pinkLoopResume = stopPinkWalking();
      else stopPinkWalking();
      showPinkContent();
      transitioning = false;
      setState("error");
      document.documentElement.dataset.mediaFailure = error?.name + ": " + error?.message;
      announce("Не удалось продолжить видео Pink. Нажмите кнопку, чтобы попробовать ещё раз.");
      offerPlayback(retryPink, "Play Pink");
    }

    function watchPinkFailure(playback, session, isCurrent) {
      const report = (error) => {
        if (error?.name === "AbortError" || pinkPlayback !== playback ||
            pinkSession !== session || !isCurrent() || transitioning || currentScreen !== PINK_SCREEN) return;
        reportPinkError(error);
      };
      void playback.finished.then(() => report(new Error("The Pink loop stopped")), report);
    }

    async function startPinkWalking(time, isCurrent) {
      if (!(pinkWalk instanceof HTMLVideoElement)) throw new Error("The Pink walking video is unavailable");
      if (pinkPlayback) stopPinkWalking();
      await prepareSeekableSource(pinkWalk);
      requireCurrent(isCurrent);
      if (pinkWalk.error) pinkWalk.load();
      pinkWalk.loop = loopRange(pinkWalk).full;
      await seekAndHold(pinkWalk, clampLoopTime(pinkWalk, time), isCurrent);
      requireCurrent(isCurrent);
      const session = ++pinkSession;
      const playback = createLoopPlayback(pinkWalk, isCurrent);
      pinkPlayback = playback;
      watchPinkFailure(playback, session, isCurrent);
      await playback.started;
      requireCurrent(isCurrent);
      await promote(pinkWalk);
      requireCurrent(isCurrent);
      return playback;
    }

    async function holdMainBehindPink(playback, isCurrent) {
      await Promise.race([
        seekAndHold(intro, SCREEN_CUES[PINK_SCREEN - 1], isCurrent),
        playback.finished.then(() => { throw new Error("The Pink loop stopped"); })
      ]);
      requireCurrent(isCurrent);
      if (pinkPlayback !== playback || pinkWalk.error ||
          (playback.customLoop ? !playback.isAlive() : pinkWalk.paused)) {
        throw new Error("The Pink loop is not playing");
      }
    }

    async function playPinkSequence(isCurrent) {
      let cameraPlayback = null;
      try {
        if (!pinkCameraFinished) {
          await prepareSeekableSource(intro);
          requireCurrent(isCurrent);
          // Main already owns this stable Blob source, held at 23.20 s behind
          // Brown. Resume immediately after the decoded-frame handoff.
          await seekAndHold(intro, pinkCameraResume, isCurrent);
          await promote(intro);
          requireCurrent(isCurrent);
          cameraPlayback = playUntilCue(intro, PINK_ENTRY_SECONDS, isCurrent);
          await cameraPlayback.started;
          requireCurrent(isCurrent);
          await cameraPlayback.finished;
          requireCurrent(isCurrent);
          pinkCameraFinished = true;
          pinkCameraResume = PINK_ENTRY_SECONDS;
        }
        showPinkContent();
        const loopPlayback = await startPinkWalking(pinkLoopResume, isCurrent);
        await holdMainBehindPink(loopPlayback, isCurrent);
        requireCurrent(isCurrent);
        delete document.documentElement.dataset.mediaFailure;
        setState(IDLE_STATES[PINK_SCREEN - 1]);
        transitioning = false;
        hidePlayButton();
      } finally {
        if (cameraPlayback) cameraPlayback.cancel();
      }
    }

    async function selectPink() {
      if (transportMode !== "flow" || pinkSelected || pinkHintSelectionPending || transitioning || currentScreen !== WALK_SCREEN ||
          !(pinkWalk instanceof HTMLVideoElement) || !panels[PINK_SCREEN - 1]) return;
      const selectedAt = performance.now();
      if (window.HermesPinkHint?.isVisible()) {
        const selectionOperation = operation;
        pinkHintSelectionPending = true;
        cancelWalkTag(panels[WALK_SCREEN - 1]);
        try { await window.HermesPinkHint.hide(); }
        finally { pinkHintSelectionPending = false; }
        if (operation !== selectionOperation || transportMode !== "flow" || pinkSelected ||
            transitioning || currentScreen !== WALK_SCREEN) return;
      }
      // Lock the terminal choice before cancelling the native Brown session.
      // No native loop boundary is awaited.
      pinkSelected = true;
      pinkTagDeadline = selectedAt + PINK_TAG_DELAY_MS;
      cancelWalkTag(panels[WALK_SCREEN - 1]);
      const colourGroup = panels[WALK_SCREEN - 1]?.querySelector(".fifth-colors");
      const pinkButton = colourGroup?.querySelector("#select-pink, [data-color='pink']");
      if (pinkButton) {
        pinkButton.disabled = true;
        pinkButton.setAttribute("aria-pressed", "true");
        colourGroup.querySelectorAll(".fifth-color").forEach((chip) => {
          chip.classList.toggle("fifth-color-selected", chip === pinkButton);
        });
      }
      if (colourGroup) colourGroup.setAttribute("aria-label", "Helmet colours: Pink selected");
      const thisOperation = ++operation;
      const isCurrent = () => operation === thisOperation;
      transitioning = true;
      pendingScreen = null;
      stopWalking();
      hidePlayButton();
      setState("transitioning-forward");
      // Hide Brown's tag in this click, before any media preparation awaits.
      showPinkContent();
      schedulePinkTag();
      try {
        await playPinkSequence(isCurrent);
      } catch (error) {
        if (isCurrent()) reportPinkError(error);
      }
    }

    async function retryPink() {
      if (!pinkSelected || transitioning) return;
      const thisOperation = ++operation;
      const isCurrent = () => operation === thisOperation;
      transitioning = true;
      hidePlayButton();
      setState("transitioning-forward");
      try {
        await playPinkSequence(isCurrent);
      } catch (error) {
        if (isCurrent()) reportPinkError(error);
      }
    }

    function handlePinkClick(event) {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest("#select-pink, [data-color='pink']");
      if (!button || !panels[WALK_SCREEN - 1]?.contains(button)) return;
      event.preventDefault();
      void selectPink();
    }

    async function transitionTo(screen) {
      if (transportMode !== "flow" || pinkSelected || pinkHintSelectionPending || !Number.isInteger(screen) || screen < 1 || screen > NAVIGABLE_SCREEN_COUNT ||
          transitioning || screen === currentScreen || !introFinished || !introRevealed || introFailed) return;
      const outgoing = panels[currentScreen - 1];
      const incoming = panels[screen - 1];
      const movingForward = screen > currentScreen;
      if (!outgoing || !incoming || (!movingForward && !(backward instanceof HTMLVideoElement)) ||
          (screen === WALK_SCREEN && !(walk instanceof HTMLVideoElement))) {
        announce("Не удалось загрузить следующий экран.");
        return;
      }

      const thisOperation = ++operation;
      const isCurrent = () => operation === thisOperation;
      const sourceScreen = currentScreen;
      if (sourceScreen === WALK_SCREEN) window.HermesPinkHint?.dismiss();
      const sourceCue = SCREEN_CUES[sourceScreen - 1];
      const sourceWalkTag = walkTagSnapshot(outgoing);
      cancelWalkTag(outgoing);
      const incomingHasAngleTags = isAngleScreen(screen);
      const phaseCue = movingForward
        ? (screen === WALK_SCREEN ? WALK_ENTRY_SECONDS : SCREEN_CUES[screen - 1])
        : RETURN_CUES[screen - 1];
      let latestPhaseTime = -Infinity;
      const observeAngleTags = (mediaTime = latestPhaseTime) => {
        if (!incomingHasAngleTags || !isCurrent()) return;
        if (Number.isFinite(mediaTime)) latestPhaseTime = Math.max(latestPhaseTime, mediaTime);
        // The observer is called before playUntilCue stops. If the last-second
        // threshold precedes body mounting, mounting checks the stored time.
        if (latestPhaseTime >= phaseCue - 1) revealAngleTags(incoming);
      };
      const frozenWalk = sourceScreen === WALK_SCREEN ? stopWalking() : null;
      let playback = null;
      let cancelFirstCueSmoothing = null;
      transitioning = true;
      pendingScreen = null;
      hidePlayButton();
      setState(movingForward ? "transitioning-forward" : "transitioning-backward");
      try {
        if (!movingForward) await prepareReturn(sourceScreen, isCurrent, frozenWalk);
        requireCurrent(isCurrent);
        if (movingForward && sourceScreen === 1) {
          cancelFirstCueSmoothing = window.HermesFirstCueSmoothing?.begin(intro, isCurrent);
        }
        playback = playUntilCue(movingForward ? intro : backward,
          phaseCue, isCurrent, observeAngleTags);
        await playback.started;
        requireCurrent(isCurrent);
        announce("");

        let restoreMain = Promise.resolve();
        if (!movingForward) {
          restoreMain = promote(backward).then(() => SCREEN_CUES[screen - 1] < 5
            ? Promise.resolve() : seekAndHold(intro, SCREEN_CUES[screen - 1], isCurrent));
        }
        const captionExit = isAngleScreen(sourceScreen) && !incomingHasAngleTags
          ? exitFeatureCaption(isCurrent) : Promise.resolve();
        const changeContent = (async () => {
          await Promise.all([exitPanel(outgoing), captionExit]);
          requireCurrent(isCurrent);
          resetPanel(outgoing, true);
          setScreen(screen);
          showPanel(incoming, true);
          if (incomingHasAngleTags) showFeatureCaption();
          observeAngleTags();
        })();
        const phaseFinished = playback.finished.then(() => {
          requireCurrent(isCurrent);
          // A very short or delayed phase can finish before incoming mounts.
          // Record the cue so mounting still reveals both tags exactly once.
          observeAngleTags(phaseCue);
        });

        await Promise.all([phaseFinished, changeContent, restoreMain]);
        requireCurrent(isCurrent);
        if (movingForward && screen === WALK_SCREEN) {
          // Camera movement finishes at 19.16 s. Walking begins once, then the
          // browser loops the silent helper without replaying content animation.
          const loopPlayback = await startWalking(0, isCurrent);
          await holdMainBehindWalking(loopPlayback, isCurrent);
        } else if (!movingForward) {
          if (SCREEN_CUES[screen - 1] < 5) await seekAndHold(intro, SCREEN_CUES[screen - 1], isCurrent);
          await promote(intro);
        }
        requireCurrent(isCurrent);
        setState(IDLE_STATES[screen - 1]);
        transitioning = false;
        hidePlayButton();
      } catch (error) {
        if (!isCurrent()) return;
        // Invalidate every old playback, seek and content continuation first.
        ++operation;
        if (cancelFirstCueSmoothing) cancelFirstCueSmoothing();
        if (playback) playback.cancel();
        const recoveryOperation = operation;
        const recoveryCurrent = () => operation === recoveryOperation;
        intro.pause();
        if (backward) backward.pause();
        stopWalking();
        resetPanel(incoming, true);
        setScreen(sourceScreen);
        showPanel(outgoing, true, { immediate: true, walkTagRestore: sourceWalkTag });
        restoreFeatureContent(sourceScreen);
        let recovered = true;
        try {
          if (sourceScreen === WALK_SCREEN) {
            const loopPlayback = await startWalking(frozenWalk?.time ?? 0, recoveryCurrent);
            await holdMainBehindWalking(loopPlayback, recoveryCurrent);
          } else {
            await seekAndHold(intro, sourceCue, recoveryCurrent);
            await promote(intro);
          }
        } catch {
          recovered = false;
          // Retain a valid frozen walking/reverse frame if recovery cannot play.
        }
        if (!recoveryCurrent()) return;
        transitioning = false;
        setState(recovered ? IDLE_STATES[sourceScreen - 1] : "error");
        if (!recovered && sourceScreen === WALK_SCREEN) {
          cancelWalkTag(outgoing);
          announce("Не удалось продолжить видео. Нажмите кнопку, чтобы попробовать ещё раз.");
          offerPlayback(() => retryWalking(frozenWalk, sourceWalkTag), "Play walk");
        } else if (error?.name === "NotAllowedError") {
          announce("Нажмите кнопку, чтобы воспроизвести переход.");
          offerPlayback(() => transitionTo(screen), "Play transition");
        } else {
          hidePlayButton();
          announce("Не удалось воспроизвести переход. Попробуйте прокрутить ещё раз.");
        }
      } finally {
        if (cancelFirstCueSmoothing) cancelFirstCueSmoothing();
        if (playback) playback.cancel();
      }
    }

    function requestScreen(screen) {
      if (controlBusy || pinkHintSelectionPending || transportMode !== "flow" || pinkSelected || currentScreen === PINK_SCREEN || transitioning || !introRevealed || introFailed) return;
      const target = Math.max(1, Math.min(NAVIGABLE_SCREEN_COUNT, screen));
      if (!introFinished) {
        if (target > 1) pendingScreen = target;
        return;
      }
      void transitionTo(target);
    }

    function requestDirection(direction) {
      if (pinkSelected || pinkHintSelectionPending || currentScreen === PINK_SCREEN) return;
      // Pink is reachable only through its colour selector, never scrolling.
      if (currentScreen === WALK_SCREEN && direction > 0) {
        if (!controlBusy && !transitioning && transportMode === "flow" && walkingPlayback && activeVideo === walk && !walk.paused) {
          window.HermesPinkHint?.showOnce();
        }
        return;
      }
      requestScreen(currentScreen + Math.sign(direction));
    }

    function isControlTarget(target) {
      return target instanceof Element && Boolean(target.closest(
        "#hermes-video-settings, .hv-launcher, input, textarea, select, button, [contenteditable]:not([contenteditable='false'])"
      ));
    }

    function handleWheel(event) {
      if (controlBusy || transportMode !== "flow" || event.ctrlKey || isControlTarget(event.target)) return;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
      const delta = event.deltaY * factor;
      if (!Number.isFinite(delta) || !delta || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelAt > GESTURE_PAUSE_MS) {
        wheelAmount = 0;
        consumedWheelBurst = false;
      }
      lastWheelAt = now;
      if (transitioning) {
        // Consume this entire inertial burst, including its tail after playback.
        consumedWheelBurst = true;
        wheelAmount = 0;
        return;
      }
      if (consumedWheelBurst) return;
      if (wheelAmount && Math.sign(wheelAmount) !== Math.sign(delta)) wheelAmount = 0;
      wheelAmount += delta;
      if (Math.abs(wheelAmount) >= WHEEL_THRESHOLD) {
        consumedWheelBurst = true;
        requestDirection(Math.sign(wheelAmount));
        wheelAmount = 0;
      }
    }

    function handleKey(event) {
      if (controlBusy || transportMode !== "flow" || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
          isControlTarget(event.target)) return;
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        requestScreen(event.key === "Home" ? 1 : NAVIGABLE_SCREEN_COUNT);
        return;
      }
      const down = ["ArrowDown", "PageDown"].includes(event.key) || (event.key === " " && !event.shiftKey);
      const up = ["ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey);
      if (!down && !up) return;
      event.preventDefault();
      requestDirection(down ? 1 : -1);
    }

    const previewStyles = new Map();

    function clearPreviewStyles() {
      for (const [element, properties] of previewStyles) {
        for (const [key, previous] of Object.entries(properties)) {
          if (previous) element.style.setProperty(key, previous);
          else element.style.removeProperty(key);
        }
      }
      previewStyles.clear();
    }

    function freezePreviewStyles(panel) {
      [header, featureCaption, panel].filter(Boolean).forEach((element) => {
        const targets = element.matches("[data-reveal]") ? [element] : [...element.querySelectorAll("[data-reveal]")];
        targets.forEach((target) => {
          if (!previewStyles.has(target)) previewStyles.set(target, {
            animation: target.style.getPropertyValue("animation"),
            opacity: target.style.getPropertyValue("opacity"),
            visibility: target.style.getPropertyValue("visibility")
          });
          target.style.animation = "none";
          target.style.opacity = "1";
          target.style.visibility = "visible";
        });
      });
    }

    function absoluteTime() {
      const local = Number.isFinite(activeVideo?.currentTime) ? activeVideo.currentTime : 0;
      if (activeVideo === walk) return WALK_START_FRAME * FRAME_SECONDS + local;
      if (activeVideo === pinkWalk) return local >= PINK_FRAME_COUNT * FRAME_SECONDS - 0.001
        ? TIMELINE_END_SECONDS : PINK_ORIGIN_SECONDS + local;
      if (activeVideo === backward) return WALK_END_FRAME * FRAME_SECONDS - local;
      return local;
    }

    function controlsSnapshot() {
      const loop = activeVideo === walk ? walkingPlayback : activeVideo === pinkWalk ? pinkPlayback : null;
      const playing = (transportMode === "preview" && manualPlaybackActive) || (loop?.customLoop && loop.isAlive());
      return {
        screen: currentScreen, time: Math.max(0, Math.min(TIMELINE_END_SECONDS, absoluteTime())),
        duration: TIMELINE_END_SECONDS, paused: !playing && (!activeVideo || activeVideo.paused),
        mode: transportMode, busy: controlBusy || pinkHintSelectionPending || transitioning || startingIntro
      };
    }

    function cancelRuntime() {
      manualPlaybackActive = false;
      ++operation;
      pendingScreen = null;
      startingIntro = false;
      transitioning = false;
      stopWalking();
      stopPinkWalking();
      [...playbackHandles].forEach((handle) => handle.cancel());
      [...pendingMediaWaits].forEach((cancel) => cancel());
      videos.forEach((video) => video.pause());
      clearPreviewStyles();
      panels.forEach((panel) => resetPanel(panel, true));
      resetFeatureCaption();
    }

    function screenAt(time) {
      for (let index = 0; index < SCREEN_CUES.length - 1; index++) {
        if (time <= SCREEN_CUES[index] + 0.00001) return index + 1;
      }
      return PINK_SCREEN;
    }

    function showPreview(screen) {
      clearPreviewStyles();
      panels.forEach((panel) => resetPanel(panel, true));
      resetFeatureCaption();
      setScreen(screen);
      pinkSelected = screen === PINK_SCREEN;
      pinkContentShown = pinkSelected;
      if (pinkSelected) panels[screen - 1].classList.add("is-colour-entry");
      showPanel(panels[screen - 1], true, { immediate: true });
      revealHeader();
      restoreFeatureContent(screen);
      if (screen === WALK_SCREEN) {
        cancelWalkTag(panels[screen - 1]);
        revealWalkTag(panels[screen - 1]);
      }
      if (screen === PINK_SCREEN) revealPinkTag();
      freezePreviewStyles(panels[screen - 1]);
      setState("preview");
      introFinished = true;
      introRevealed = true;
      introFailed = false;
      hidePlayButton();
      announce("");
    }

    function timelineMedia(time) {
      if (!Number.isFinite(time) || time < 0 || time > TIMELINE_END_SECONDS) {
        throw new RangeError("Таймкод должен быть от 0 до " + TIMELINE_END_SECONDS + " с.");
      }
      return time <= FLOW_DEFAULTS.pinkEntry
        ? { video: intro, local: time }
        : { video: pinkWalk, local: Math.max(0, Math.min(PINK_FRAME_COUNT * FRAME_SECONDS - 0.0001, time - PINK_ORIGIN_SECONDS)) };
    }

    async function seekTimeline(time, valid, screen = screenAt(time)) {
      const { video, local } = timelineMedia(time);
      if (!(video instanceof HTMLVideoElement)) throw new Error("Нужное видео недоступно.");
      await prepareSeekableSource(video);
      requireCurrent(valid);
      video.loop = false;
      await seekAndHold(video, local, valid);
      requireCurrent(valid);
      await promote(video);
      requireCurrent(valid);
      showPreview(screen);
    }

    function controlAction(action) {
      const epoch = ++controlEpoch;
      const captured = { screen: currentScreen, time: absoluteTime(), video: activeVideo };
      controlBusy = true;
      transportMode = "preview";
      cancelRuntime();
      const valid = () => controlEpoch === epoch;
      return Promise.resolve().then(() => action(valid, captured)).catch((error) => {
        if (!valid() || error?.name === "AbortError") return controlsSnapshot();
        throw error;
      }).finally(() => {
        if (valid()) controlBusy = false;
      }).then(() => controlsSnapshot());
    }

    function resetPinkChoice() {
      pinkSelected = false;
      pinkContentShown = false;
      pinkCameraFinished = false;
      pinkCameraResume = SCREEN_CUES[WALK_SCREEN - 1];
      pinkLoopResume = 0;
      pinkTagDeadline = null;
      const group = panels[WALK_SCREEN - 1]?.querySelector(".fifth-colors");
      const button = group?.querySelector("#select-pink");
      if (button) { button.disabled = false; button.setAttribute("aria-pressed", "false"); }
      group?.querySelectorAll(".fifth-color").forEach((chip, index) => chip.classList.toggle("fifth-color-selected", index === 0));
      group?.setAttribute("aria-label", "Helmet colours: Black selected, Pink, White, Yellow");
    }

    async function playTimeline(valid, captured) {
      const time = Math.max(0, Math.min(TIMELINE_END_SECONDS, captured.time));
      await seekTimeline(time, valid, screenAt(time));
      const observer = (local) => {
        if (!valid()) return;
        const absolute = activeVideo === pinkWalk ? PINK_ORIGIN_SECONDS + local : local;
        const screen = screenAt(absolute);
        if (screen !== currentScreen) showPreview(screen);
      };
      requireCurrent(valid);
      if (time >= TIMELINE_END_SECONDS - 0.001) return controlsSnapshot();
      const target = PINK_FRAME_COUNT * FRAME_SECONDS - 0.0001;
      const mainPhase = time < FLOW_DEFAULTS.pinkEntry - 0.00001;
      // An exact 32.12 s seek still selects main. Prepare the helper before
      // playing it, just as the ordinary main-to-Pink handoff does.
      if (!mainPhase && activeVideo !== pinkWalk) {
        await seekTimeline(Math.max(time, FLOW_DEFAULTS.pinkEntry + 0.00001), valid, PINK_SCREEN);
      }
      requireCurrent(valid);
      if (mainPhase && time < 5.2) window.HermesFirstCueSmoothing?.begin(intro, valid);
      const playback = playUntilCue(mainPhase ? intro : pinkWalk,
        mainPhase ? FLOW_DEFAULTS.pinkEntry : target, valid, observer);
      await playback.started;
      requireCurrent(valid);
      manualPlaybackActive = true;
      // Resolve the transport command once playback starts so Pause remains
      // available. The epoch and registered handles still own the long job.
      void (async () => {
        await playback.finished;
        requireCurrent(valid);
        if (mainPhase) {
          await seekTimeline(FLOW_DEFAULTS.pinkEntry + 0.00001, valid, PINK_SCREEN);
          requireCurrent(valid);
          const pink = playUntilCue(pinkWalk, target, valid, observer);
          await pink.started;
          await pink.finished;
          requireCurrent(valid);
        }
        manualPlaybackActive = false;
      })().catch((error) => {
        if (!valid() || error?.name === "AbortError") return;
        manualPlaybackActive = false;
        videos.forEach((video) => video.pause());
        announce(error?.message || "Не удалось продолжить видео.");
      });
      return controlsSnapshot();
    }

    async function resumeAtStop(screen, valid) {
      clearPreviewStyles();
      resetPinkChoice();
      transportMode = "flow";
      const flowEpoch = ++operation;
      const flowValid = () => valid() && operation === flowEpoch;
      await prepareSeekableSource(intro);
      requireCurrent(flowValid);
      await seekAndHold(intro, SCREEN_CUES[screen - 1], flowValid);
      await promote(intro);
      requireCurrent(flowValid);
      panels.forEach((panel) => resetPanel(panel, true));
      setScreen(screen);
      if (screen === PINK_SCREEN) {
        pinkSelected = true;
        pinkContentShown = true;
        pinkCameraFinished = true;
        panels[screen - 1].classList.add("is-colour-entry");
      }
      showPanel(panels[screen - 1], true, { immediate: true });
      restoreFeatureContent(screen);
      revealHeader();
      introFinished = true;
      introRevealed = true;
      introFailed = false;
      if (screen === WALK_SCREEN) {
        const loop = await startWalking(loopRange(walk).start, flowValid);
        await holdMainBehindWalking(loop, flowValid);
      } else if (screen === PINK_SCREEN) {
        const loop = await startPinkWalking(loopRange(pinkWalk).start, flowValid);
        await holdMainBehindPink(loop, flowValid);
        revealPinkTag();
      }
      requireCurrent(flowValid);
      setState(IDLE_STATES[screen - 1]);
    }

    const controls = {
      snapshot: controlsSnapshot,
      seek(time) { return controlAction(async (valid) => { await seekTimeline(Number(time), valid); return controlsSnapshot(); }); },
      stop(screen) {
        const target = Number(screen);
        if (!Number.isInteger(target) || target < 1 || target > SCREEN_CUES.length) return Promise.reject(new RangeError("Неизвестный экран."));
        return controlAction(async (valid) => { await seekTimeline(SCREEN_CUES[target - 1], valid, target); return controlsSnapshot(); });
      },
      stepFrames(delta) { return controls.seek(Math.max(0, Math.min(TIMELINE_END_SECONDS, absoluteTime() + Number(delta) * FRAME_SECONDS))); },
      pause() { return controlAction(async (valid, captured) => { requireCurrent(valid); activeVideo = captured.video; showPreview(captured.screen); return controlsSnapshot(); }); },
      play() { return controlAction(playTimeline); },
      transition(direction = 1) {
        // The terminal Pink screen has no reverse asset. Editor seeking and
        // restarting remain available without promising a reverse transition.
        if (currentScreen === PINK_SCREEN) return Promise.resolve(controlsSnapshot());
        return controlAction(async (valid, captured) => {
          await resumeAtStop(captured.screen, valid);
          requireCurrent(valid);
          if (captured.screen === WALK_SCREEN && Number(direction) > 0) await selectPink();
          else {
            await transitionTo(Math.max(1, Math.min(NAVIGABLE_SCREEN_COUNT, captured.screen + Math.sign(Number(direction)))));
          }
          return controlsSnapshot();
        });
      },
      restart() {
        return controlAction(async (valid) => {
          resetPinkChoice();
          transportMode = "flow";
          await prepareSeekableSource(intro);
          requireCurrent(valid);
          await seekAndHold(intro, 0, valid);
          await promote(intro);
          requireCurrent(valid);
          panels.forEach((panel, index) => resetPanel(panel, index > 0));
          if (header) { header.classList.remove("is-revealed"); setAccessible(header, false); }
          setScreen(1);
          introFinished = false;
          introRevealed = false;
          introFailed = false;
          startingIntro = false;
          setState("loading");
          void playIntro();
          return controlsSnapshot();
        });
      }
    };
    window.HermesVideoControls = Object.freeze(controls);
    syncSettings(values);
    settings?.subscribe?.((event) => {
      if (event.changedKey === "locks" || event.changedKey === "saved") return;
      syncSettings(event.values);
      if (["x", "y", "scale", "speed", "smoothing", "smoothingStrength"].includes(event.changedKey)) return;
      void controls.stop(currentScreen).catch((error) => announce(error.message));
    });

    panels.forEach((panel) => titleAction("prepare", panel));
    panels.forEach((panel, index) => resetPanel(panel, index > 0));
    resetFeatureCaption();
    if (header) {
      header.classList.remove("is-revealed", "is-exiting");
      setAccessible(header, false);
    }
    setScreen(1);
    hidePlayButton();
    const restartButton = document.getElementById("restart-flow");
    if (restartButton) restartButton.addEventListener("click", () => window.location.reload());
    videos.forEach((video) => {
      video.loop = video === walk || video === pinkWalk;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.autoplay = false;
      video.preload = "none";
      video.pause();
      video.dataset.mediaSource = sources.get(video);
      video.removeAttribute("src");
      video.querySelectorAll("source").forEach((source) => source.removeAttribute("src"));
      video.load();
    });

    if (reviewScreen !== null) {
      // Explicit review routes never fetch, load or play any of the four videos.
      const selected = panels[reviewScreen - 1] ? reviewScreen : 1;
      panels.forEach((panel) => resetPanel(panel, true));
      revealHeader();
      introRevealed = true;
      introFinished = true;
      intro.poster = "assets/screen-" + selected + "-poster.png";
      void promote(intro);
      setScreen(selected);
      if (selected === PINK_SCREEN) {
        pinkSelected = true;
        panels[selected - 1].classList.add("is-colour-entry");
      }
      showPanel(panels[selected - 1], selected !== 1, { immediate: true });
      if (selected === PINK_SCREEN) revealPinkTag();
      restoreFeatureContent(selected);
      setState("review");
      announce("Статичный предпросмотр экрана " + selected + ".");
      window.dispatchEvent(new Event("hermes-controls-ready"));
      return;
    }

    promote(intro);
    setState("loading");
    announce("Видео первого экрана загружается.");
    // Each phase owns its media listeners; no persistent ended handler can
    // confuse the first cue with the end of the continuous source.

    if (playButton) playButton.addEventListener("click", () => {
      const action = buttonAction;
      if (action) void action();
    });
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKey);
    document.addEventListener("click", handlePinkClick);
    void playIntro();
    window.dispatchEvent(new Event("hermes-controls-ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeIntro, { once: true });
  } else {
    initializeIntro();
  }
})();
