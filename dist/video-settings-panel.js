(() => {
  "use strict";

  const FPS = 60;
  const DEFAULT_DURATION = 37.02;
  const groupNames = { timing: "Таймкоды", cues: "Таймкоды", video: "Видео", playback: "Воспроизведение",
    camera: "Положение видео", geometry: "Положение видео", smoothing: "Сглаживание" };
  const lockIcon = (locked) => `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/>` +
    (locked ? '<path d="M8 10V6a4 4 0 0 1 8 0v4"/>' : '<path d="M8 10V6a4 4 0 0 1 8 0"/>') + '</svg>';
  const timecode = (seconds) => {
    const value = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(value / 60);
    return `${String(minutes).padStart(2, "0")}:${(value % 60).toFixed(2).padStart(5, "0")} · кадр ${Math.round(value * FPS)}`;
  };
  const pretty = (value) => Number.isFinite(Number(value)) ? String(Number(Number(value).toFixed(6))) : "";

  function initialize() {
    if (document.getElementById("hermes-video-settings")) return;
    const panel = document.createElement("aside");
    panel.id = "hermes-video-settings";
    panel.className = "hv-settings";
    panel.setAttribute("aria-label", "Настройки видео Hermes");
    panel.innerHTML = `
      <header class="hv-header"><div><strong>Настройки видео</strong><span class="hv-badge">Загрузка…</span></div>
        <button class="hv-collapse" type="button" aria-label="Свернуть настройки видео" aria-expanded="true" aria-controls="hermes-settings-body">−</button></header>
      <div class="hv-body" id="hermes-settings-body">
        <div class="hv-presets" role="group" aria-label="Пресеты"><span>Пресет</span>
          <button type="button" data-preset="0" aria-pressed="false">0</button><button type="button" data-preset="1" aria-pressed="false">1</button><button type="button" data-preset="2" aria-pressed="false">2</button></div>
        <div class="hv-preset-actions"><button type="button" data-action="save">Сохранить</button><button type="button" data-action="reset">Сбросить незаблокированное из 0</button></div>
        <section class="hv-transport" aria-label="Управление видео"><div class="hv-section-title">Видео <span class="hv-mode">Подключение…</span></div>
          <output class="hv-time" aria-label="Текущий таймкод">00:00.00 · кадр 0</output>
          <p class="hv-mode">Таймкоды — в секундах. Шаг кадра — 1/60 с.</p>
          <input class="hv-timeline" type="range" min="0" max="37.02" step="0.016666666666666666" value="0" aria-label="Таймлайн видео" disabled>
          <div class="hv-playback-buttons"><button type="button" data-control="previous" aria-label="Предыдущий кадр">−1 кадр</button><button type="button" data-control="play">Воспроизвести</button><button type="button" data-control="next" aria-label="Следующий кадр">+1 кадр</button></div>
          <div class="hv-flow-buttons"><button type="button" data-control="transition">Проверить переход</button><button type="button" data-control="restart">В начало</button></div>
        </section>
        <div class="hv-fields"></div>
        <p class="hv-status" role="status" aria-live="polite" aria-atomic="true">Пресет 0 — исходные настройки.</p>
      </div>`;
    const launcher = document.createElement("button");
    launcher.className = "hv-launcher";
    launcher.type = "button";
    launcher.textContent = "Настройки видео";
    launcher.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", panel.id);
    document.body.append(panel, launcher);

    const badge = panel.querySelector(".hv-badge");
    const fields = panel.querySelector(".hv-fields");
    const status = panel.querySelector(".hv-status");
    const timeline = panel.querySelector(".hv-timeline");
    const clock = panel.querySelector(".hv-time");
    const mode = panel.querySelector(".hv-mode");
    const collapse = panel.querySelector(".hv-collapse");
    const save = panel.querySelector('[data-action="save"]');
    const reset = panel.querySelector('[data-action="reset"]');
    const presets = [...panel.querySelectorAll("[data-preset]")];
    const controlsButtons = [...panel.querySelectorAll("[data-control]")];
    const rows = new Map();
    let settings = null;
    let snapshot = null;
    let controls = null;
    let actionBusy = false;
    let draggingTimeline = false;
    let lastControlSnapshot = null;

    const announce = (message, error = false) => {
      status.textContent = message;
      status.classList.toggle("hv-error", error);
    };
    const resultMessage = (result) => result?.error instanceof Error ? result.error.message : String(result?.error || "Не удалось выполнить действие.");
    function modelAction(action, success) {
      try {
        const result = action();
        if (result?.ok === false) { announce(resultMessage(result), true); render(); return false; }
        render();
        if (success) announce(success);
        return true;
      } catch (error) { announce(error.message || "Ошибка настроек.", true); return false; }
    }
    async function controlAction(action, success) {
      if (!controls || actionBusy) return;
      actionBusy = true;
      refreshTransport();
      try {
        const result = await action();
        if (result?.ok === false) throw new Error(resultMessage(result));
        if (success) announce(success);
      } catch (error) { announce(error.message || "Не удалось управлять видео.", true); }
      finally { actionBusy = false; refreshTransport(); }
    }

    function buildFields() {
      const groups = new Map();
      for (const definition of settings.definitions || []) {
        const group = definition.group || "Настройки";
        if (!groups.has(group)) {
          const section = document.createElement("section");
          section.className = "hv-field-group";
          const heading = document.createElement("h3");
          heading.className = "hv-section-title";
          heading.textContent = groupNames[group] || group;
          section.append(heading);
          fields.append(section);
          groups.set(group, section);
        }
        const row = document.createElement("div");
        row.className = "hv-field";
        row.dataset.settingKey = definition.key;
        const name = document.createElement("label");
        name.className = "hv-field-label";
        name.textContent = definition.label;
        const input = document.createElement("input");
        input.id = `hermes-setting-${definition.key}`;
        input.type = definition.type === "boolean" ? "checkbox" : "number";
        input.className = definition.type === "boolean" ? "hv-checkbox" : "hv-number";
        name.htmlFor = input.id;
        const lock = document.createElement("button");
        lock.type = "button";
        lock.className = "hv-lock";
        lock.addEventListener("click", () => modelAction(() => settings.toggleLock(definition.key)));
        row.append(name, input, lock);
        let slider = null;
        if (definition.type === "number") {
          for (const property of ["min", "max", "step"]) if (definition[property] !== undefined) input[property] = String(definition[property]);
          input.inputMode = "decimal";
          slider = document.createElement("input");
          slider.type = "range";
          slider.className = "hv-slider";
          slider.setAttribute("aria-label", definition.label);
          for (const property of ["min", "max", "step"]) if (definition[property] !== undefined) slider[property] = String(definition[property]);
          slider.addEventListener("input", () => {
            input.value = slider.value;
            modelAction(() => settings.update(definition.key, Number(slider.value)));
          });
          row.append(slider);
        }
        if (definition.type === "boolean") {
          input.addEventListener("change", () => modelAction(() => settings.update(definition.key, input.checked)));
        } else {
          const commitNumber = (final = false) => {
            const value = input.valueAsNumber;
            // Empty text, a minus sign or an unfinished exponent may be part
            // of typing. Keep that draft until Enter/blur instead of replacing
            // it with the model before the user can finish the number.
            if (!Number.isFinite(value)) {
              if (final) {
                announce("Введите завершённое числовое значение.", true);
                input.value = pretty(settings.getSnapshot().values[definition.key]);
                input.removeAttribute("aria-invalid");
                render();
              }
              return;
            }
            const accepted = modelAction(() => settings.update(definition.key, value));
            if (accepted) {
              input.removeAttribute("aria-invalid");
              if (status.classList.contains("hv-error")) announce("Значение обновлено.");
              if (final) input.value = pretty(settings.getSnapshot().values[definition.key]);
            } else if (final) {
              input.value = pretty(settings.getSnapshot().values[definition.key]);
              input.removeAttribute("aria-invalid");
            } else {
              // An out-of-range prefix can still become a valid decimal.
              // Validate now, but restore rejected text only on commit.
              input.setAttribute("aria-invalid", "true");
            }
          };
          input.addEventListener("input", () => commitNumber());
          input.addEventListener("change", () => commitNumber(true));
          input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitNumber(true);
          });
          input.addEventListener("blur", () => { commitNumber(true); render(); });
        }
        let capture = null;
        let jump = null;
        if (/^cue[1-6]$/.test(definition.key) || ["brownStart", "pinkEnd"].includes(definition.key)) {
          const actions = document.createElement("div");
          actions.className = "hv-cue-actions";
          jump = document.createElement("button");
          jump.type = "button";
          jump.textContent = "К таймкоду";
          jump.setAttribute("aria-label", `Перейти: ${definition.label}`);
          jump.addEventListener("click", () => controlAction(() => controls.seek(Number(settings.getSnapshot().values[definition.key]))));
          capture = document.createElement("button");
          capture.type = "button";
          capture.textContent = "Взять текущий таймкод";
          capture.setAttribute("aria-label", `Взять текущий таймкод: ${definition.label}`);
          capture.addEventListener("click", () => {
            if (!controls) return;
            modelAction(() => settings.update(definition.key, controls.snapshot().time), "Текущий таймкод записан в поле.");
          });
          actions.append(jump, capture);
          row.append(actions);
        }
        groups.get(group).append(row);
        rows.set(definition.key, { definition, row, input, slider, lock, capture, jump });
      }
    }

    function render() {
      if (!settings) return;
      snapshot = settings.getSnapshot();
      const readonly = Number(snapshot.active) === 0;
      badge.textContent = readonly ? "0 · только чтение" : `${snapshot.active} · ${snapshot.dirty ? "не сохранён" : "сохранён"}`;
      badge.classList.toggle("hv-dirty", Boolean(snapshot.dirty) && !readonly);
      presets.forEach((button) => button.setAttribute("aria-pressed", String(Number(button.dataset.preset) === Number(snapshot.active))));
      save.disabled = readonly || !snapshot.dirty;
      reset.disabled = readonly;
      for (const [key, row] of rows) {
        const locked = Boolean(snapshot.locks?.[key]);
        const disabled = readonly || locked;
        row.row.classList.toggle("hv-field-locked", locked);
        row.input.disabled = disabled;
        if (row.definition.type === "boolean") row.input.checked = Boolean(snapshot.values[key]);
        else if (document.activeElement !== row.input) row.input.value = pretty(snapshot.values[key]);
        if (row.slider) {
          row.slider.disabled = disabled;
          if (document.activeElement !== row.slider) row.slider.value = pretty(snapshot.values[key]);
        }
        row.lock.disabled = readonly;
        row.lock.setAttribute("aria-pressed", String(locked));
        row.lock.setAttribute("aria-label", `${locked ? "Разблокировать" : "Заблокировать"}: ${row.definition.label}`);
        row.lock.title = locked ? "Защищено от изменения и сброса" : "Заблокировать поле";
        if (row.lock.dataset.locked !== String(locked)) {
          row.lock.innerHTML = lockIcon(locked);
          row.lock.dataset.locked = String(locked);
        }
        if (row.capture) row.capture.disabled = disabled || !controls;
        if (row.jump) row.jump.disabled = !controls || actionBusy;
      }
    }

    function refreshTransport() {
      controls = window.HermesVideoControls || null;
      const disabled = !controls || actionBusy;
      controlsButtons.forEach((button) => { button.disabled = disabled; });
      timeline.disabled = disabled;
      for (const row of rows.values()) {
        if (row.jump) row.jump.disabled = disabled;
        if (row.capture) row.capture.disabled = !controls || Number(snapshot?.active) === 0 || Boolean(snapshot?.locks?.[row.definition.key]);
      }
      if (!controls) return;
      try {
        const state = controls.snapshot();
        lastControlSnapshot = state;
        const duration = Number(state.duration) > 0 ? Number(state.duration) : DEFAULT_DURATION;
        timeline.max = String(duration);
        if (!draggingTimeline && document.activeElement !== timeline) {
          timeline.value = String(Math.max(0, Math.min(duration, Number(state.time) || 0)));
          clock.textContent = timecode(state.time);
        }
        mode.textContent = `Экран ${state.screen || 1} · ${state.busy ? "переход…" : state.mode === "preview" ? "просмотр" : "сценарий"}`;
        const play = panel.querySelector('[data-control="play"]');
        play.textContent = state.paused ? "Воспроизвести" : "Пауза";
        play.setAttribute("aria-label", state.paused ? "Воспроизвести видео" : "Приостановить видео");
      } catch (error) { announce(error.message || "Не удалось прочитать состояние видео.", true); }
    }

    presets.forEach((button) => button.addEventListener("click", () => {
      if (!settings) return;
      modelAction(() => settings.select(Number(button.dataset.preset)), `Выбран пресет ${button.dataset.preset}.`);
    }));
    save.addEventListener("click", () => modelAction(() => settings.save(), "Пресет сохранён в этом браузере."));
    reset.addEventListener("click", () => modelAction(() => settings.reset(), "Незаблокированные поля сброшены из пресета 0."));
    panel.querySelector('[data-control="previous"]').addEventListener("click", () => controlAction(() => controls.stepFrames(-1)));
    panel.querySelector('[data-control="next"]').addEventListener("click", () => controlAction(() => controls.stepFrames(1)));
    panel.querySelector('[data-control="play"]').addEventListener("click", () => controlAction(() => lastControlSnapshot?.paused ? controls.play() : controls.pause()));
    panel.querySelector('[data-control="transition"]').addEventListener("click", () => controlAction(() => controls.transition(1)));
    panel.querySelector('[data-control="restart"]').addEventListener("click", () => controlAction(() => controls.restart()));
    timeline.addEventListener("pointerdown", () => { draggingTimeline = true; });
    timeline.addEventListener("pointerup", () => { draggingTimeline = false; });
    timeline.addEventListener("pointercancel", () => { draggingTimeline = false; });
    timeline.addEventListener("input", () => { clock.textContent = timecode(timeline.value); });
    timeline.addEventListener("change", () => {
      draggingTimeline = false;
      void controlAction(() => controls.seek(Number(timeline.value)));
    });
    timeline.addEventListener("blur", () => { draggingTimeline = false; refreshTransport(); });
    collapse.addEventListener("click", () => {
      panel.hidden = true;
      collapse.setAttribute("aria-expanded", "false");
      launcher.hidden = false;
      launcher.focus();
    });
    launcher.addEventListener("click", () => {
      panel.hidden = false;
      launcher.hidden = true;
      collapse.setAttribute("aria-expanded", "true");
      collapse.focus();
      refreshTransport();
    });
    // Keep wheel scrolling native inside the panel and keyboard controls local.
    for (const event of ["wheel", "keydown", "keyup", "keypress"]) {
      panel.addEventListener(event, (inputEvent) => inputEvent.stopPropagation());
      launcher.addEventListener(event, (inputEvent) => inputEvent.stopPropagation());
    }
    function connectSettings() {
      if (settings || !window.HermesSettings) return;
      settings = window.HermesSettings;
      buildFields();
      settings.subscribe(render);
      render();
      announce(snapshot.active === 0 ? "Пресет 0 — исходные настройки." : `Загружен пресет ${snapshot.active} из этого браузера.`);
    }
    const ready = () => { connectSettings(); refreshTransport(); };
    window.addEventListener("hermes-controls-ready", ready);
    document.addEventListener("hermes-controls-ready", ready);
    ready();
    setInterval(() => { connectSettings(); if (!panel.hidden) refreshTransport(); }, 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})();
