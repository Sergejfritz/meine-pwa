// Foto-Markierung: Pfeile, Kreise & Freihand auf Bildern zeichnen (Touch + Maus)
const COLORS = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#ffffff', '#111827'];

let canvas, ctx, baseImg, strokes, current, tool, color, resolveFn, scale;

function setup() {
  const modal = document.getElementById('annoModal');
  canvas = document.getElementById('annoCanvas');
  ctx = canvas.getContext('2d');

  // Werkzeuge
  modal.querySelectorAll('[data-tool]').forEach((b) => {
    b.onclick = () => {
      tool = b.dataset.tool;
      modal.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
    };
  });

  // Farben
  const colorWrap = document.getElementById('annoColors');
  colorWrap.innerHTML = '';
  COLORS.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'color-dot' + (i === 0 ? ' active' : '');
    d.style.background = c;
    d.onclick = () => {
      color = c;
      colorWrap.querySelectorAll('.color-dot').forEach((x) => x.classList.toggle('active', x === d));
    };
    colorWrap.appendChild(d);
  });

  document.getElementById('annoUndo').onclick = () => { strokes.pop(); redraw(); };
  document.getElementById('annoClear').onclick = () => { strokes = []; redraw(); };
  document.getElementById('annoCancel').onclick = () => close(null);
  document.getElementById('annoSave').onclick = () => {
    redraw();
    close(canvas.toDataURL('image/jpeg', 0.85));
  };

  bindPointer();
  setup.done = true;
}

function pos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height)
  };
}

function bindPointer() {
  let drawing = false;
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    current = { tool, color, w: Math.max(3, canvas.width / 300), pts: [p] };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    if (current.tool === 'pen') current.pts.push(p);
    else current.pts[1] = p; // Linie/Pfeil/Kreis: nur Start + Ende
    redraw();
    drawStroke(current);
  });
  const end = () => { if (drawing && current.pts.length > 1) strokes.push(current); drawing = false; redraw(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

function drawStroke(s) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const [a, b] = s.pts;
  if (s.tool === 'pen') {
    ctx.beginPath();
    s.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  } else if (s.tool === 'ellipse') {
    if (!b) return;
    ctx.beginPath();
    ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === 'arrow') {
    if (!b) return;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const head = s.w * 4;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.4), b.y - head * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.4), b.y - head * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
  strokes.forEach(drawStroke);
}

function close(result) {
  document.getElementById('annoModal').classList.remove('open');
  document.body.style.overflow = '';
  const r = resolveFn; resolveFn = null;
  r && r(result);
}

// Öffnet den Editor für eine Bild-dataURL, liefert neue dataURL (oder null bei Abbruch)
export function annotate(src) {
  return new Promise(async (resolve) => {
    if (!setup.done) setup();
    resolveFn = resolve;
    strokes = []; tool = 'arrow'; color = COLORS[0];

    const modal = document.getElementById('annoModal');
    modal.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'arrow'));
    document.getElementById('annoColors').querySelectorAll('.color-dot')
      .forEach((x, i) => x.classList.toggle('active', i === 0));

    baseImg = new Image();
    baseImg.onload = () => {
      // Zeichenauflösung begrenzen (Speicher), Seitenverhältnis halten
      const max = 1600;
      let w = baseImg.width, h = baseImg.height;
      if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      canvas.width = w; canvas.height = h;
      redraw();
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    baseImg.src = src;
  });
}
