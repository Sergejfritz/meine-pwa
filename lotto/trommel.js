// Lostrommel mit echter Physik: 49 Kugeln in einer drehenden Trommel – Schwerkraft,
// Stöße untereinander, an der Wand und an vier Mitnehmern. Gerechnet wird in festen
// Zeitschritten: gleicher Startwert + gleiche Schwerkraft → exakt dieselbe Ziehung.
// Ändert man nur die Schwerkraft um ein Zehnmillionstel, kommt etwas anderes heraus
// (Chaos) – genau deshalb lässt sich eine echte Ziehung nicht vorausberechnen.
// Die Physik braucht keine Seite (auch in Prüfskripten nutzbar); zeichne() malt auf ein Canvas.

const DT = 1 / 480;               // Zeitschritt in Sekunden
const OMEGA = 3.2;                // Drehung der Trommel in rad/s
const STOSS_KUGEL = 0.9;          // Anteil des Tempos, der beim Stoß erhalten bleibt
const STOSS_WAND = 0.55;
const MITNAHME = 0.35;            // wie stark die Wand die Kugeln mitreißt
const HAUPT = { anzahl: 49, R: 0.30, r: 0.021, mischen: 2.5, abstand: 1.8, ziehen: 6 };
const SUPER = { anzahl: 10, R: 0.17, r: 0.030, mischen: 2.0, abstand: 1, ziehen: 1 };
const PAUSE = 0.9;                // Sekunden zwischen 6. Kugel und Superzahl-Trommel

function zufallsquelle(saat) {
  let a = saat >>> 0;
  return () => { // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neueTrommel(art, zufall, erste) {
  const { anzahl, R, r } = art;
  const t = { art, n: anzahl, R, r, zeit: 0, winkel: 0, x: new Float64Array(anzahl), y: new Float64Array(anzahl),
    vx: new Float64Array(anzahl), vy: new Float64Array(anzahl), drin: new Uint8Array(anzahl).fill(1), gezogen: [], wann: [] };
  // Kugeln in Reihen unten in die Trommel legen, leicht verwackelt
  const schritt = r * 2.15;
  let i = 0;
  for (let reihe = 0; i < anzahl; reihe++) {
    const y = R - r * 1.3 - reihe * schritt * 0.9;
    const halb = Math.sqrt(Math.max(0, (R - r * 1.2) ** 2 - y * y));
    const platz = Math.max(1, Math.floor((2 * halb) / schritt));
    for (let k = 0; k < platz && i < anzahl; k++, i++) {
      t.x[i] = -halb + schritt * (k + 0.5) + (zufall() - 0.5) * r * 0.2;
      t.y[i] = y + (zufall() - 0.5) * r * 0.2;
    }
  }
  // Beschriftung zufällig auf die Kugeln verteilen → jede Zahl hat dieselbe Chance
  t.nummer = Array.from({ length: anzahl }, (_, k) => k + erste);
  for (let k = anzahl - 1; k > 0; k--) { const j = Math.floor(zufall() * (k + 1)); [t.nummer[k], t.nummer[j]] = [t.nummer[j], t.nummer[k]]; }
  return t;
}

function schrittTrommel(t, g) {
  const { n, R, r, x, y, vx, vy, drin } = t;
  t.zeit += DT;
  t.winkel += OMEGA * DT;
  for (let i = 0; i < n; i++) {
    if (!drin[i]) continue;
    vy[i] += g * DT; // y zeigt nach unten
    x[i] += vx[i] * DT;
    y[i] += vy[i] * DT;
  }
  // vier Mitnehmer drehen mit der Trommel
  const pr = r * 1.25;
  for (let k = 0; k < 4; k++) {
    const w = t.winkel + (k * Math.PI) / 2;
    const cx = (R - pr) * Math.cos(w); const cy = (R - pr) * Math.sin(w);
    const pvx = -OMEGA * cy; const pvy = OMEGA * cx;
    for (let i = 0; i < n; i++) {
      if (!drin[i]) continue;
      const dx = x[i] - cx; const dy = y[i] - cy;
      const d2 = dx * dx + dy * dy; const min = r + pr;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2); const nx = dx / d; const ny = dy / d;
      const vn = (vx[i] - pvx) * nx + (vy[i] - pvy) * ny;
      if (vn < 0) { vx[i] -= 1.7 * vn * nx; vy[i] -= 1.7 * vn * ny; }
      x[i] = cx + nx * min; y[i] = cy + ny * min;
    }
  }
  // Kugel gegen Kugel
  const min = 2 * r; const min2 = min * min;
  for (let i = 0; i < n; i++) {
    if (!drin[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (!drin[j]) continue;
      const dx = x[j] - x[i]; const dy = y[j] - y[i];
      const d2 = dx * dx + dy * dy;
      if (d2 >= min2 || d2 === 0) continue;
      const d = Math.sqrt(d2); const nx = dx / d; const ny = dy / d;
      const vn = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny;
      if (vn < 0) {
        const imp = (-(1 + STOSS_KUGEL) * vn) / 2;
        vx[i] -= imp * nx; vy[i] -= imp * ny; vx[j] += imp * nx; vy[j] += imp * ny;
      }
      const ueber = (min - d) / 2;
      x[i] -= nx * ueber; y[i] -= ny * ueber; x[j] += nx * ueber; y[j] += ny * ueber;
    }
  }
  // Wand: abprallen und von der Drehung mitgenommen werden
  const grenze = R - r;
  for (let i = 0; i < n; i++) {
    if (!drin[i]) continue;
    const d = Math.hypot(x[i], y[i]);
    if (d <= grenze) continue;
    const nx = x[i] / d; const ny = y[i] / d;
    const vn = vx[i] * nx + vy[i] * ny;
    if (vn > 0) { vx[i] -= (1 + STOSS_WAND) * vn * nx; vy[i] -= (1 + STOSS_WAND) * vn * ny; }
    const tx = -ny; const ty = nx;
    const dv = MITNAHME * (OMEGA * R - (vx[i] * tx + vy[i] * ty)) * DT * 60;
    vx[i] += dv * tx; vy[i] += dv * ty;
    x[i] = nx * grenze; y[i] = ny * grenze;
  }
  // Zeit für die nächste Kugel? Es fällt die, die dem Auslass unten am nächsten ist.
  const k = t.gezogen.length;
  if (k < t.art.ziehen && t.zeit >= t.art.mischen + k * t.art.abstand) {
    let best = -1; let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!drin[i]) continue;
      const d = x[i] * x[i] + (y[i] - R) * (y[i] - R);
      if (d < bd) { bd = d; best = i; }
    }
    drin[best] = 0;
    t.gezogen.push(t.nummer[best]);
    t.wann.push(t.zeit);
    t.letzte = { i: best, x: x[best], y: y[best] };
  }
}

// Eine Ziehung beginnen. saat = Startwert (bestimmt Lage und Beschriftung), g = Schwerkraft in m/s²
export function starte({ saat = 1, g = 9.81 } = {}) {
  const zufall = zufallsquelle(saat);
  const sim = { g, zeit: 0, haupt: neueTrommel(HAUPT, zufall, 1), sz: neueTrommel(SUPER, zufall, 0), phase: 'haupt', pause: 0, fertig: false };
  sim.schritt = () => {
    if (sim.fertig) return;
    sim.zeit += DT;
    if (sim.phase === 'haupt') {
      schrittTrommel(sim.haupt, g);
      if (sim.haupt.gezogen.length === HAUPT.ziehen) sim.phase = 'pause';
    } else if (sim.phase === 'pause') {
      schrittTrommel(sim.haupt, g);
      sim.pause += DT;
      if (sim.pause >= PAUSE) sim.phase = 'sz';
    } else {
      schrittTrommel(sim.sz, g);
      if (sim.sz.gezogen.length === SUPER.ziehen && sim.sz.zeit >= SUPER.mischen + 0.8) sim.fertig = true;
    }
  };
  return sim;
}
// Ganze Ziehung ohne Bild durchrechnen → { zahlen: 6 Zahlen in Ziehreihenfolge, sz }
export function ziehung(opts) {
  const sim = starte(opts);
  while (!sim.fertig) sim.schritt();
  return { zahlen: sim.haupt.gezogen.slice(), sz: sim.sz.gezogen[0] };
}
export const SCHRITTE_PRO_SEKUNDE = Math.round(1 / DT);

// ---------- Bild ----------
const FARBEN = ['#f4c430', '#3b82c4', '#d9534f', '#3fa66b', '#8e5bb5']; // 1–9, 10–19, 20–29, 30–39, 40–49
const farbe = (nr, sz) => (sz ? '#f3efe6' : FARBEN[Math.min(4, Math.floor(nr / 10))]);

function kugel(ctx, px, py, pr, nr, sz, dreh = 0) {
  const gr = ctx.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.1, px, py, pr);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.25, farbe(nr, sz));
  gr.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.beginPath(); ctx.arc(px, py, pr, 0, 2 * Math.PI);
  ctx.fillStyle = farbe(nr, sz); ctx.fill();
  ctx.fillStyle = gr; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
  // weißes Feld mit Zahl, dreht sich mit der Kugel
  ctx.save(); ctx.translate(px, py); ctx.rotate(dreh);
  ctx.beginPath(); ctx.arc(0, 0, pr * 0.62, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  ctx.fillStyle = '#1d1b18'; ctx.font = `700 ${Math.round(pr * 0.82)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(nr), 0, pr * 0.05);
  ctx.restore();
}

// Malt den aktuellen Stand. b × h = Größe in CSS-Pixeln (das Canvas darf höher aufgelöst sein).
export function zeichne(ctx, sim, b, h) {
  ctx.clearRect(0, 0, b, h);
  // Studio-Hintergrund
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#1b2440'); bg.addColorStop(1, '#0d1222');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, b, h);
  const szPhase = sim.phase === 'sz';
  const t = szPhase ? sim.sz : sim.haupt;
  const cx = b / 2; const cy = h * 0.40;
  const R = Math.min(b * 0.42, h * 0.36);
  const m = R / HAUPT.R * (szPhase ? HAUPT.R / SUPER.R * 0.62 : 1); // Meter → Pixel
  const Rp = t.R * m;
  // Lichtkegel
  const licht = ctx.createRadialGradient(cx, cy - Rp * 0.3, Rp * 0.2, cx, cy, Rp * 1.6);
  licht.addColorStop(0, 'rgba(120,150,255,0.22)'); licht.addColorStop(1, 'rgba(120,150,255,0)');
  ctx.fillStyle = licht; ctx.fillRect(0, 0, b, h);
  // Trommel: Glas
  ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
  // Kugeln
  for (let i = 0; i < t.n; i++) {
    if (!t.drin[i]) continue;
    kugel(ctx, cx + t.x[i] * m, cy + t.y[i] * m, t.r * m, t.nummer[i], szPhase, (t.x[i] + t.y[i]) / t.r * 0.5);
  }
  // Mitnehmer
  const pr = t.r * 1.25;
  for (let k = 0; k < 4; k++) {
    const w = t.winkel + (k * Math.PI) / 2;
    ctx.beginPath(); ctx.arc(cx + (t.R - pr) * Math.cos(w) * m, cy + (t.R - pr) * Math.sin(w) * m, pr * m, 0, 2 * Math.PI);
    ctx.fillStyle = 'rgba(200,210,235,0.55)'; ctx.fill();
  }
  // Rand + Glanz + Auslass
  ctx.lineWidth = Math.max(3, Rp * 0.045); ctx.strokeStyle = '#c9d2e6';
  ctx.beginPath(); ctx.arc(cx, cy, Rp + ctx.lineWidth / 2, 0, 2 * Math.PI); ctx.stroke();
  ctx.lineWidth = Math.max(2, Rp * 0.03); ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.arc(cx, cy, Rp * 0.9, -2.3, -1.3); ctx.stroke();
  const ablageY = h * 0.885; const kr = Math.min(b / 17, h * 0.055);
  ctx.fillStyle = '#c9d2e6'; ctx.fillRect(cx - kr * 0.9, cy + Rp, kr * 1.8, Math.max(0, ablageY - kr * 1.8 - (cy + Rp)));
  // Ablage: 6 Plätze + Superzahl
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  const platzX = (k) => b / 2 + (k - 3) * kr * 2.35;
  const rund = (x, y, w, hh, rr) => { ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + hh, rr); ctx.arcTo(x + w, y + hh, x, y + hh, rr); ctx.arcTo(x, y + hh, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath(); };
  rund(platzX(0) - kr * 1.4, ablageY - kr * 1.4, kr * 2.35 * 6 + kr * 2.8, kr * 2.8, kr * 1.4); ctx.fill();
  const flug = (wann, jetzt) => Math.min(1, Math.max(0, (jetzt - wann) / 0.45));
  sim.haupt.gezogen.forEach((nr, k) => {
    const f = szPhase ? 1 : flug(sim.haupt.wann[k], sim.haupt.zeit);
    const sx = cx; const sy = cy + Rp;
    kugel(ctx, sx + (platzX(k) - sx) * f, sy + (ablageY - sy) * f * f, kr, nr, false);
  });
  if (sim.sz.gezogen.length) {
    const f = flug(sim.sz.wann[0], sim.sz.zeit);
    const sx = cx; const sy = cy + Rp;
    kugel(ctx, sx + (platzX(6) - sx) * f, sy + (ablageY - sy) * f * f, kr, sim.sz.gezogen[0], true);
  } else {
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.arc(platzX(6), ablageY, kr * 0.92, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  }
  // Beschriftung
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `600 ${Math.round(h * 0.036)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(szPhase ? 'Superzahl' : sim.phase === 'pause' ? '6 aus 49 – gezogen' : `6 aus 49 · Kugel ${Math.min(6, sim.haupt.gezogen.length + 1)}`, b / 2, h * 0.045);
}
