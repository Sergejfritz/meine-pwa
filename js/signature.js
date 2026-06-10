// Unterschrift-Pad: mit dem Finger (oder Maus) unterschreiben.
// Liefert eine PNG-Daten-URL (oder '' wenn leer übernommen, oder null bei Abbruch).
let canvas, ctx, resolveFn, drawn, dpr;

function $(id) { return document.getElementById(id); }

function setup() {
  canvas = $('sigCanvas');
  ctx = canvas.getContext('2d');
  $('sigClear').onclick = clearPad;
  $('sigCancel').onclick = () => close(null);
  $('sigSave').onclick = () => close(drawn ? canvas.toDataURL('image/png') : '');
  bindPointer();
  setup.done = true;
}

function fitCanvas() {
  const wrap = canvas.parentElement;
  dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintBg();
}

function paintBg() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function clearPad() { drawn = false; paintBg(); }

function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function bindPointer() {
  let active = false, last = null;
  canvas.addEventListener('pointerdown', (e) => {
    active = true; canvas.setPointerCapture(e.pointerId); last = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const p = pos(e);
    ctx.strokeStyle = '#0b1b2b';
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; drawn = true;
  });
  const end = () => { active = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function close(result) {
  $('sigModal').classList.remove('open');
  document.body.style.overflow = '';
  const r = resolveFn; resolveFn = null;
  r && r(result);
}

// Öffnet das Pad. existing (Daten-URL) wird als Startbild geladen.
export function openSignaturePad(existing) {
  return new Promise((resolve) => {
    if (!setup.done) setup();
    resolveFn = resolve;
    drawn = false;
    $('sigModal').classList.add('open');
    document.body.style.overflow = 'hidden';
    // nach dem Öffnen messen (Layout steht erst dann)
    requestAnimationFrame(() => {
      fitCanvas();
      if (existing) {
        const img = new Image();
        img.onload = () => {
          // In echten Geräte-Pixeln zeichnen (transform-unabhängig, HiDPI-korrekt)
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          drawn = true;
        };
        img.src = existing;
      }
    });
  });
}
