(() => {
  "use strict";

  const STORAGE_KEY = "hermes-video-presets-v1";
  const BASE = Object.freeze({
    cue1: 5, cue2: 8.07, cue3: 11.14, cue4: 14.12, cue5: 23.2, cue6: 32.12,
    brownStart: 19.16, pinkEnd: 37.02, speed: 1, x: 0, y: 0, scale: 1,
    smoothing: true, smoothingStrength: 1
  });
  const definitions = Object.freeze([
    { key: "cue1", label: "01 · Первый стоп-кадр", min: 4.05, max: 18, step: 0.01, group: "Стоп-кадры", screen: 1 },
    { key: "cue2", label: "02 · Второй стоп-кадр", min: 5.02, max: 18.5, step: 0.01, group: "Стоп-кадры", screen: 2 },
    { key: "cue3", label: "03 · Третий стоп-кадр", min: 5.04, max: 19, step: 0.01, group: "Стоп-кадры", screen: 3 },
    { key: "cue4", label: "04 · Четвёртый стоп-кадр", min: 5.06, max: 19.13, step: 0.01, group: "Стоп-кадры", screen: 4 },
    { key: "cue5", label: "05 · Конец цикла / старт Pink", min: 19.17, max: 23.2, step: 0.01, group: "Стоп-кадры", screen: 5 },
    { key: "cue6", label: "06 · Старт цикла Pink", min: 32.12, max: 32.28, step: 0.01, group: "Стоп-кадры", screen: 6 },
    { key: "brownStart", label: "Начало цикла в пальто", min: 19.15, max: 23.18, step: 0.01, group: "Циклы" },
    { key: "pinkEnd", label: "Конец цикла в белом", min: 32.14, max: 37.02, step: 0.01, group: "Циклы" },
    { key: "speed", label: "Скорость видео", min: 0.25, max: 2, step: 0.05, group: "Видео" },
    { key: "x", label: "Положение X, px", min: -300, max: 300, step: 1, group: "Положение" },
    { key: "y", label: "Положение Y, px", min: -200, max: 200, step: 1, group: "Положение" },
    { key: "scale", label: "Масштаб", min: 0.75, max: 1.5, step: 0.01, group: "Положение" },
    { key: "smoothing", label: "Сглаживание 5,00–5,20 с", type: "boolean", group: "Первый переход" },
    { key: "smoothingStrength", label: "Сила сглаживания", min: 0, max: 2, step: 0.1, group: "Первый переход" }
  ].map(item => Object.freeze({ type: "number", ...item })));
  const byKey = new Map(definitions.map(item => [item.key, item]));
  const unlocked = () => Object.fromEntries(definitions.map(item => [item.key, false]));
  const cloneValues = values => Object.fromEntries(definitions.map(item => [item.key, values[item.key]]));
  const cloneLocks = locks => Object.fromEntries(definitions.map(item => [item.key, Boolean(locks?.[item.key])]));
  const profiles = { 1: { values: cloneValues(BASE), locks: unlocked() }, 2: { values: cloneValues(BASE), locks: unlocked() } };
  const saved = { 1: { values: cloneValues(BASE), locks: unlocked() }, 2: { values: cloneValues(BASE), locks: unlocked() } };
  let active = 0;
  const listeners = new Set();

  function validate(values) {
    for (const item of definitions) {
      const value = values[item.key];
      if (item.type === "boolean") {
        if (typeof value !== "boolean") return "Некорректное значение: " + item.label;
      } else if (typeof value !== "number" || !Number.isFinite(value) || value < item.min - 0.000001 || value > item.max + 0.000001) {
        return item.label + ": допустимо от " + item.min + " до " + item.max;
      }
    }
    const sequence = [values.cue1, values.cue2, values.cue3, values.cue4, values.brownStart, values.cue5, values.cue6, values.pinkEnd];
    if (sequence.some((value, index) => index > 0 && value - sequence[index - 1] < 1 / 60 - 0.000001)) {
      return "Таймкоды должны идти по порядку с интервалом не меньше одного кадра.";
    }
    return null;
  }

  const publishedProfile = window.HermesPublishedPreset;
  if (publishedProfile) {
    const error = validate(publishedProfile.values);
    if (publishedProfile.id !== 1 || error) throw new Error(error || "Неизвестный опубликованный пресет.");
    const published = Object.freeze(cloneValues(publishedProfile.values));
    const locked = () => ({ ok: false, error: "Используется опубликованный пресет 1." });
    window.HermesSettings = Object.freeze({
      BASE, definitions, validate,
      getValues: () => cloneValues(published),
      getSnapshot: () => ({
        active: 1, values: cloneValues(published),
        locks: Object.fromEntries(definitions.map(item => [item.key, true])), dirty: false
      }),
      subscribe: () => () => {},
      update: locked, toggleLock: locked, select: locked, save: locked, reset: locked
    });
    return;
  }

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored?.version === 1) {
      for (const id of [1, 2]) {
        if (!stored.profiles?.[id]) continue;
        const values = cloneValues({ ...BASE, ...stored.profiles[id].values });
        if (validate(values)) continue;
        const locks = cloneLocks(stored.profiles[id].locks);
        profiles[id] = { values: cloneValues(values), locks: cloneLocks(locks) };
        saved[id] = { values: cloneValues(values), locks: cloneLocks(locks) };
      }
      if ([0, 1, 2].includes(stored.active)) active = stored.active;
    }
  } catch { /* Corrupt or unavailable browser storage cannot replace baseline 0. */ }

  function getValues() { return cloneValues(active === 0 ? BASE : profiles[active].values); }
  function getSnapshot() {
    const profile = active === 0 ? { values: BASE, locks: Object.fromEntries(definitions.map(item => [item.key, true])) } : profiles[active];
    return {
      active, values: cloneValues(profile.values), locks: cloneLocks(profile.locks),
      dirty: active !== 0 && JSON.stringify(profile) !== JSON.stringify(saved[active])
    };
  }
  function notify(changedKey) {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try { listener({ ...snapshot, changedKey }); } catch (error) { console.error("Settings listener failed", error); }
    }
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, active, profiles: saved }));
      return { ok: true };
    } catch { return { ok: false, error: "Браузер не разрешил сохранить настройки. Текущие значения доступны до перезагрузки." }; }
  }
  function update(key, value) {
    const item = byKey.get(key);
    if (!item) return { ok: false, error: "Неизвестный параметр." };
    if (active === 0) return { ok: false, error: "Пресет 0 неизменяемый. Выберите 1 или 2." };
    if (profiles[active].locks[key]) return { ok: false, error: "Параметр заблокирован. Нажмите на замочек." };
    if (Object.is(profiles[active].values[key], value)) return { ok: true };
    const candidate = { ...profiles[active].values, [key]: value };
    const error = validate(candidate);
    if (error) return { ok: false, error };
    profiles[active].values = cloneValues(candidate);
    notify(key);
    return { ok: true };
  }
  function toggleLock(key) {
    if (!byKey.has(key)) return { ok: false, error: "Неизвестный параметр." };
    if (active === 0) return { ok: false, error: "Пресет 0 всегда заблокирован." };
    profiles[active].locks[key] = !profiles[active].locks[key];
    notify("locks");
    return { ok: true };
  }
  function select(id) {
    if (![0, 1, 2].includes(id)) return { ok: false, error: "Неизвестный пресет." };
    active = id;
    const result = persist();
    notify("preset");
    return result;
  }
  function save() {
    if (active === 0) return { ok: false, error: "Пресет 0 нельзя перезаписать." };
    const previous = saved[active];
    saved[active] = { values: cloneValues(profiles[active].values), locks: cloneLocks(profiles[active].locks) };
    const result = persist();
    if (!result.ok) saved[active] = previous;
    notify("saved");
    return result;
  }
  function reset() {
    if (active === 0) return { ok: false, error: "Пресет 0 уже является исходным вариантом." };
    const current = profiles[active];
    const values = Object.fromEntries(definitions.map(item => [item.key, current.locks[item.key] ? current.values[item.key] : BASE[item.key]]));
    const error = validate(values);
    if (error) return { ok: false, error: "Заблокированные таймкоды несовместимы со сбросом. Сначала разблокируйте их." };
    profiles[active].values = values;
    notify("reset");
    return { ok: true };
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.HermesSettings = Object.freeze({ BASE, definitions, getValues, getSnapshot, validate, update, toggleLock, select, save, reset, subscribe });
})();
