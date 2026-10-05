(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const CATS = window.IMPOSTER_CATEGORIES.map((c) => ({
    ...c,
    list: c.words.split(';').map((w) => { const [word, hint, uc] = w.split('|'); return { word, hint, uc, cat: c.name }; }),
  }));
  const COLORS = ['#ff4d5e', '#ff8a3d', '#f5c542', '#3ddc97', '#2ec4d6', '#6c8cff', '#a56cff', '#ff6cc4', '#8fd14f', '#e07a5f'];
  const KEY = 'imposter.v1';

  // ---------- Persistenz ----------
  const defaults = {
    players: ['Spieler 1', 'Spieler 2', 'Spieler 3', 'Spieler 4'],
    impCount: 1, randomImp: false, know: false, mode: 'hint', showCat: true,
    cats: CATS.map((c) => c.id), custom: '', timer: 120, secretVote: false, guess: true, sound: true,
  };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* privat/blockiert */ }
  const S = Object.assign({}, defaults, saved.settings || {});
  let scores = saved.scores || {};
  let recent = saved.recent || [];
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ settings: S, scores, recent })); } catch (e) { /* egal */ } };

  // ---------- Helfer ----------
  const rnd = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const color = (name) => COLORS[S.players.indexOf(name) % COLORS.length] || COLORS[0];
  const initial = (n) => esc(n.trim().charAt(0).toUpperCase() || '?');
  const maxImp = () => Math.max(1, S.players.length - 2);

  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); }
  function buzz(ms) {
    if (!S.sound) return;
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
  function confirmBox(text) {
    return new Promise((res) => {
      $('#modalText').textContent = text; $('#modal').hidden = false;
      const done = (v) => { $('#modal').hidden = true; $('#modalYes').onclick = $('#modalNo').onclick = null; res(v); };
      $('#modalYes').onclick = () => done(true); $('#modalNo').onclick = () => done(false);
    });
  }

  // ---------- Navigation ----------
  const history = [];
  function show(id, push = true) {
    const cur = $('.screen.active');
    if (cur && push && cur.id !== id) history.push(cur.id);
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function back() {
    if (!$('#modal').hidden) { $('#modalNo').click(); return true; }
    const cur = $('.screen.active').id;
    if (cur === 's-home') return false;
    if (['s-reveal', 's-discuss', 's-vote', 's-guess'].includes(cur)) { quit(); return true; }
    if (cur === 's-result') { history.length = 0; show('s-home', false); return true; }
    show(history.pop() || 's-home', false);
    return true;
  }
  window.appBack = back; // wird von der Android-App beim Zurück-Knopf aufgerufen
  async function quit() {
    if (await confirmBox('Runde abbrechen und zurück zum Menü?')) { stopTimer(); history.length = 0; show('s-home', false); }
  }
  $$('[data-back]').forEach((b) => b.addEventListener('click', back));
  $$('[data-quit]').forEach((b) => b.addEventListener('click', quit));

  // ---------- Setup ----------
  function renderPlayers() {
    $('#playerList').innerHTML = S.players.map((p, i) => `
      <li><span class="av" style="background:${COLORS[i % COLORS.length]}">${initial(p)}</span>
      <span class="nm">${esc(p)}</span><button class="x" data-del="${i}" aria-label="Entfernen">✕</button></li>`).join('');
    $('#playerCount').textContent = S.players.length;
    S.impCount = Math.min(S.impCount, maxImp());
    renderImp();
  }
  function renderImp() {
    $('#impCount').textContent = S.impCount;
    const n = S.players.length;
    $('#impHint').textContent = n < 3 ? 'mind. 3 Spieler' : S.impCount > 1 && S.impCount > n / 3 ? 'viele Imposter – chaotisch!' : `bei ${n} Spielern`;
  }
  $('#playerList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    S.players.splice(+b.dataset.del, 1); renderPlayers(); persist();
  });
  $('#addPlayerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#playerInput'), name = inp.value.trim();
    if (!name) return;
    if (S.players.some((p) => p.toLowerCase() === name.toLowerCase())) { toast('Name gibt es schon'); return; }
    if (S.players.length >= 20) { toast('Maximal 20 Spieler'); return; }
    S.players.push(name); inp.value = ''; renderPlayers(); persist(); inp.focus();
  });
  $('#impMinus').onclick = () => { S.impCount = Math.max(1, S.impCount - 1); renderImp(); persist(); };
  $('#impPlus').onclick = () => { if (S.impCount >= maxImp()) { toast('Mehr Imposter gehen bei so wenigen Spielern nicht'); return; } S.impCount++; renderImp(); persist(); };

  function renderModes() { $$('.mode').forEach((m) => m.classList.toggle('on', m.dataset.mode === S.mode)); }
  $('#modes').addEventListener('click', (e) => { const m = e.target.closest('.mode'); if (!m) return; S.mode = m.dataset.mode; renderModes(); persist(); });

  function renderCats() {
    $('#catChips').innerHTML = CATS.map((c) => `<button class="chip ${S.cats.includes(c.id) ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('');
    $('#catAll').textContent = S.cats.length === CATS.length ? 'Keine' : 'Alle';
  }
  $('#catChips').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (!c) return;
    const id = c.dataset.cat;
    S.cats = S.cats.includes(id) ? S.cats.filter((x) => x !== id) : [...S.cats, id];
    renderCats(); persist();
  });
  $('#catAll').onclick = () => { S.cats = S.cats.length === CATS.length ? [] : CATS.map((c) => c.id); renderCats(); persist(); };
  $('#customWords').addEventListener('input', (e) => { S.custom = e.target.value; persist(); });

  function renderTimer() { $$('#timerSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.t === S.timer)); }
  $('#timerSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.timer = +b.dataset.t; renderTimer(); persist(); });

  const toggles = { optRandomImp: 'randomImp', optKnow: 'know', optShowCat: 'showCat', optSecretVote: 'secretVote', optGuess: 'guess', optSound: 'sound' };
  Object.entries(toggles).forEach(([id, key]) => {
    const el = $('#' + id); el.checked = !!S[key];
    el.addEventListener('change', () => { S[key] = el.checked; persist(); });
  });

  function renderSetup() { renderPlayers(); renderModes(); renderCats(); renderTimer(); $('#customWords').value = S.custom; }

  // ---------- Runde ----------
  let R = null;

  function customList() {
    return S.custom.split(/[,;\n]/).map((w) => w.trim()).filter(Boolean)
      .map((w) => ({ word: w, hint: 'Eigene Wörter', uc: null, cat: 'Eigene Wörter', custom: true }));
  }
  function pool() {
    return CATS.filter((c) => S.cats.includes(c.id)).flatMap((c) => c.list).concat(customList());
  }
  function pickWord() {
    const all = pool();
    let fresh = all.filter((w) => !recent.includes(w.word));
    if (!fresh.length) { recent = []; fresh = all; }
    const w = fresh[rnd(fresh.length)];
    recent.push(w.word); if (recent.length > 150) recent.shift();
    if (w.custom && !w.uc) {
      const others = customList().filter((x) => x.word !== w.word);
      w.uc = others.length ? others[rnd(others.length)].word : '???';
    }
    return w;
  }

  function startRound() {
    if (S.players.length < 3) { toast('Mindestens 3 Spieler'); return; }
    if (!pool().length) { toast('Wähle mindestens eine Kategorie'); return; }
    const n = S.impCount > maxImp() ? maxImp() : S.impCount;
    const count = S.randomImp ? 1 + rnd(n) : n;
    const w = pickWord();
    const imps = shuffle(S.players).slice(0, count);
    const crew = S.players.filter((p) => !imps.includes(p));
    R = {
      word: w, imps, crew, idx: 0, seen: false,
      starter: (S.mode === 'undercover' ? S.players : crew)[rnd(S.mode === 'undercover' ? S.players.length : crew.length)],
      dir: Math.random() < 0.5 ? 'im Uhrzeigersinn ↻' : 'gegen den Uhrzeigersinn ↺',
      votes: {}, voter: 0, sel: null,
    };
    history.length = 0;
    showReveal();
    show('s-reveal', false);
  }

  function cardHTML(name) {
    const w = R.word, isImp = R.imps.includes(name);
    const cat = S.showCat ? `<div class="meta">Kategorie: <b>${esc(w.cat)}</b></div>` : '';
    if (!isImp || S.mode === 'undercover') {
      const word = isImp ? w.uc : w.word;
      const size = word.length > 14 ? ' xs' : word.length > 10 ? ' sm' : '';
      return { imp: false, html: `<div class="role">Dein geheimes Wort</div><div class="word${size}">${esc(word)}</div>${cat}` };
    }
    let extra = '';
    if (S.mode === 'hint') extra += `<div class="meta">Hinweis: <b>${esc(w.hint)}</b></div>`;
    if (S.know && R.imps.length > 1) extra += `<div class="meta">Mit-Imposter: <b>${R.imps.filter((p) => p !== name).map(esc).join(', ')}</b></div>`;
    return { imp: true, html: `<div class="big-emoji">🕵️</div><div class="role">Du bist der</div><div class="word">IMPOSTER</div>${cat}${extra}` };
  }

  function showReveal() {
    const name = S.players[R.idx];
    $('#revealName').textContent = name;
    $('#revealName').style.color = color(name);
    $('#revealProgress').textContent = `Spieler ${R.idx + 1} von ${S.players.length}`;
    const c = cardHTML(name);
    $('#cardBack').innerHTML = c.html;
    $('#cardBack').classList.toggle('imp', c.imp);
    $('#flipCard').classList.remove('open');
    R.seen = false;
    $('#btnNextPlayer').disabled = true;
    $('#btnNextPlayer').textContent = R.idx === S.players.length - 1 ? 'Alle bereit – Start!' : 'Weiter';
  }

  // Gedrückt halten zum Aufdecken
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
    else startDiscuss();
  };

  // ---------- Diskussion ----------
  let tLeft = 0, tTotal = 0, tInt = null, paused = false;
  const CIRC = 2 * Math.PI * 52;
  function startDiscuss() {
    $('#discussCat').textContent = S.showCat ? `Kategorie: ${R.word.cat}` : 'Jeder sagt reihum ein Wort';
    $('#starter').innerHTML = `<span style="color:${color(R.starter)}">${esc(R.starter)}</span> beginnt`;
    $('#direction').textContent = `Weiter ${R.dir} · jeder sagt ein passendes Wort`;
    tTotal = tLeft = S.timer; paused = false;
    $('#btnPause').textContent = '⏸ Pause';
    $('#timerWrap').style.display = S.timer ? '' : 'none';
    $('#btnPause').parentElement.style.display = S.timer ? '' : 'none';
    $('#timerWrap').classList.remove('done', 'low');
    drawTimer();
    stopTimer();
    if (S.timer) tInt = setInterval(tick, 1000);
    show('s-discuss', false);
    beep(660, 0.12); beep(990, 0.18, 0.13);
  }
  function drawTimer() {
    const m = Math.floor(tLeft / 60), s = tLeft % 60;
    $('#timerText').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('#timerProg').style.strokeDasharray = CIRC;
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
  function startVote() {
    R.votes = {}; R.voter = 0; R.sel = null; R.candidates = S.players.slice();
    renderVote(); show('s-vote', false);
  }
  function renderVote() {
    const secret = S.secretVote && !R.tie;
    const voter = secret ? S.players[R.voter] : null;
    $('#voteTitle').textContent = R.tie ? 'Stichwahl' : secret ? `Geheime Wahl ${R.voter + 1}/${S.players.length}` : 'Abstimmung';
    $('#voteSub').innerHTML = R.tie ? 'Gleichstand! Einigt euch auf einen:' :
      secret ? `<b style="color:${color(voter)}">${esc(voter)}</b>, wen verdächtigst du? <br><small>Die anderen schauen weg!</small>` : 'Einigt euch: Wer ist der Imposter?';
    $('#voteGrid').innerHTML = R.candidates.filter((p) => p !== voter).map((p) => `
      <button class="vote-btn ${R.sel === p ? 'on' : ''}" data-p="${esc(p)}">
        <span class="av" style="background:${color(p)}">${initial(p)}</span>${esc(p)}</button>`).join('');
    $('#btnVote').disabled = !R.sel;
    $('#btnVote').textContent = secret ? (R.voter < S.players.length - 1 ? 'Stimme abgeben & weitergeben' : 'Letzte Stimme abgeben') : 'Beschuldigen';
  }
  $('#voteGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    R.sel = b.dataset.p; buzz(10); renderVote();
  });
  $('#btnVote').onclick = () => {
    if (!R.sel) return;
    if (S.secretVote && !R.tie) {
      R.votes[R.sel] = (R.votes[R.sel] || 0) + 1; R.sel = null;
      if (R.voter < S.players.length - 1) { R.voter++; renderVote(); toast('Stimme gespeichert'); return; }
      const max = Math.max(...Object.values(R.votes));
      const top = Object.keys(R.votes).filter((p) => R.votes[p] === max);
      if (top.length > 1) { R.tie = true; R.candidates = top; renderVote(); return; }
      return accuse(top[0]);
    }
    accuse(R.sel);
  };

  // ---------- Auflösung ----------
  function accuse(name) {
    R.accused = name; R.tie = false;
    const caught = R.imps.includes(name);
    if (caught && S.guess) return startGuess(name);
    finish(caught ? 'crew' : 'imp');
  }
  function startGuess(name) {
    $('#guessName').textContent = name;
    const w = R.word;
    const cat = CATS.find((c) => c.name === w.cat);
    const src = (cat ? cat.list.map((x) => x.word) : customList().map((x) => x.word)).filter((x) => x !== w.word && x !== w.uc);
    const opts = shuffle([w.word, ...(S.mode === 'undercover' && w.uc ? [w.uc] : []), ...shuffle(src).slice(0, S.mode === 'undercover' ? 6 : 7)]);
    $('#guessGrid').innerHTML = opts.map((o) => `<button class="vote-btn" data-g="${esc(o)}">${esc(o)}</button>`).join('');
    show('s-guess', false);
  }
  $('#guessGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]'); if (!b) return;
    finish(b.dataset.g === R.word.word ? 'guessed' : 'crew');
  });

  function finish(outcome) {
    const delta = {};
    S.players.forEach((p) => { delta[p] = 0; });
    if (outcome === 'crew') R.crew.forEach((p) => { delta[p] = 1; });
    else if (outcome === 'imp') R.imps.forEach((p) => { delta[p] = 2; });
    else delta[R.accused] = 1;
    S.players.forEach((p) => { scores[p] = (scores[p] || 0) + delta[p]; });
    persist();

    const hero = $('#resultHero');
    const impWord = R.imps.length > 1 ? 'Die Imposter' : 'Der Imposter';
    const t = {
      crew: ['🎉', 'Crew gewinnt!', `${esc(R.accused)} war ${R.imps.length > 1 ? 'ein' : 'der'} Imposter.`],
      imp: ['🕵️', 'Imposter gewinnt!', `${esc(R.accused)} war unschuldig. ${impWord} ${R.imps.length > 1 ? 'bleiben' : 'bleibt'} unentdeckt.`],
      guessed: ['🧠', 'Imposter rät richtig!', `${esc(R.accused)} wurde erwischt, kannte aber das Wort.`],
    }[outcome];
    hero.className = 'result-hero ' + (outcome === 'crew' ? 'crew' : 'imp');
    hero.innerHTML = `<div class="em">${t[0]}</div><h1>${t[1]}</h1><p>${t[2]}</p>`;
    $('#resWord').textContent = R.word.word;
    $('#resUcRow').style.display = S.mode === 'undercover' ? '' : 'none';
    $('#resUcWord').textContent = R.word.uc || '';
    $('#resImps').textContent = R.imps.join(', ');
    $('#resAccused').textContent = R.accused;
    $('#scoreList').innerHTML = S.players.slice().sort((a, b) => (scores[b] || 0) - (scores[a] || 0)).map((p) => `
      <li><span class="nm" style="color:${color(p)}">${esc(p)}</span><span class="delta">${delta[p] ? '+' + delta[p] : ''}</span><span class="pts">${scores[p] || 0}</span></li>`).join('');
    show('s-result', false);
    if (outcome === 'crew') { beep(523, 0.15); beep(659, 0.15, 0.15); beep(784, 0.3, 0.3); } else { beep(392, 0.2); beep(311, 0.4, 0.2); }
    buzz(80);
  }

  // ---------- Buttons ----------
  $('#btnNew').onclick = () => { renderSetup(); show('s-setup'); };
  $('#btnRules').onclick = () => show('s-rules');
  $('#btnStart').onclick = startRound;
  $('#btnAgain').onclick = startRound;
  $('#btnMenu').onclick = () => { history.length = 0; show('s-home', false); };
  $('#resetScores').onclick = async () => {
    if (await confirmBox('Punktestand aller Spieler auf 0 setzen?')) { scores = {}; persist(); toast('Punkte zurückgesetzt'); }
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });

  // Startbildschirm mit Logo
  const splash = $('#splash');
  const hideSplash = () => { splash.classList.add('hide'); setTimeout(() => splash.remove(), 600); };
  splash.addEventListener('click', hideSplash);
  setTimeout(hideSplash, 2200);
})();
