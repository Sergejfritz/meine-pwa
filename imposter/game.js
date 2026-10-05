(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const KEY = 'imposter.v2';
  const COLORS = ['#ff4d5e', '#ff8a3d', '#e6b422', '#12c95a', '#2ec4d6', '#6c8cff', '#a56cff', '#ff6cc4', '#8fd14f', '#e07a5f'];
  const FACES = window.IMPOSTER_FACES || [];        // eigene Gesichter (Fotos), optional
  const FACE_EMOJI = ['🕵️', '🤔', '😏', '🧐', '😎', '🤨'];
  const PTS = { civ: 5, imp: 15, guess: 15 };
  const ROLE = {
    civ: { name: 'Zivilist', cls: 'civ', emoji: '😇' },
    uc: { name: 'Imposter', cls: 'imp', emoji: '🕵️' },
    blind: { name: 'Imposter', cls: 'imp', emoji: '🕵️' },
    white: { name: 'Mr. White', cls: 'white', emoji: '🎩' },
  };

  // ---------- Wortlisten ----------
  const parseList = (str, catName) => str.split(/[;\n]/).map((x) => x.trim()).filter(Boolean).map((w) => {
    const [word, hint, uc] = w.split('|').map((p) => (p || '').trim());
    return { word, hint: hint || catName, uc: uc || '', cat: catName };
  }).filter((w) => w.word);
  const BUILTIN = window.IMPOSTER_CATEGORIES.map((c) => ({ ...c, list: c.mystery ? [] : parseList(c.words, c.name) }));

  // ---------- Persistenz ----------
  const defaults = {
    players: ['Spieler 1', 'Spieler 2', 'Spieler 3', 'Spieler 4'], avatars: {},
    impCount: 1, mode: 'classic', hint: false, draw: false, rounds: 5, timer: 180,
    cats: BUILTIN.filter((c) => !c.adult && !c.mystery).map((c) => c.id), customPacks: [],
    showCat: true, know: false, secretVote: false, guess: true, sound: true, music: true, vibrate: true, splash: true,
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* privat/blockiert */ }
  const S = Object.assign({}, defaults, saved.settings || {});
  let recent = saved.recent || [];
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ settings: S, recent })); } catch (e) { /* egal */ } };

  // ---------- Helfer ----------
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (a) => a[rnd(a.length)];
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = (name) => COLORS[Math.max(0, S.players.indexOf(name)) % COLORS.length];
  const faceOf = (name) => { const f = S.avatars[name]; return f === undefined ? (FACES.length ? S.players.indexOf(name) % FACES.length : -1) : f; };
  function avatar(name, cls = 'av') {
    const f = faceOf(name);
    if (f >= 0 && FACES[f]) return `<span class="${cls}" style="background:${color(name)} url('${FACES[f]}') center/cover"></span>`;
    return `<span class="${cls}" style="background:${color(name)}">${esc(name.trim().charAt(0).toUpperCase() || '?')}</span>`;
  }
  const allPacks = () => BUILTIN.concat(S.customPacks.map((p) => ({ id: p.id, name: p.name, icon: '✏️', custom: true, list: parseList(p.words, p.name) })));
  const maxImp = () => Math.max(1, Math.floor((S.players.length - 1) / 2));

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1900); }
  function buzz(ms) {
    if (!S.vibrate) return;
    try { if (window.AndroidBridge) window.AndroidBridge.vibrate(Array.isArray(ms) ? ms[0] : ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* egal */ }
  }
  let actx;
  function beep(freq = 880, dur = 0.15, delay = 0) {
    if (!S.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + delay;
      o.frequency.value = freq; o.type = 'triangle';
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
    } catch (e) { /* kein Audio */ }
  }
  function confirmBox(text, yes = 'OK') {
    return new Promise((res) => {
      $('#modalText').textContent = text; $('#modalYes').textContent = yes; $('#modal').hidden = false;
      const done = (v) => { $('#modal').hidden = true; $('#modalYes').onclick = $('#modalNo').onclick = null; res(v); };
      $('#modalYes').onclick = () => done(true); $('#modalNo').onclick = () => done(false);
    });
  }

  // ---------- Navigation ----------
  const stack = [];
  const GAME = ['s-reveal', 's-draw', 's-discuss', 's-vote', 's-elim', 's-guess'];
  function show(id, push = true) {
    const cur = $('.screen.active');
    if (cur && push && cur.id !== id) stack.push(cur.id);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    const sc = $('#' + id + ' .scroll'); if (sc) sc.scrollTop = 0;
  }
  function home() { stopTimer(); stack.length = 0; show('s-home', false); }
  function back() {
    if (!$('#modal').hidden) { $('#modalNo').click(); return true; }
    const cur = $('.screen.active').id;
    if (cur === 's-home') return false;
    if (GAME.includes(cur)) { quit(); return true; }
    if (cur === 's-result' || cur === 's-final') { home(); return true; }
    show(stack.pop() || 's-home', false);
    if (cur === 's-packs' || cur === 's-players') renderSetup();
    return true;
  }
  window.appBack = back; // Android-Zurück-Taste
  async function quit() { if (await confirmBox('Spiel abbrechen und zurück zum Menü?', 'Abbrechen')) home(); }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-back],[data-quit],[data-home],[data-help]'); if (!t) return;
    if (t.hasAttribute('data-back')) back();
    else if (t.hasAttribute('data-quit')) quit();
    else if (t.hasAttribute('data-home')) home();
    else openHelp();
  });

  // ---------- Setup ----------
  function renderSetup() {
    $$('.mode-card').forEach((m) => m.classList.toggle('on', m.dataset.mode === S.mode));
    $('#optDraw').checked = S.draw; $('#optHint').checked = S.hint;
    $('#playerCount').textContent = S.players.length;
    S.impCount = Math.min(S.impCount, maxImp());
    $('#impCount').textContent = S.mode === 'chaos' ? '?' : S.impCount;
    $('#impHint').textContent = S.mode === 'chaos' ? 'Chaos: zufällig' : S.mode === 'white' ? '+ 1 Mr. White' : `max. ${maxImp()} bei ${S.players.length} Spielern`;
    $$('#roundSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.r === S.rounds));
    $$('#timerSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.t === S.timer));
    const n = allPacks().filter((p) => S.cats.includes(p.id)).length;
    $('#packCount').textContent = n ? `${n} gewählt` : 'keins';
  }
  $('#modes').addEventListener('click', (e) => { const m = e.target.closest('.mode-card'); if (!m) return; S.mode = m.dataset.mode; buzz(10); renderSetup(); persist(); });
  $('#impMinus').onclick = () => { S.impCount = Math.max(1, S.impCount - 1); renderSetup(); persist(); };
  $('#impPlus').onclick = () => { if (S.impCount >= maxImp()) { toast('Für mehr Imposter braucht ihr mehr Spieler'); return; } S.impCount++; renderSetup(); persist(); };
  $('#roundSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.rounds = +b.dataset.r; renderSetup(); persist(); });
  $('#timerSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.timer = +b.dataset.t; renderSetup(); persist(); });
  $('#rowPlayers').onclick = () => { renderPlayers(); show('s-players'); };
  $('#rowPacks').onclick = $('#btnPacks').onclick = () => { renderPacks(); show('s-packs'); };
  const toggles = { optDraw: 'draw', optHint: 'hint', optShowCat: 'showCat', optKnow: 'know', optSecretVote: 'secretVote', optGuess: 'guess', optSound: 'sound', optVibrate: 'vibrate', optSplash: 'splash' };
  Object.entries(toggles).forEach(([id, key]) => {
    const el = $('#' + id); el.checked = !!S[key];
    el.addEventListener('change', () => { S[key] = el.checked; persist(); });
  });

  // ---------- Spieler ----------
  function renderPlayers() {
    const n = S.players.length;
    $('#playerList').innerHTML = S.players.map((p, i) => `
      <li><button class="face-btn" data-face="${i}" aria-label="Gesicht wechseln">${avatar(p)}</button>
      <span class="nm">${esc(p)}</span>
      <button class="mini" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Nach oben">▲</button>
      <button class="mini" data-down="${i}" ${i === n - 1 ? 'disabled' : ''} aria-label="Nach unten">▼</button>
      <button class="mini" data-del="${i}" aria-label="Entfernen">✕</button></li>`).join('');
    $('#playerCount2').textContent = n;
  }
  $('#playerList').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const P = S.players;
    if (b.dataset.del !== undefined) { if (P.length <= 3) { toast('Mindestens 3 Spieler'); return; } delete S.avatars[P[+b.dataset.del]]; P.splice(+b.dataset.del, 1); }
    else if (b.dataset.up !== undefined) { const i = +b.dataset.up; [P[i - 1], P[i]] = [P[i], P[i - 1]]; }
    else if (b.dataset.down !== undefined) { const i = +b.dataset.down; [P[i + 1], P[i]] = [P[i], P[i + 1]]; }
    else if (b.dataset.face !== undefined) {
      // Gesicht durchschalten: Fotos … dann Buchstabe
      const name = P[+b.dataset.face], cur = faceOf(name);
      S.avatars[name] = cur + 1 >= FACES.length ? -1 : cur + 1;
    }
    renderPlayers(); persist();
  });
  $('#addPlayerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#playerInput'), name = inp.value.trim();
    if (!name) return;
    if (S.players.some((p) => p.toLowerCase() === name.toLowerCase())) { toast('Den Namen gibt es schon'); return; }
    if (S.players.length >= 20) { toast('Maximal 20 Spieler'); return; }
    S.players.push(name); inp.value = ''; renderPlayers(); persist(); inp.focus();
  });
  $('#btnShuffle').onclick = () => { S.players = shuffle(S.players); renderPlayers(); persist(); buzz(15); };

  // ---------- Packs ----------
  function packCard(p) {
    const on = S.cats.includes(p.id);
    const tag = p.adult ? '<span class="tag">+18</span>' : p.mystery ? '<span class="tag new">Zufall</span>' : '';
    const sub = p.mystery ? 'Mix aus allen Packs' : `${p.list.length} Wörter`;
    return `<button class="pack ${on ? 'on' : ''} ${p.mystery ? 'mystery' : ''}" data-pack="${esc(p.id)}">${tag}<i class="check"></i>
      <span class="p-ico">${p.icon}</span><b>${esc(p.name)}</b><small>${sub}</small>
      ${p.custom ? `<span class="edit" data-edit="${esc(p.id)}">bearbeiten</span>` : ''}</button>`;
  }
  function renderPacks() {
    $('#packGrid').innerHTML = BUILTIN.map(packCard).join('');
    $('#customPacks').innerHTML = allPacks().filter((p) => p.custom).map(packCard).join('');
    const ids = allPacks().filter((p) => !p.adult).map((p) => p.id);
    $('#catAll').textContent = ids.every((id) => S.cats.includes(id)) ? 'Keine' : 'Alle';
  }
  async function togglePack(id) {
    const p = allPacks().find((x) => x.id === id);
    if (!S.cats.includes(id) && p.adult && !(await confirmBox('Dieses Pack enthält Begriffe nur für Erwachsene (18+). Aktivieren?', 'Ja, 18+'))) return;
    S.cats = S.cats.includes(id) ? S.cats.filter((x) => x !== id) : [...S.cats, id];
    renderPacks(); persist();
  }
  const onPackClick = (e) => {
    const ed = e.target.closest('[data-edit]'); if (ed) { e.stopPropagation(); editPack(ed.dataset.edit); return; }
    const b = e.target.closest('[data-pack]'); if (b) togglePack(b.dataset.pack);
  };
  $('#packGrid').addEventListener('click', onPackClick);
  $('#customPacks').addEventListener('click', onPackClick);
  $('#catAll').onclick = () => {
    const ids = allPacks().filter((p) => !p.adult).map((p) => p.id);
    const all = ids.every((id) => S.cats.includes(id));
    S.cats = all ? [] : Array.from(new Set([...S.cats, ...ids]));
    renderPacks(); persist();
  };
  let editing = null;
  function editPack(id) {
    editing = id ? S.customPacks.find((p) => p.id === id) : null;
    $('#packName').value = editing ? editing.name : '';
    $('#packWords').value = editing ? editing.words : '';
    $('#btnDelPack').style.visibility = editing ? '' : 'hidden';
    show('s-packedit');
  }
  $('#btnNewPack').onclick = () => editPack(null);
  $('#btnSavePack').onclick = () => {
    const name = $('#packName').value.trim() || 'Eigenes Pack';
    const words = $('#packWords').value.split(/[\n,;]/).map((w) => w.trim()).filter(Boolean).join('\n');
    if (parseList(words, name).length < 3) { toast('Bitte mindestens 3 Wörter eintragen'); return; }
    if (editing) Object.assign(editing, { name, words });
    else { const id = 'c' + Date.now(); S.customPacks.push({ id, name, words }); S.cats.push(id); }
    persist(); renderPacks(); back(); toast('Pack gespeichert');
  };
  $('#btnDelPack').onclick = async () => {
    if (!editing || !(await confirmBox(`Pack „${editing.name}“ löschen?`, 'Löschen'))) return;
    S.customPacks = S.customPacks.filter((p) => p !== editing); S.cats = S.cats.filter((c) => c !== editing.id);
    persist(); renderPacks(); back();
  };

  // ---------- Einstellungen / Hilfe ----------
  $('#btnSettings').onclick = () => show('s-settings');
  $('#btnResetWords').onclick = () => { recent = []; persist(); toast('Alle Wörter sind wieder im Spiel'); };
  function openHelp() { setHelp(S.mode); show('s-help'); }
  function setHelp(mode) {
    $$('#helpTabs button').forEach((b) => b.classList.toggle('on', b.dataset.h === mode));
    $$('[data-hm]').forEach((p) => { p.hidden = !p.dataset.hm.split(' ').includes(mode); });
  }
  $('#helpTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setHelp(b.dataset.h); });
  $('#btnHelpPlay').onclick = () => { stack.length = 0; renderSetup(); show('s-setup', false); };
  $('#btnNew').onclick = () => { renderSetup(); show('s-setup'); };

  // ---------- Spiel / Runde ----------
  let M = null; // Match über mehrere Runden
  let R = null; // aktuelle Runde

  function pool() {
    const packs = allPacks();
    const mystery = S.cats.includes('mystery');
    const chosen = packs.filter((p) => !p.mystery && (S.cats.includes(p.id) || (mystery && !p.adult)));
    return chosen.flatMap((p) => p.list.map((w) => ({ ...w, pack: p })));
  }
  function pickWord() {
    const all = pool();
    let fresh = all.filter((w) => !recent.includes(w.word));
    if (!fresh.length) { recent = recent.filter((r) => !all.some((w) => w.word === r)); fresh = all; }
    const w = { ...pick(fresh) };
    recent.push(w.word); if (recent.length > 400) recent.shift();
    if (!w.uc) { const others = w.pack.list.filter((x) => x.word !== w.word); w.uc = others.length ? pick(others).word : w.word; }
    return w;
  }

  function assignRoles() {
    const n = S.players.length, roles = {};
    const order = shuffle(S.players);
    let specials = [];
    if (S.mode === 'chaos') {
      const k = 1 + rnd(Math.max(1, Math.floor((n - 1) / 2)));
      specials = Array.from({ length: k }, () => pick(['uc', 'uc', 'blind', 'white']));
    } else {
      const k = Math.min(S.impCount, maxImp());
      specials = Array(k).fill(S.mode === 'blind' ? 'blind' : 'uc');
      if (S.mode === 'white') {
        if (k + 1 > maxImp() && k > 1) specials.pop(); // Platz für Mr. White schaffen
        specials.push('white');
      }
    }
    order.forEach((p, i) => { roles[p] = specials[i] || 'civ'; });
    return roles;
  }

  function startMatch() {
    if (S.players.length < 3) { toast('Mindestens 3 Spieler'); return; }
    if (!pool().length) { toast('Wähle mindestens ein Pack'); renderPacks(); show('s-packs'); return; }
    M = { round: 0, scores: Object.fromEntries(S.players.map((p) => [p, 0])) };
    startRound();
  }
  function startRound() {
    if (!pool().length) { toast('Wähle mindestens ein Pack'); return; }
    M.round++;
    R = {
      word: pickWord(), roles: assignRoles(), alive: S.players.slice(), out: [],
      idx: 0, seen: false, cycle: 0, strokes: [], guessed: [], votes: {}, voter: 0, sel: null, tie: false,
    };
    stack.length = 0;
    showReveal();
    show('s-reveal', false);
  }
  const nonCiv = (p) => R.roles[p] !== 'civ';
  const roundLabel = () => `Runde ${M.round}${S.rounds ? '/' + S.rounds : ''}`;

  // ---------- Aufdecken ----------
  function cardHTML(name) {
    const w = R.word, role = R.roles[name];
    const cat = S.showCat ? `<div class="meta">Kategorie: <b>${esc(w.cat)}</b></div>` : '';
    const sizeOf = (t) => (t.length > 14 ? ' xs' : t.length > 10 ? ' sm' : '');
    if (role === 'civ' || role === 'uc') {
      const word = role === 'uc' ? w.uc : w.word;
      return { cls: '', html: `<div class="role">Dein geheimes Wort</div><div class="word${sizeOf(word)}">${esc(word)}</div>${cat}` };
    }
    const hint = S.hint ? `<div class="meta">Hinweis: <b>${esc(w.hint)}</b></div>` : '';
    if (role === 'white') {
      return { cls: 'white', html: `<div class="big-emoji">🎩</div><div class="role">Du bist</div><div class="word">Mr. White</div><div class="meta">Du kennst das Wort nicht – bluffe!</div>${cat}${hint}` };
    }
    const mates = S.know ? S.players.filter((p) => p !== name && R.roles[p] === 'blind') : [];
    const team = mates.length ? `<div class="meta">Mit-Imposter: <b>${mates.map(esc).join(', ')}</b></div>` : '';
    return { cls: 'imp', html: `<div class="big-emoji">🕵️</div><div class="role">Du bist der</div><div class="word">IMPOSTER</div>${cat}${hint}${team}` };
  }
  function facesTrio(name) {
    const others = shuffle([...Array(Math.max(FACES.length, FACE_EMOJI.length)).keys()]);
    const own = faceOf(name);
    const mk = (i, cls) => (FACES.length ? `<span class="${cls}" style="background-image:url('${FACES[(i + FACES.length) % FACES.length]}')"></span>`
      : `<span class="${cls} emo">${FACE_EMOJI[i % FACE_EMOJI.length]}</span>`);
    const mid = own >= 0 ? own : others[0];
    const side = others.filter((i) => i % (FACES.length || FACE_EMOJI.length) !== mid % (FACES.length || FACE_EMOJI.length));
    return `<div class="trio">${mk(side[0] ?? 1, 'tf l')}${mk(mid, 'tf c')}${mk(side[1] ?? 2, 'tf r')}</div>`;
  }
  function showReveal() {
    const name = S.players[R.idx];
    $('#revealName').textContent = name;
    $('#revealName').style.color = color(name);
    $('#revealProgress').textContent = `${roundLabel()} · Spieler ${R.idx + 1}/${S.players.length}`;
    $('#cardFront').innerHTML = `${facesTrio(name)}<b>Gedrückt halten</b><small>oder hochwischen, um dein Wort zu sehen.<br>Halte dich von Impostern fern! 👀</small>`;
    const c = cardHTML(name);
    $('#cardBack').innerHTML = c.html;
    $('#cardBack').className = 'face back ' + c.cls;
    $('#flipCard').classList.remove('open');
    R.seen = false;
    $('#btnNextPlayer').disabled = true;
    $('#btnNextPlayer').textContent = R.idx === S.players.length - 1 ? 'Alle bereit – los!' : 'Weiter';
  }
  const card = $('#flipCard');
  const open = (e) => { if (e) e.preventDefault(); if (!R) return; card.classList.add('open'); if (!R.seen) buzz(30); R.seen = true; };
  const close = () => { card.classList.remove('open'); if (R && R.seen) $('#btnNextPlayer').disabled = false; };
  card.addEventListener('pointerdown', open);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => card.addEventListener(ev, close));
  card.addEventListener('contextmenu', (e) => e.preventDefault());
  card.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') open(e); });
  card.addEventListener('keyup', close);
  card.tabIndex = 0;
  $('#btnNextPlayer').onclick = () => {
    if (R.idx < S.players.length - 1) { R.idx++; showReveal(); buzz(15); }
    else nextCycle();
  };

  // ---------- Hinweis-Runde (Zeichnen oder Reden) ----------
  function nextCycle() {
    R.cycle++;
    R.starter = pick(R.alive);
    R.dirCw = Math.random() < 0.5;
    if (S.draw) startDraw(); else startDiscuss();
  }
  function turnOrder() {
    const i = R.alive.indexOf(R.starter), a = R.alive.slice(i).concat(R.alive.slice(0, i));
    return R.dirCw ? a : [a[0], ...a.slice(1).reverse()];
  }

  // Zeichnen
  const cv = $('#canvas'), ctx = cv.getContext('2d');
  let drawer = 0, drawOrder = [], curStroke = null;
  function startDraw() {
    drawOrder = turnOrder(); drawer = 0;
    show('s-draw', false);
    requestAnimationFrame(() => { sizeCanvas(); setDrawer(); });
  }
  function setDrawer() {
    const p = drawOrder[drawer];
    $('#drawTitle').textContent = `${roundLabel()} · Zeichnen ${drawer + 1}/${drawOrder.length}`;
    $('#drawWho').innerHTML = `<b style="color:${color(p)}">${esc(p)}</b> malt einen Hinweis – nicht zu deutlich!`;
    $('#btnDrawDone').textContent = drawer < drawOrder.length - 1 ? `Fertig – weiter an ${drawOrder[drawer + 1]}` : 'Fertig – zur Diskussion';
  }
  function sizeCanvas() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d);
    redraw();
  }
  function redraw(target = ctx, w = cv.width, h = cv.height) {
    target.fillStyle = '#fff'; target.fillRect(0, 0, w, h);
    target.lineCap = target.lineJoin = 'round';
    R.strokes.forEach((s) => {
      target.strokeStyle = s.color; target.lineWidth = Math.max(3, w * 0.012);
      target.beginPath();
      s.pts.forEach(([x, y], i) => (i ? target.lineTo(x * w, y * h) : target.moveTo(x * w, y * h)));
      if (s.pts.length === 1) target.lineTo(s.pts[0][0] * w + 0.1, s.pts[0][1] * h);
      target.stroke();
    });
  }
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    curStroke = { color: color(drawOrder[drawer]), pts: [pt(e)], by: drawer };
    R.strokes.push(curStroke); redraw();
  });
  cv.addEventListener('pointermove', (e) => { if (!curStroke) return; curStroke.pts.push(pt(e)); redraw(); });
  ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { curStroke = null; }));
  $('#btnUndo').onclick = () => {
    for (let i = R.strokes.length - 1; i >= 0; i--) if (R.strokes[i].by === drawer && R.strokes[i].cycle === undefined) { R.strokes.splice(i, 1); break; }
    redraw();
  };
  $('#btnDrawDone').onclick = () => {
    R.strokes.forEach((s) => { if (s.by === drawer && s.cycle === undefined) s.cycle = R.cycle; });
    if (drawer < drawOrder.length - 1) { drawer++; setDrawer(); buzz(15); return; }
    const off = document.createElement('canvas'); off.width = 600; off.height = Math.round(600 * cv.height / cv.width) || 600;
    redraw(off.getContext('2d'), off.width, off.height);
    R.drawing = off.toDataURL('image/png');
    startDiscuss();
  };
  window.addEventListener('resize', () => { if ($('#s-draw').classList.contains('active')) sizeCanvas(); });

  // Diskussion
  let tLeft = 0, tTotal = 0, tInt = null, paused = false;
  const CIRC = 2 * Math.PI * 52;
  function startDiscuss() {
    $('#discussTitle').textContent = `${roundLabel()} · Durchgang ${R.cycle}`;
    $('#discussCat').textContent = S.showCat ? `Kategorie: ${R.word.cat}` : (S.draw ? 'Wer hat komisch gemalt?' : 'Jeder sagt reihum ein Wort');
    $('#starter').innerHTML = `<span style="color:${color(R.starter)}">${esc(R.starter)}</span> beginnt`;
    $('#direction').textContent = S.draw ? 'Besprecht die Zeichnung!' : `Weiter ${R.dirCw ? 'im Uhrzeigersinn ↻' : 'gegen den Uhrzeigersinn ↺'} · ${turnOrder().join(' → ')}`;
    const img = $('#drawingImg');
    img.hidden = !(S.draw && R.drawing); if (S.draw && R.drawing) img.src = R.drawing;
    $('#s-discuss').classList.toggle('has-drawing', !!(S.draw && R.drawing));
    $('#aliveInfo').textContent = `Noch im Spiel: ${R.alive.length} · Eliminiert: ${R.out.length ? R.out.join(', ') : 'niemand'}`;
    tTotal = tLeft = S.timer; paused = false;
    $('#btnPause').textContent = '⏸ Pause';
    $('#timerWrap').style.display = S.timer ? '' : 'none';
    $('#timerBtns').style.display = S.timer ? '' : 'none';
    $('#timerWrap').classList.remove('done', 'low');
    $('#timerProg').style.strokeDasharray = CIRC;
    drawTimer();
    stopTimer();
    if (S.timer) tInt = setInterval(tick, 1000);
    show('s-discuss', false);
    beep(660, 0.12); beep(990, 0.18, 0.13);
  }
  function drawTimer() {
    const m = Math.floor(tLeft / 60), s = tLeft % 60;
    $('#timerText').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('#timerProg').style.strokeDashoffset = tTotal ? CIRC * (1 - tLeft / tTotal) : 0;
    $('#timerWrap').classList.toggle('low', tLeft <= 10);
  }
  function tick() {
    if (paused) return;
    tLeft = Math.max(0, tLeft - 1); drawTimer();
    if (tLeft <= 5 && tLeft > 0) beep(700, 0.08);
    if (tLeft === 0) {
      stopTimer(); $('#timerWrap').classList.add('done');
      beep(440, 0.4); beep(440, 0.4, 0.5); buzz([300, 100, 300]);
      toast('Zeit ist um – abstimmen!');
    }
  }
  function stopTimer() { clearInterval(tInt); tInt = null; }
  $('#btnPause').onclick = () => { paused = !paused; $('#btnPause').textContent = paused ? '▶ Weiter' : '⏸ Pause'; };
  $('#btnPlus30').onclick = () => {
    tLeft += 30; tTotal = Math.max(tTotal, tLeft); $('#timerWrap').classList.remove('done');
    if (!tInt) tInt = setInterval(tick, 1000);
    drawTimer();
  };
  $('#btnToVote').onclick = () => { stopTimer(); startVote(); };

  // ---------- Abstimmung ----------
  $('#btnClaim').onclick = () => {
    stopTimer();
    R.claim = true; R.sel = null; R.tie = false; R.candidates = R.alive.slice();
    renderVote(); show('s-vote', false);
  };
  function startVote() {
    R.claim = false;
    R.votes = {}; R.voter = 0; R.sel = null; R.tie = false; R.candidates = R.alive.slice();
    renderVote(); show('s-vote', false);
  }
  function renderVote() {
    if (R.claim) {
      $('#voteTitle').textContent = 'Wort raten';
      $('#voteSub').innerHTML = 'Wer will raten? Tippe auf deinen Namen.<br><small>Richtig = Sieg · Falsch = du bist raus</small>';
      $('#voteGrid').innerHTML = R.candidates.map((p) => `<button class="vote-btn ${R.sel === p ? 'on' : ''}" data-p="${esc(p)}">${avatar(p)}${esc(p)}</button>`).join('');
      $('#btnVote').disabled = !R.sel; $('#btnVote').textContent = 'Ich rate!';
      return;
    }
    const secret = S.secretVote && !R.tie;
    const voter = secret ? R.alive[R.voter] : null;
    $('#voteTitle').textContent = R.tie ? 'Stichwahl' : secret ? `Geheime Wahl ${R.voter + 1}/${R.alive.length}` : 'Abstimmung';
    $('#voteSub').innerHTML = R.tie ? 'Gleichstand! Einigt euch auf einen:' :
      secret ? `<b style="color:${color(voter)}">${esc(voter)}</b>, wen verdächtigst du?<br><small>Die anderen schauen weg!</small>` : 'Stimmt als Gruppe ab: Wer soll eliminiert werden?';
    $('#voteGrid').innerHTML = R.candidates.filter((p) => p !== voter).map((p) => `
      <button class="vote-btn ${R.sel === p ? 'on' : ''}" data-p="${esc(p)}">${avatar(p)}${esc(p)}</button>`).join('');
    $('#btnVote').disabled = !R.sel;
    $('#btnVote').textContent = secret ? (R.voter < R.alive.length - 1 ? 'Stimme abgeben & weitergeben' : 'Letzte Stimme abgeben') : 'Eliminieren';
  }
  $('#voteGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    R.sel = b.dataset.p; buzz(10); renderVote();
  });
  $('#btnVote').onclick = () => {
    if (!R.sel) return;
    if (R.claim) {
      const p = R.sel; R.claim = false;
      if (!nonCiv(p)) { toast('Du bist kein Imposter – zurück zur Diskussion!'); show('s-discuss', false); if (S.timer && tLeft > 0) tInt = setInterval(tick, 1000); return; }
      R.claimer = p; R.last = p;
      return startGuess(p);
    }
    if (S.secretVote && !R.tie) {
      R.votes[R.sel] = (R.votes[R.sel] || 0) + 1; R.sel = null;
      if (R.voter < R.alive.length - 1) { R.voter++; renderVote(); toast('Stimme gespeichert'); return; }
      const max = Math.max(...Object.values(R.votes));
      const top = Object.keys(R.votes).filter((p) => R.votes[p] === max);
      if (top.length > 1) { R.tie = true; R.candidates = top; renderVote(); return; }
      return eliminate(top[0]);
    }
    eliminate(R.sel);
  };

  // ---------- Eliminierung ----------
  function eliminate(name) {
    R.alive = R.alive.filter((p) => p !== name); R.out.push(name); R.last = name;
    const role = ROLE[R.roles[name]];
    $('#elimAv').outerHTML = `<div class="elim-av" id="elimAv">${avatar(name, 'elim-face')}</div>`;
    $('#elimName').textContent = name;
    $('#elimRole').className = 'role-reveal ' + role.cls;
    const extra = R.roles[name] === 'uc' ? `<small>Sein Wort war „${esc(R.word.uc)}“</small>` : '';
    $('#elimRole').innerHTML = `${role.emoji} ${role.name}${extra}`;
    show('s-elim', false);
    if (nonCiv(name)) { beep(523, 0.15); beep(784, 0.25, 0.15); buzz(60); } else { beep(330, 0.3); buzz([80, 60, 80]); }
  }
  $('#btnElimNext').onclick = () => {
    const name = R.last;
    if (nonCiv(name) && S.guess && !R.guessed.includes(name)) return startGuess(name);
    checkEnd();
  };
  function checkEnd() {
    const nc = R.alive.filter(nonCiv).length, civ = R.alive.length - nc;
    if (nc === 0) return finishRound('civ');
    if (civ <= 1) return finishRound('imp');
    nextCycle();
  }
  function startGuess(name) {
    R.guessed.push(name);
    $('#guessName').textContent = name;
    const w = R.word;
    const src = shuffle(w.pack.list.map((x) => x.word).filter((x) => x !== w.word && x !== w.uc));
    const opts = shuffle([w.word, ...(w.uc && w.uc !== w.word ? [w.uc] : []), ...src].slice(0, 8));
    if (!opts.includes(w.word)) opts[rnd(opts.length)] = w.word;
    $('#guessGrid').innerHTML = opts.map((o) => `<button class="vote-btn" data-g="${esc(o)}">${esc(o)}</button>`).join('');
    show('s-guess', false);
  }
  $('#guessGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    if (b.dataset.g === R.word.word) { R.claimer = null; finishRound('guess'); return; }
    toast('Falsch geraten!'); buzz([60, 40, 60]);
    if (R.claimer) { const p = R.claimer; R.claimer = null; eliminate(p); return; }
    checkEnd();
  });

  // ---------- Rundenende ----------
  function finishRound(outcome) {
    stopTimer();
    const delta = Object.fromEntries(S.players.map((p) => [p, 0]));
    if (outcome === 'civ') S.players.filter((p) => !nonCiv(p)).forEach((p) => { delta[p] = PTS.civ; });
    else if (outcome === 'imp') S.players.filter(nonCiv).forEach((p) => { delta[p] = PTS.imp; });
    else delta[R.last] = PTS.guess;
    S.players.forEach((p) => { M.scores[p] = (M.scores[p] || 0) + delta[p]; });
    persist();

    const t = {
      civ: ['🎉', 'Zivilisten gewinnen!', 'Alle Imposter wurden enttarnt.'],
      imp: ['🕵️', 'Imposter gewinnen!', 'Es ist nur noch ein Zivilist übrig.'],
      guess: ['🧠', `${esc(R.last)} gewinnt!`, 'Erwischt – aber das Wort richtig geraten.'],
    }[outcome];
    $('#resultHero').className = 'result-hero ' + (outcome === 'civ' ? 'crew' : 'imp');
    $('#resultHero').innerHTML = `<div class="em">${t[0]}</div><h1>${t[1]}</h1><p>${t[2]}</p>`;
    $('#resWord').textContent = R.word.word;
    const anyUc = S.players.some((p) => R.roles[p] === 'uc');
    $('#resUcRow').style.display = anyUc ? '' : 'none';
    $('#resUcWord').textContent = R.word.uc;
    $('#resRoles').innerHTML = `<div class="roles-row">${S.players.map((p) => {
      const r = ROLE[R.roles[p]];
      return `<span class="rchip ${r.cls} ${R.out.includes(p) ? 'dead' : ''}">${r.emoji} ${esc(p)}</span>`;
    }).join('')}</div>`;
    $('#scoreTitle').textContent = `Punktestand nach ${roundLabel()}`;
    $('#scoreList').innerHTML = ranking().map((p) => `
      <li>${avatar(p)}<span class="nm">${esc(p)}</span><span class="delta">${delta[p] ? '+' + delta[p] : ''}</span><span class="pts">${M.scores[p]}</span></li>`).join('');
    const last = S.rounds && M.round >= S.rounds;
    $('#btnNextRound').textContent = last ? 'Endergebnis 🏆' : 'Nächste Runde';
    show('s-result', false);
    if (outcome === 'civ') { beep(523, 0.15); beep(659, 0.15, 0.15); beep(784, 0.3, 0.3); } else { beep(392, 0.2); beep(311, 0.4, 0.2); }
    buzz(80);
  }
  const ranking = () => S.players.slice().sort((a, b) => M.scores[b] - M.scores[a]);
  $('#btnNextRound').onclick = () => (S.rounds && M.round >= S.rounds ? showFinal() : startRound());
  $('#btnEndGame').onclick = async () => { if (await confirmBox('Spiel jetzt beenden und Endergebnis zeigen?', 'Beenden')) showFinal(); };

  function showFinal() {
    const r = ranking(), best = M.scores[r[0]];
    const winners = r.filter((p) => M.scores[p] === best);
    $('#finalWinner').textContent = winners.length > 1 ? 'Unentschieden!' : `${r[0]} gewinnt!`;
    $('#finalSub').textContent = `${winners.join(' & ')} mit ${best} Punkten nach ${M.round} ${M.round === 1 ? 'Runde' : 'Runden'}`;
    const podium = [r[1], r[0], r[2]].map((p, i) => (p ? `<div class="p${[2, 1, 3][i]}">${avatar(p)}<span class="nm">${esc(p)}</span><div class="block">${[2, 1, 3][i]}</div></div>` : '<div></div>'));
    $('#podium').innerHTML = podium.join('');
    $('#finalList').innerHTML = r.map((p) => `<li>${avatar(p)}<span class="nm">${esc(p)}</span><span class="pts">${M.scores[p]}</span></li>`).join('');
    show('s-final', false);
    [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.2, i * 0.14)); buzz([100, 60, 100, 60, 200]);
  }
  $('#btnRematch').onclick = startMatch;
  $('#btnStart').onclick = startMatch;

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });

  // ---------- Hintergrundmusik (Endlosschleife) ----------
  const music = new Audio('music.mp3');
  music.loop = true; music.volume = 0.45;
  let musicOk = true;
  music.addEventListener('error', () => { musicOk = false; $('#btnMusic').hidden = true; });
  function playMusic() { if (S.music && musicOk && !document.hidden) music.play().catch(() => { /* wartet auf ersten Tipp */ }); }
  function updateMusic() { if (S.music) playMusic(); else music.pause(); $('#btnMusic').textContent = S.music ? '🔊' : '🔇'; $('#optMusic').checked = S.music; }
  $('#btnMusic').onclick = () => { S.music = !S.music; persist(); updateMusic(); };
  $('#optMusic').addEventListener('change', () => { S.music = $('#optMusic').checked; persist(); updateMusic(); });
  document.addEventListener('visibilitychange', () => (document.hidden ? music.pause() : playMusic()));
  // Browser erlauben Ton oft erst nach dem ersten Tippen
  document.addEventListener('pointerdown', () => { if (S.music && music.paused) playMusic(); }, { capture: true });
  updateMusic();

  // ---------- Startbildschirm mit Logo ----------
  const splash = $('#splash');
  const hideSplash = () => { if (!splash.isConnected) return; splash.classList.add('hide'); setTimeout(() => splash.remove(), 600); };
  if (!S.splash) splash.remove();
  else { splash.addEventListener('click', hideSplash); setTimeout(hideSplash, 3200); }
})();
