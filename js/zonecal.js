// Scan-Vorlage einrichten: Foto einer Arbeitskarte laden, Kästchen über die
// Felder ziehen und jeder Zone ein Feld zuordnen. Speichert relative Zonen.
import { Zones } from './store.js';
import { ZONE_FIELDS, zoneLabel } from './zones.js';

let canvas, ctx, baseImg, zones, resolveFn, hasImage;

function $(id) { return document.getElementById(id); }

function setup() {
  canvas = $('zoneCanvas');
  ctx = canvas.getContext('2d');

  // Feld-Auswahl füllen
  const sel = $('zoneField');
  sel.innerHTML = ZONE_FIELDS.map((f) => `<option value="${f.key}">${f.label}</option>`).join('');

  $('zonePick').onclick = () => $('zoneInput').click();
  $('zoneInput').addEventListener('change', (e) => {
    const f = (e.target.files || [])[0];
    e.target.value = '';
    if (f) loadPhoto(URL.createObjectURL(f));
  });
  $('zoneClearAll').onclick = () => { zones = []; renderList(); redraw(); };
  $('zoneCancel').onclick = () => close(false);
  $('zoneSave').onclick = save;

  bindPointer();
  setup.done = true;
}

function pos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

function bindPointer() {
  let drawing = false, a = null, b = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!hasImage) return;
    drawing = true; canvas.setPointerCapture(e.pointerId);
    a = pos(e); b = a;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    b = pos(e); redraw(); drawRect(a, b, $('zoneField').value, true);
  });
  const end = () => {
    if (!drawing) return;
    drawing = false;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w > 8 && h > 8) {
      zones.push({
        field: $('zoneField').value,
        x: x / canvas.width, y: y / canvas.height,
        w: w / canvas.width, h: h / canvas.height,
      });
      autoAdvanceField();
      renderList();
    }
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

// Nach dem Setzen automatisch zum nächsten noch freien Feld springen
function autoAdvanceField() {
  const used = new Set(zones.map((z) => z.field));
  const next = ZONE_FIELDS.find((f) => !used.has(f.key));
  if (next) $('zoneField').value = next.key;
}

function drawRect(a, b, field, preview) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  ctx.lineWidth = Math.max(2, canvas.width / 400);
  ctx.strokeStyle = preview ? '#38bdf8' : '#0ea5e9';
  ctx.fillStyle = 'rgba(56,189,248,.16)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  // Beschriftung
  const fs = Math.max(12, canvas.width / 38);
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  const label = zoneLabel(field);
  const tw = ctx.measureText(label).width + 10;
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(x, Math.max(0, y - fs - 6), tw, fs + 6);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, x + 5, Math.max(fs, y - 4));
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (hasImage) ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
  zones.forEach((z) => drawRect(
    { x: z.x * canvas.width, y: z.y * canvas.height },
    { x: (z.x + z.w) * canvas.width, y: (z.y + z.h) * canvas.height },
    z.field, false,
  ));
}

function renderList() {
  const box = $('zoneList');
  box.innerHTML = '';
  if (!zones.length) {
    box.innerHTML = '<div class="zone-empty">Noch keine Kästchen. Feld wählen und über die Karte ziehen.</div>';
    return;
  }
  zones.forEach((z, i) => {
    const row = document.createElement('div');
    row.className = 'zone-item';
    row.innerHTML = `<span>${zoneLabel(z.field)}</span><button type="button" aria-label="Löschen">🗑</button>`;
    row.querySelector('button').onclick = () => { zones.splice(i, 1); renderList(); redraw(); };
    box.appendChild(row);
  });
}

function loadPhoto(src) {
  baseImg = new Image();
  baseImg.onload = () => {
    const max = 1100; // kompakt halten (wird mitgespeichert)
    let w = baseImg.width, h = baseImg.height;
    if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    canvas.width = w; canvas.height = h;
    hasImage = true;
    $('zoneHint').textContent = 'Feld oben wählen und ein Kästchen über die passende Stelle ziehen.';
    redraw();
  };
  baseImg.src = src;
}

function save() {
  if (!hasImage) { close(false); return; }
  const aspect = canvas.width / canvas.height;
  const image = canvas.toDataURL('image/jpeg', 0.7); // Karte als Vorschau/Bearbeitung
  Zones.save(zones, aspect, image);
  close(true);
}

function close(result) {
  $('zoneModal').classList.remove('open');
  document.body.style.overflow = '';
  const r = resolveFn; resolveFn = null;
  r && r(result);
}

// Öffnet den Editor. Lädt eine bestehende Vorlage zum Weiterbearbeiten.
export function openZoneCalibrator() {
  return new Promise((resolve) => {
    if (!setup.done) setup();
    resolveFn = resolve;
    zones = [];
    hasImage = false;

    const tpl = Zones.get();
    const sel = $('zoneField'); if (sel) sel.value = ZONE_FIELDS[0].key;

    const open = () => {
      $('zoneModal').classList.add('open');
      document.body.style.overflow = 'hidden';
    };

    if (tpl && tpl.image) {
      zones = (tpl.items || []).map((z) => ({ ...z }));
      $('zoneHint').textContent = 'Vorlage laden… Kästchen lassen sich anpassen oder neu ziehen.';
      loadPhoto(tpl.image);
      renderList();
      open();
    } else {
      // Noch keine Vorlage: leere Fläche, Nutzer wählt zuerst ein Foto
      canvas.width = 800; canvas.height = 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      $('zoneHint').textContent = 'Zuerst ein Foto einer Arbeitskarte wählen.';
      renderList();
      open();
    }
  });
}
