/* ============================================================
   Schlaflicht – stufenlos dimmbares Nachtlicht
   - füllt den Bildschirm mit einer frei wählbaren Lichtfarbe
   - hält den Bildschirm über die Wake-Lock-API stundenlang an
   - Einschlaf-Timer mit sanftem Ausdimmen
   Reines JS ohne Abhängigkeiten.
   ============================================================ */
(() => {
  'use strict';

  const KEY = 'schlaflicht.v1';
  const $ = (id) => document.getElementById(id);

  const el = {
    light: $('light'),
    clock: $('clock'),
    status: $('status'),
    wakeState: $('wakeState'),
    battery: $('battery'),
    timerState: $('timerState'),
    panel: $('panel'),
    brightness: $('brightness'),
    brightnessOut: $('brightnessOut'),
    kelvin: $('kelvin'),
    kelvinOut: $('kelvinOut'),
    colorPick: $('colorPick'),
    presets: $('presets'),
    timers: $('timers'),
    fade: $('fade'),
    flicker: $('flicker'),
    showClock: $('showClock'),
    lockBtn: $('lockBtn'),
    fullscreenBtn: $('fullscreenBtn'),
    toast: $('toast'),
    offScreen: $('offScreen'),
    restartBtn: $('restartBtn')
  };

  const state = {
    bright: 30,          // 0–100 (Nutzerwert, nicht linear zur Leuchtdichte)
    mode: 'kelvin',      // 'kelvin' | 'color'
    kelvin: 2000,
    color: '#ff9a3c',
    timerMin: 0,         // 0 = kein Timer
    fade: true,
    flicker: false,
    clock: false,
    locked: false
  };

  let timerEnd = 0;      // Zeitstempel (ms), 0 = kein Timer
  let timerFactor = 1;   // Ausdimm-Faktor des Timers (1 → 0)
  let flickerFactor = 1; // Kerzen-Flackern
  let flickerTimer = null;
  let isOff = false;

  /* ---------- Speichern / Laden ---------------------------------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch (e) { /* Einstellungen sind Komfort, kein Muss */ }
    state.locked = false; // nach Neustart nie gesperrt starten
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* egal */ }
  }

  /* ---------- Farbe ---------------------------------------------- */
  // Farbtemperatur → RGB (Näherung nach Tanner Helland)
  function kelvinToRgb(k) {
    const t = Math.max(1000, Math.min(40000, k)) / 100;
    let r, g, b;
    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return [c(r), c(g), c(b)];
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [255, 154, 60];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function baseRgb() {
    return state.mode === 'color' ? hexToRgb(state.color) : kelvinToRgb(state.kelvin);
  }

  /* ---------- Helligkeit ------------------------------------------
     Der Slider ist wahrnehmungsnah (Gamma), damit im unteren Bereich
     – dort wird ein Schlaflicht benutzt – fein geregelt werden kann.
     Unter ~1/255 kann ein 8-Bit-Display nicht mehr dimmen; dort wird
     auf den kleinsten darstellbaren Wert begrenzt.                */
  function brightnessFactor(rgb) {
    const b = Math.max(0, Math.min(100, state.bright)) / 100;
    if (b <= 0) return 0;
    let f = Math.pow(b, 1.8);
    const maxC = Math.max(rgb[0], rgb[1], rgb[2]);
    if (maxC > 0) f = Math.max(f, 1 / maxC); // mindestens ein Farbwert von 1
    return Math.min(1, f);
  }

  function render() {
    const rgb = baseRgb();
    const f = brightnessFactor(rgb) * timerFactor * flickerFactor;
    const out = rgb.map((c) => Math.round(Math.max(0, Math.min(255, c * f))));
    el.light.style.backgroundColor = `rgb(${out[0]}, ${out[1]}, ${out[2]})`;

    // Uhr in der Lichtfarbe: bei dunklem Licht etwas heller als der Hintergrund,
    // bei hellem Licht dunkel – sonst wäre sie nicht lesbar.
    const lum = (0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]) / 255;
    if (lum < 0.35) {
      const g = Math.min(1, Math.max(f * 4, 0.06));
      const c = rgb.map((v) => Math.round(Math.min(255, v * g)));
      el.clock.style.color = `rgba(${c[0]}, ${c[1]}, ${c[2]}, .85)`;
    } else {
      el.clock.style.color = 'rgba(0, 0, 0, .3)';
    }
    // Statusleiste des Systems an die Lichtfarbe anpassen
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', rgbToHex(out));
  }

  /* ---------- Bedienfeld ------------------------------------------ */
  function syncUi() {
    el.brightness.value = String(state.bright);
    el.brightnessOut.textContent = state.bright + ' %';
    el.kelvin.value = String(state.kelvin);
    el.kelvinOut.textContent = state.mode === 'color'
      ? state.color.toUpperCase()
      : state.kelvin + ' K';
    el.colorPick.value = state.mode === 'color' ? state.color : rgbToHex(kelvinToRgb(state.kelvin));
    el.fade.checked = state.fade;
    el.flicker.checked = state.flicker;
    el.showClock.checked = state.clock;
    el.clock.classList.toggle('hidden', !state.clock);
    el.lockBtn.textContent = state.locked ? '🔒' : '🔓';

    el.presets.querySelectorAll('button').forEach((b) => {
      const active = (b.dataset.kelvin && state.mode === 'kelvin' && Number(b.dataset.kelvin) === state.kelvin)
        || (b.dataset.color && state.mode === 'color' && b.dataset.color.toLowerCase() === state.color.toLowerCase());
      b.classList.toggle('active', !!active);
    });
    el.timers.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.min) === state.timerMin);
    });
    document.querySelectorAll('.mini[data-bright]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.bright) === state.bright);
    });
  }

  let hideTimer = null;
  function showPanel(auto = true) {
    if (state.locked) return;
    el.panel.classList.remove('faded');
    el.status.classList.remove('faded');
    clearTimeout(hideTimer);
    if (auto) hideTimer = setTimeout(hidePanel, 15000);
  }
  function hidePanel() {
    clearTimeout(hideTimer);
    el.panel.classList.add('faded');
    el.status.classList.add('faded');
  }
  function panelVisible() { return !el.panel.classList.contains('faded'); }

  function toast(text, ms = 2000) {
    el.toast.textContent = text;
    el.toast.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.add('hidden'), ms);
  }

  /* ---------- Bildschirm wach halten ------------------------------ */
  let wakeLock = null;
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      el.wakeState.textContent = '⚠︎ Bildschirm-Sperre nicht unterstützt';
      el.wakeState.title = 'Bitte im System die Display-Abschaltzeit hochsetzen.';
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      el.wakeState.textContent = '🌙 Bildschirm bleibt an';
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
      el.wakeState.textContent = '⚠︎ Bildschirm kann abschalten';
    }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* egal */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isOff && !wakeLock) requestWakeLock();
  });

  /* ---------- Akku ------------------------------------------------ */
  function initBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then((bat) => {
      const upd = () => {
        const pct = Math.round(bat.level * 100);
        el.battery.textContent = (bat.charging ? '⚡ ' : '🔋 ') + pct + ' %';
        el.battery.classList.remove('hidden');
      };
      upd();
      bat.addEventListener('levelchange', upd);
      bat.addEventListener('chargingchange', upd);
    }).catch(() => { /* egal */ });
  }

  /* ---------- Timer ----------------------------------------------- */
  function setTimer(min) {
    state.timerMin = min;
    timerEnd = min > 0 ? Date.now() + min * 60000 : 0;
    timerFactor = 1;
    if (min === 0) {
      el.timerState.classList.add('hidden');
      el.timerState.textContent = '';
    }
    save();
    syncUi();
    tick();
    render();
  }

  function fadeWindowMs() {
    if (!state.fade || !state.timerMin) return 0;
    // höchstens 10 Minuten, bei kurzen Timern höchstens die Hälfte der Laufzeit
    return Math.min(10, state.timerMin / 2) * 60000;
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')} h` : `${m}:${String(sec).padStart(2, '0')} min`;
  }

  function tick() {
    if (state.clock) {
      const d = new Date();
      el.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    if (!timerEnd) return;

    const left = timerEnd - Date.now();
    if (left <= 0) return turnOff();

    el.timerState.textContent = '⏱ ' + fmt(left);
    el.timerState.classList.remove('hidden');

    const win = fadeWindowMs();
    const next = win > 0 && left < win ? Math.max(0, left / win) : 1;
    if (Math.abs(next - timerFactor) > 0.0005) {
      timerFactor = next;
      render();
    }
  }

  function turnOff() {
    isOff = true;
    timerEnd = 0;
    timerFactor = 0;
    render();
    releaseWakeLock();
    hidePanel();
    el.offScreen.classList.remove('hidden');
    el.timerState.classList.add('hidden');
  }

  function turnOn() {
    isOff = false;
    timerFactor = 1;
    el.offScreen.classList.add('hidden');
    requestWakeLock();
    setTimer(state.timerMin);
    showPanel();
    render();
  }

  /* ---------- Kerzen-Flackern -------------------------------------- */
  function updateFlicker() {
    clearInterval(flickerTimer);
    flickerTimer = null;
    if (!state.flicker) {
      flickerFactor = 1;
      el.light.classList.remove('instant');
      render();
      return;
    }
    el.light.classList.remove('instant'); // weiche Übergänge = ruhiges Flackern
    flickerTimer = setInterval(() => {
      const target = 0.72 + Math.random() * 0.28;
      flickerFactor = flickerFactor * 0.55 + target * 0.45;
      render();
    }, 220);
  }

  /* ---------- Sperre ----------------------------------------------- */
  function setLocked(on) {
    state.locked = on;
    if (on) {
      hidePanel();
      toast('🔒 Bedienung gesperrt – zum Entsperren 2 Sekunden gedrückt halten', 3200);
    } else {
      toast('🔓 Entsperrt');
      showPanel();
    }
    syncUi();
  }

  let pressTimer = null;
  function onPressStart() {
    if (!state.locked) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => setLocked(false), 2000);
  }
  function onPressEnd() { clearTimeout(pressTimer); }

  /* ---------- Ereignisse -------------------------------------------- */
  el.brightness.addEventListener('input', () => {
    state.bright = Number(el.brightness.value);
    el.brightnessOut.textContent = state.bright + ' %';
    document.querySelectorAll('.mini[data-bright]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.bright) === state.bright);
    });
    render();
    save();
    showPanel();
  });

  document.querySelectorAll('.mini[data-bright]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.bright = Number(btn.dataset.bright);
      save(); syncUi(); render(); showPanel();
    });
  });

  el.kelvin.addEventListener('input', () => {
    state.mode = 'kelvin';
    state.kelvin = Number(el.kelvin.value);
    save(); syncUi(); render(); showPanel();
  });

  el.presets.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.kelvin) {
      state.mode = 'kelvin';
      state.kelvin = Number(btn.dataset.kelvin);
    } else if (btn.dataset.color) {
      state.mode = 'color';
      state.color = btn.dataset.color;
    }
    save(); syncUi(); render(); showPanel();
  });

  el.colorPick.addEventListener('input', () => {
    state.mode = 'color';
    state.color = el.colorPick.value;
    save(); syncUi(); render(); showPanel();
  });

  el.timers.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    setTimer(Number(btn.dataset.min));
    toast(state.timerMin ? `Timer: ${state.timerMin} Minuten` : 'Timer aus');
    showPanel();
  });

  el.fade.addEventListener('change', () => {
    state.fade = el.fade.checked;
    if (!state.fade) { timerFactor = 1; render(); }
    save(); tick();
  });

  el.flicker.addEventListener('change', () => {
    state.flicker = el.flicker.checked;
    save(); updateFlicker();
  });

  el.showClock.addEventListener('change', () => {
    state.clock = el.showClock.checked;
    el.clock.classList.toggle('hidden', !state.clock);
    save(); tick();
  });

  el.lockBtn.addEventListener('click', (ev) => { ev.stopPropagation(); setLocked(!state.locked); });

  el.fullscreenBtn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      toast('Vollbild wird hier nicht unterstützt');
    }
  });

  el.restartBtn.addEventListener('click', (ev) => { ev.stopPropagation(); turnOn(); });

  // Tippen auf die Leuchtfläche: Bedienung ein-/ausblenden
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#panel') || ev.target.closest('#offScreen')) return;
    if (state.locked) { toast('🔒 Gesperrt – 2 Sekunden gedrückt halten'); return; }
    if (panelVisible()) hidePanel(); else showPanel();
  });

  ['pointerdown', 'touchstart'].forEach((e) => document.addEventListener(e, onPressStart, { passive: true }));
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach((e) => document.addEventListener(e, onPressEnd, { passive: true }));

  // Tastatur (Desktop): Pfeile dimmen, Leertaste blendet die Bedienung um
  document.addEventListener('keydown', (ev) => {
    if (ev.target !== document.body) return;
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      state.bright = Math.max(0, Math.min(100, state.bright + (ev.key === 'ArrowUp' ? 1 : -1)));
      save(); syncUi(); render(); showPanel();
      ev.preventDefault();
    } else if (ev.key === ' ') {
      if (panelVisible()) hidePanel(); else showPanel();
      ev.preventDefault();
    }
  });

  /* ---------- Start ------------------------------------------------- */
  load();
  syncUi();
  render();
  updateFlicker();
  setTimer(state.timerMin);
  requestWakeLock();
  initBattery();
  showPanel();
  setInterval(tick, 1000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  // für Tests/Debug
  window.__licht = { state, render, setTimer, turnOff, turnOn };
})();
