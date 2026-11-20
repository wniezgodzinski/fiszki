/* Fiszki ES – aplikacja do nauki słówek z powtórkami (PWA, dane lokalnie w urządzeniu). */
(function () {
  'use strict';

  // ---------- narzędzia ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const view = $('#view');
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  };
  const K = { profiles: 'fisz.v1.profiles', shared: 'fisz.v1.shared', p: id => 'fisz.v1.p.' + id };
  const DIRS = ['es2pl', 'pl2es'];
  const DIR_LABEL = { es2pl: 'ES → PL', pl2es: 'PL → ES' };
  const HTTP = /^https?:$/.test(location.protocol);

  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  // Dzień "nauki" zaczyna się o 4:00
  const dayKey = ts => { const d = new Date((ts == null ? Date.now() : ts) - 4 * 3600e3); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2600);
  }
  function openModal(html, locked) {
    $('#modalBox').innerHTML = html; $('#modal').hidden = false; $('#modal').dataset.locked = locked ? '1' : '';
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && !$('#modal').dataset.locked) closeModal(); });

  // ---------- dane ----------
  let profiles = LS.get(K.profiles, null);  // { list: [{id, name}], active }
  let P = null;                              // dane aktywnego profilu
  let shared = LS.get(K.shared, { cards: [] });
  let tab = 'home';
  let session = null;
  const wf = { q: '', f: 'all', tag: '' };   // filtr listy słów

  function defaultProfile(name) {
    return {
      name, created: Date.now(),
      settings: { newPerDay: 10, es2pl: true, pl2es: true, typingShare: 20, autoSpeak: false, maxReviews: 200 },
      prog: {}, priv: [], known: {}, seen: {}, days: {},
      newToday: { day: '', es2pl: 0, pl2es: 0 }, lastBackup: 0
    };
  }
  function loadProfile(id) {
    const d = LS.get(K.p(id), null); if (!d) return null;
    const base = defaultProfile(d.name);
    d.settings = Object.assign(base.settings, d.settings || {});
    return Object.assign(base, d);
  }
  const saveP = () => LS.set(K.p(profiles.active), P);
  const saveProfiles = () => LS.set(K.profiles, profiles);

  function allCards() {
    const s = (shared.cards || []).map((c, i) => Object.assign({ src: 'shared', ord: i }, c));
    const p = (P.priv || []).map((c, i) => Object.assign({ src: 'priv', ord: 100000 + i }, c));
    return s.concat(p);
  }
  function cardMap() { const m = {}; allCards().forEach(c => { m[c.id] = c; }); return m; }
  const st = (id, dir) => (P.prog[id] && P.prog[id][dir]) || null;
  function setSt(id, dir, s) { if (!P.prog[id]) P.prog[id] = {}; P.prog[id][dir] = s; }
  function nt() { if (P.newToday.day !== dayKey()) P.newToday = { day: dayKey(), es2pl: 0, pl2es: 0 }; return P.newToday; }
  function logDay(field, n) { const k = dayKey(); const d = P.days[k] || (P.days[k] = { rev: 0, ok: 0, nw: 0 }); d[field] += (n || 1); }
  const sortByLesson = cards => cards.slice().sort((a, b) => (a.lesson || '').localeCompare(b.lesson || '') || a.ord - b.ord);

  function cardStatus(c) {
    if (P.known[c.id]) return 'known';
    const ss = DIRS.map(d => st(c.id, d)).filter(Boolean).filter(s => s.st !== 'new');
    if (!ss.length) return 'new';
    if (ss.reduce((a, s) => a + s.lapses, 0) >= 3) return 'hard';
    if (ss.some(s => s.st === 'learn' || s.st === 'relearn')) return 'learn';
    if (ss.every(s => s.ivl >= 21) && ss.length === DIRS.filter(d => P.settings[d]).length) return 'mature';
    return 'young';
  }
  const STATUS_LABEL = { new: 'nowe', learn: 'w nauce', young: 'powtarzane', mature: 'opanowane', hard: 'trudne', known: 'znam' };

  // ---------- kolejka ----------
  function buildQueue() {
    const now = Date.now(), S = P.settings, learn = [], rev = [], fresh = { es2pl: [], pl2es: [] };
    const cards = sortByLesson(allCards().filter(c => !P.known[c.id]));
    for (const c of cards) {
      for (const dir of DIRS) {
        if (!S[dir]) continue;
        const s = st(c.id, dir);
        if (!s || s.st === 'new') {
          // Kierunek PL→ES dopiero gdy ES→PL jest już opanowany na poziomie podstawowym
          if (dir === 'pl2es' && S.es2pl) { const o = st(c.id, 'es2pl'); if (!o || o.st !== 'review') continue; }
          fresh[dir].push({ id: c.id, dir });
        } else if (s.st === 'learn' || s.st === 'relearn') learn.push({ id: c.id, dir, due: s.due });
        else if (s.due <= now) rev.push({ id: c.id, dir });
      }
    }
    shuffle(rev); rev.length = Math.min(rev.length, S.maxReviews);
    const n = nt(), news = [];
    for (const dir of DIRS) news.push(...fresh[dir].slice(0, Math.max(0, S.newPerDay - n[dir])));
    return { learn, rev, news, freshTotal: fresh.es2pl.length + fresh.pl2es.length };
  }
  function mergeQueue(rev, news) {
    if (!news.length) return rev.slice();
    if (!rev.length) return news.slice();
    const out = [], every = Math.max(1, Math.floor(rev.length / news.length));
    let ni = 0;
    rev.forEach((r, i) => { out.push(r); if ((i + 1) % every === 0 && ni < news.length) out.push(news[ni++]); });
    while (ni < news.length) out.push(news[ni++]);
    return out;
  }

  // ---------- mowa ----------
  let esVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    esVoice = vs.find(v => v.lang === 'es-ES') || vs.find(v => /^es/i.test(v.lang)) || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\(.*?\)/g, ''));
    u.lang = 'es-ES'; if (esVoice) u.voice = esVoice; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  // ---------- sprawdzanie wpisanej odpowiedzi ----------
  function norm(s, keepAccents) {
    s = String(s).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[¿¡?!.,;:"'«»…]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!keepAccents) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s;
  }
  const stripArticle = s => s.replace(/^(el|la|los|las|un|una|unos|unas|lo)\s+/, '');
  function lev(a, b) {
    const m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 9;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  function checkTyped(input, target) {
    // Warianty: "a, b", "a; b", "a / b", "a lub b" oraz "Pan/Pani" wewnątrz zdania
    const expand = a => a.split(' ').reduce((acc, w) => {
      const opts = w.includes('/') ? w.split('/') : [w];
      return acc.length * opts.length > 32 ? acc.map(x => x + ' ' + opts[0]) : [].concat(...acc.map(x => opts.map(o => x + ' ' + o)));
    }, ['']).map(x => x.trim());
    const alts = [].concat(...[target].concat(String(target).split(/[,;]|\s\/\s|\s+lub\s+|\s+albo\s+/)).map(x => expand(x.trim()))).filter(Boolean);
    const inp = norm(input, true), inpN = norm(input, false);
    if (!inpN) return { kind: 'bad' };
    for (const a of alts) if (norm(a, true) === inp) return { kind: 'ok', best: a };
    for (const a of alts) if (norm(a, false) === inpN) return { kind: 'accent', best: a };
    for (const a of alts) if (stripArticle(norm(a, false)) === stripArticle(inpN)) return { kind: 'article', best: a };
    for (const a of alts) { const t = norm(a, false); if (t.length >= 5 && lev(t, inpN) <= 1) return { kind: 'typo', best: a }; }
    return { kind: 'bad', best: target };
  }

  // ---------- sesja ----------
  function startSession(opts) {
    opts = opts || {};
    let queue = [], learnQ = [], mode = 'srs';
    if (opts.practice) {
      mode = 'practice';
      const dirs = DIRS.filter(d => P.settings[d]);
      queue = shuffle(opts.practice.slice()).slice(0, 20).map(c => ({ id: c.id, dir: dirs[Math.floor(Math.random() * dirs.length)] || 'es2pl' }));
    } else {
      const q = buildQueue();
      queue = mergeQueue(q.rev, q.news);
      learnQ = q.learn;
    }
    if (!queue.length && !learnQ.length) { toast('Brak słów do tej sesji'); return; }
    session = { mode, title: opts.title || '', typingAll: !!opts.typingAll, queue, learnQ, cur: null, done: 0, cards: cardMap() };
    document.body.classList.add('in-session');
    nextCard();
  }
  function endSession() {
    session = null; document.body.classList.remove('in-session');
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    render();
  }
  function pickNext() {
    const S = session, now = Date.now(), avoid = S.cur ? S.cur.id : null;
    S.learnQ.sort((a, b) => a.due - b.due);
    if (S.learnQ.length && S.learnQ[0].due <= now && (S.learnQ[0].id !== avoid || !S.queue.length)) return S.learnQ.shift();
    if (S.queue.length) { const k = (S.queue[0].id === avoid && S.queue.length > 1) ? 1 : 0; return S.queue.splice(k, 1)[0]; }
    if (S.learnQ.length) { const k = S.learnQ.findIndex(x => x.id !== avoid); return S.learnQ.splice(k < 0 ? 0 : k, 1)[0]; }
    return null;
  }
  function nextCard() {
    const it = pickNext();
    if (!it) { session.cur = null; session.finished = true; renderSession(); return; }
    const c = session.cards[it.id];
    if (!c) { nextCard(); return; }
    const s = st(it.id, it.dir);
    const isReview = s && s.st === 'review';
    it.typing = session.typingAll || (session.mode === 'srs' && isReview && Math.random() * 100 < P.settings.typingShare);
    it.shown = false; it.check = null;
    session.cur = it;
    renderSession();
    if (P.settings.autoSpeak && it.dir === 'es2pl') speak(c.es);
  }
  function reveal(typed) {
    const it = session.cur; if (!it || it.shown) return;
    const c = session.cards[it.id];
    if (it.typing) it.check = checkTyped(typed || '', it.dir === 'es2pl' ? c.pl : c.es);
    it.shown = true;
    renderSession();
    if (P.settings.autoSpeak && it.dir === 'pl2es') speak(c.es);
  }
  function grade(g) {
    const it = session.cur; if (!it || !it.shown) return;
    if (session.mode === 'practice') {
      logDay('rev'); if (g >= 3) { logDay('ok'); session.done++; } else session.queue.push({ id: it.id, dir: it.dir });
      saveP(); nextCard(); return;
    }
    const prev = st(it.id, it.dir), wasNew = !prev || prev.st === 'new';
    const ns = SRS.answer(prev, g);
    setSt(it.id, it.dir, ns);
    if (wasNew) { nt()[it.dir]++; logDay('nw'); }
    logDay('rev'); if (g >= 2) logDay('ok');
    if (ns.st === 'learn' || ns.st === 'relearn') session.learnQ.push({ id: it.id, dir: it.dir, due: ns.due });
    else session.done++;
    saveP(); nextCard();
  }
  function markKnownInSession() {
    const it = session.cur; if (!it) return;
    P.known[it.id] = 1; saveP();
    session.queue = session.queue.filter(x => x.id !== it.id);
    session.learnQ = session.learnQ.filter(x => x.id !== it.id);
    toast('Oznaczono jako znane – nie będzie już pytane');
    nextCard();
  }

  function renderSession() {
    const S = session;
    if (S.finished) {
      view.innerHTML = `<div class="done"><div class="emoji">🎉</div><h1>¡Muy bien!</h1>
        <p>Sesja zakończona. Powtórzone słowa: <b>${S.done}</b>.</p>
        <button class="btn" data-act="end">Wróć</button></div>`;
      return;
    }
    const it = S.cur, c = S.cards[it.id];
    const isNewIt = x => { const s = st(x.id, x.dir); return !s || s.st === 'new'; };
    const isLearnIt = x => { const s = st(x.id, x.dir); return !!s && /learn/.test(s.st); };
    const pending = S.queue.concat([it]);
    const nNew = pending.filter(isNewIt).length;
    const nLearn = S.learnQ.length + (isLearnIt(it) ? 1 : 0);
    const left = S.queue.length + S.learnQ.length + 1;
    const pct = Math.round(100 * S.done / (S.done + left));
    const front = it.dir === 'es2pl' ? c.es : c.pl;
    const back = it.dir === 'es2pl' ? c.pl : c.es;
    const s = st(it.id, it.dir);
    const isNew = S.mode === 'srs' && (!s || s.st === 'new');

    let body = `<div class="front">${esc(front)}</div>`;
    if (isNew) body += `<div class="badge">nowe słowo</div>`;
    if (it.typing && !it.shown) {
      body += `<input id="typeIn" class="type-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${it.dir === 'es2pl' ? 'Wpisz po polsku…' : 'Escribe en español…'}">`;
      if (it.dir === 'pl2es') body += `<div class="accents">${['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'].map(a => `<button type="button" data-act="acc" data-ch="${a}">${a}</button>`).join('')}</div>`;
    }
    if (it.shown) {
      body += `<div class="back">`;
      if (it.check) {
        const k = it.check.kind;
        const msg = { ok: ['ok', '✔ Dobrze!'], accent: ['meh', '✔ Prawie – uwaga na akcenty'], article: ['meh', '✔ Prawie – pamiętaj o rodzajniku'], typo: ['meh', '≈ Literówka?'], bad: ['bad', '✘ Niestety nie'] }[k];
        body += `<div class="verdict ${msg[0]}">${msg[1]}</div>`;
        if (k !== 'ok') body += `<div class="small">Twoja odpowiedź: <span class="diff-you">${esc(it.typedValue || '—')}</span></div>`;
      }
      body += `<div class="ans">${esc(back)}</div>`;
      if (c.ex) body += `<div class="ex">${esc(c.ex)}</div>`;
      const tags = [c.lesson ? 'lekcja ' + c.lesson : '', ...(c.tags || [])].filter(Boolean);
      if (c.src === 'priv') tags.push('moje');
      if (tags.length) body += `<div class="tag">${esc(tags.join(' · '))}</div>`;
      body += `</div>`;
    }

    let actions = '';
    if (!it.shown) {
      actions = it.typing
        ? `<button class="btn" data-act="check">Sprawdź</button><button class="btn ghost" data-act="dontknow">Nie wiem</button>`
        : `<button class="btn" data-act="reveal">Pokaż odpowiedź</button>`;
    } else if (S.mode === 'practice') {
      actions = `<div class="grades two"><button class="g1" data-act="grade" data-g="1">Jeszcze raz</button><button class="g3" data-act="grade" data-g="3">Umiem</button></div>`;
    } else {
      const names = ['Nie pamiętam', 'Trudne', 'Dobrze', 'Łatwe'];
      actions = `<div class="grades">${[1, 2, 3, 4].map(g => `<button class="g${g}" data-act="grade" data-g="${g}">${names[g - 1]}<small>${SRS.preview(s, g)}</small></button>`).join('')}</div>`;
    }

    view.innerHTML = `
      <div class="session-top">
        <button class="x" data-act="end" aria-label="Zakończ">✕</button>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="counts">${S.mode === 'srs' ? `<span class="n">${nNew}</span> · <span class="l">${nLearn}</span> · <span class="r">${Math.max(0, left - nNew - nLearn)}</span>` : `${left} do końca`}</div>
      </div>
      ${S.title ? `<p class="muted small" style="margin:0 0 8px">${esc(S.title)}</p>` : ''}
      <div class="flash" ${!it.shown && !it.typing ? 'data-act="reveal"' : ''}>
        <div class="dir">${DIR_LABEL[it.dir]}${it.typing ? ' · wpisywanie' : ''}</div>
        <div class="tools">
          ${(it.dir === 'es2pl' || it.shown) ? `<button data-act="speak" title="Wymowa">🔊</button>` : ''}
          <button data-act="known" title="Znam – nie pytaj więcej">✓</button>
        </div>
        ${body}
      </div>
      ${actions}`;
    const ti = $('#typeIn');
    if (ti) { ti.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); session.cur.typedValue = ti.value; reveal(ti.value); } }); setTimeout(() => ti.focus(), 50); }
  }

  // ---------- widoki ----------
  function render() {
    $('#profileBtn').textContent = '👤 ' + (P ? P.name : '');
    $('#profileBtn').hidden = !P;
    document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (session) return renderSession();
    ({ home: renderHome, words: renderWords, stats: renderStats, settings: renderSettings })[tab]();
  }

  function streak() {
    let n = 0, d = new Date(Date.now() - 4 * 3600e3);
    const has = dd => { const k = dd.getFullYear() + '-' + pad(dd.getMonth() + 1) + '-' + pad(dd.getDate()); return P.days[k] && P.days[k].rev > 0; };
    if (!has(d)) d.setDate(d.getDate() - 1);
    while (has(d)) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function latestLesson() { return allCards().map(c => c.lesson || '').filter(Boolean).sort().pop() || ''; }
  function hardCards() {
    return allCards().filter(c => !P.known[c.id]).filter(c => DIRS.some(d => { const s = st(c.id, d); return s && (s.lapses >= 2 || s.ease < 2.0); }));
  }

  function renderHome() {
    const q = buildQueue();
    const due = q.rev.length + q.learn.length;
    const today = P.days[dayKey()] || { rev: 0 };
    const total = allCards().length;
    const last = latestLesson();
    const hard = hardCards();
    const studied = allCards().filter(c => DIRS.some(d => { const s = st(c.id, d); return s && s.st !== 'new'; }));
    let banners = '';
    if (!total) banners += `<div class="banner">Nie masz jeszcze żadnych słów. ${HTTP ? 'Wspólna lista jest pusta albo się nie wczytała.' : 'Wspólna lista wczyta się po uruchomieniu aplikacji z adresu internetowego.'} Możesz dodać własne słowa w zakładce <b>Słowa</b>.</div>`;
    const daysSinceBackup = P.lastBackup ? (Date.now() - P.lastBackup) / SRS.DAY : 999;
    if (studied.length >= 10 && daysSinceBackup > 14) banners += `<div class="banner">💾 Dawno nie było kopii zapasowej postępów. <a href="#" data-act="backup">Zrób kopię teraz</a></div>`;

    view.innerHTML = `
      <h1>¡Hola, ${esc(P.name)}! 👋</h1>
      ${banners}
      <div class="big-numbers">
        <div><b>${due}</b><span>do powtórki</span></div>
        <div><b>${q.news.length}</b><span>nowe dziś</span></div>
        <div><b>${streak()}🔥</b><span>seria dni</span></div>
      </div>
      <button class="btn" data-act="start" ${due + q.news.length ? '' : 'disabled'}>${due + q.news.length ? 'Rozpocznij naukę' : '✔ Na dziś wszystko zrobione!'}</button>
      <button class="btn secondary" data-act="start-typing" ${due + q.news.length ? '' : 'disabled'}>⌨️ Ta sama nauka, ale z wpisywaniem</button>
      <div class="panel">
        <b>Dodatkowe ćwiczenia</b>
        <p class="muted small" style="margin:4px 0 8px">Nie zmieniają harmonogramu powtórek – można ćwiczyć do woli.</p>
        <button class="btn ghost" data-act="practice-lesson" ${last ? '' : 'disabled'}>📅 Ostatnia lekcja${last ? ' (' + esc(last) + ')' : ''}</button>
        <button class="btn ghost" data-act="practice-hard" ${hard.length ? '' : 'disabled'}>🧠 Trudne słowa (${hard.length})</button>
        <button class="btn ghost" data-act="practice-type" ${studied.length ? '' : 'disabled'}>✍️ Wpisywanie – losowe znane słowa</button>
      </div>
      <p class="muted small">Dziś: ${today.rev} odpowiedzi · Słów w bazie: ${total} · Czeka nowych: ${q.freshTotal}</p>`;
  }

  function renderWords() {
    const cards = sortByLesson(allCards()).reverse();
    const lessons = [...new Set(cards.map(c => c.lesson).filter(Boolean))].sort().reverse();
    const q = norm(wf.q, false);
    const list = cards.filter(c => {
      const s = cardStatus(c);
      if (wf.f === 'shared' && c.src !== 'shared') return false;
      if (wf.f === 'priv' && c.src !== 'priv') return false;
      if (wf.f === 'known' && s !== 'known') return false;
      if (wf.f === 'hard' && s !== 'hard') return false;
      if (wf.tag && c.lesson !== wf.tag) return false;
      if (q && !(norm(c.es, false).includes(q) || norm(c.pl, false).includes(q))) return false;
      return true;
    });
    const chip = (f, l) => `<button class="chip ${wf.f === f ? 'on' : ''}" data-act="wf" data-f="${f}">${l}</button>`;
    const dotCls = { new: '', learn: 'learn', young: 'young', mature: 'mature', hard: 'hard', known: '' };
    view.innerHTML = `
      <h1>Słowa</h1>
      <div class="row">
        <button class="btn inline" data-act="add-one">+ Moje słowo</button>
        <button class="btn inline secondary" data-act="add-bulk">Wklej listę</button>
      </div>
      <input id="wsearch" class="search" type="search" placeholder="Szukaj po hiszpańsku lub polsku…" value="${esc(wf.q)}">
      <div class="filters">
        ${chip('all', 'Wszystkie')}${chip('shared', 'Wspólne')}${chip('priv', 'Moje')}${chip('hard', 'Trudne')}${chip('known', 'Znane')}
        <select id="wtag" class="chip"><option value="">Każda lekcja</option>${lessons.map(l => `<option ${wf.tag === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      </div>
      <p class="muted small">${list.length} z ${cards.length} · <span class="dot" style="display:inline-block"></span> nowe
        <span class="dot learn" style="display:inline-block"></span> w nauce <span class="dot young" style="display:inline-block"></span> powtarzane
        <span class="dot mature" style="display:inline-block"></span> opanowane <span class="dot hard" style="display:inline-block"></span> trudne</p>
      <ul class="wlist">${list.map(c => {
        const s = cardStatus(c);
        return `<li class="${s === 'known' ? 'known' : ''}" data-act="card" data-id="${esc(c.id)}">
          <span class="dot ${dotCls[s]}"></span>
          <div class="w"><div class="es">${esc(c.es)}</div><div class="pl">${esc(c.pl)}</div></div>
          <div class="meta">${c.src === 'priv' ? 'moje' : esc(c.lesson || '')}<br>${STATUS_LABEL[s]}</div></li>`;
      }).join('')}</ul>`;
    const si = $('#wsearch');
    si.addEventListener('input', () => { wf.q = si.value; const pos = si.selectionStart; renderWords(); const n = $('#wsearch'); n.focus(); n.setSelectionRange(pos, pos); });
    $('#wtag').addEventListener('change', e => { wf.tag = e.target.value; renderWords(); });
  }

  function fmtDue(s) {
    if (!s || s.st === 'new') return 'jeszcze nie uczone';
    const d = s.due - Date.now();
    const when = d <= 0 ? 'teraz' : 'za ' + SRS.formatDelta(d);
    return `${when} · odstęp ${s.ivl || 0} d · pomyłki ${s.lapses}`;
  }
  function openCard(id) {
    const c = cardMap()[id]; if (!c) return;
    openModal(`
      <h1 style="margin-bottom:4px">${esc(c.es)} <button class="btn inline ghost" data-act="speak-text" data-text="${esc(c.es)}">🔊</button></h1>
      <p style="font-size:1.2rem;margin-top:0">${esc(c.pl)}</p>
      ${c.ex ? `<p class="muted"><i>${esc(c.ex)}</i></p>` : ''}
      <p class="small muted">${c.src === 'priv' ? 'Moje słowo' : 'Wspólna lista'}${c.lesson ? ' · lekcja ' + esc(c.lesson) : ''}${(c.tags || []).length ? ' · ' + esc(c.tags.join(', ')) : ''}</p>
      <div class="panel small">
        ${DIRS.map(d => `<div><b>${DIR_LABEL[d]}:</b> ${fmtDue(st(c.id, d))}</div>`).join('')}
      </div>
      <button class="btn secondary" data-act="toggle-known" data-id="${esc(c.id)}">${P.known[c.id] ? '↩ Przywróć do nauki' : '✓ Znam – nie pytaj mnie o to'}</button>
      ${c.src === 'priv' ? `<button class="btn ghost" data-act="edit-priv" data-id="${esc(c.id)}">✏️ Edytuj</button>
         <button class="btn danger" data-act="del-priv" data-id="${esc(c.id)}">Usuń moje słowo</button>` : ''}
      <button class="btn ghost" data-act="reset-card" data-id="${esc(c.id)}">Zacznij to słowo od nowa</button>
      <button class="btn ghost" data-act="close">Zamknij</button>`);
  }

  function cardForm(c) {
    c = c || {};
    openModal(`
      <h2>${c.id ? 'Edytuj słowo' : 'Nowe słowo (tylko dla mnie)'}</h2>
      <label>Hiszpański</label><input type="text" id="f_es" value="${esc(c.es)}" autocapitalize="off">
      <label>Polski</label><input type="text" id="f_pl" value="${esc(c.pl)}">
      <label>Przykład (opcjonalnie)</label><input type="text" id="f_ex" value="${esc(c.ex)}">
      <label>Tagi, po przecinku (opcjonalnie)</label><input type="text" id="f_tags" value="${esc((c.tags || []).join(', '))}" placeholder="np. duolingo, jedzenie">
      <button class="btn" data-act="save-priv" data-id="${esc(c.id || '')}">Zapisz</button>
      <button class="btn ghost" data-act="close">Anuluj</button>`);
    setTimeout(() => $('#f_es').focus(), 50);
  }

  // ---------- import listy ----------
  function parseLines(text) {
    return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      let parts;
      if (l.includes('\t')) parts = l.split('\t');
      else if (l.includes(';')) parts = l.split(';');
      else if (/\s[–—=-]\s/.test(l)) parts = l.split(/\s[–—=-]\s/);
      else parts = [l];
      parts = parts.map(x => x.trim());
      const r = { es: parts[0] || '', pl: parts[1] || '', ex: parts[2] || '', tags: (parts[3] || '').split(/[,|]/).map(t => t.trim()).filter(Boolean) };
      if (!r.es || !r.pl) r.err = 'brak tłumaczenia';
      return r;
    });
  }
  const dupKey = s => String(s).toLowerCase().replace(/[¿¡?!.]/g, '').replace(/\s+/g, ' ').trim();
  function markDups(rows, existing) {
    const seen = new Set(existing.map(c => dupKey(c.es)));
    rows.forEach(r => { if (r.err) return; const k = dupKey(r.es); if (seen.has(k)) r.dup = true; else seen.add(k); });
    return rows;
  }
  function previewTable(rows) {
    if (!rows.length) return '';
    const ok = rows.filter(r => !r.err && !r.dup).length;
    return `<p class="small"><b>${ok}</b> do dodania · ${rows.filter(r => r.dup).length} duplikatów · ${rows.filter(r => r.err).length} błędów</p>
      <table class="preview-table"><tr><th>hiszpański</th><th>polski</th><th>przykład</th></tr>
      ${rows.map(r => `<tr class="${r.dup ? 'dup' : ''} ${r.err ? 'err' : ''}"><td>${esc(r.es)}</td><td>${esc(r.pl || r.err)}</td><td>${esc(r.ex)}</td></tr>`).join('')}</table>`;
  }
  const FORMAT_HELP = `<p class="small muted">Jedna linia = jedno słowo: <code>hiszpański ; polski ; przykład ; tagi</code><br>
    Przykład i tagi są opcjonalne. Można też wkleić kolumny z Excela.</p>`;

  function bulkPriv() {
    openModal(`<h2>Wklej listę (tylko dla mnie)</h2>${FORMAT_HELP}
      <textarea id="bulkText" placeholder="la cuenta ; rachunek ; ¿Me trae la cuenta? ; restauracja"></textarea>
      <div id="bulkPrev"></div>
      <button class="btn" data-act="bulk-priv-save">Dodaj</button>
      <button class="btn ghost" data-act="close">Anuluj</button>`);
    const ta = $('#bulkText');
    ta.addEventListener('input', () => { $('#bulkPrev').innerHTML = previewTable(markDups(parseLines(ta.value), allCards())); });
  }

  // ---------- edytor wspólnej listy ----------
  function sharedEditor() {
    openModal(`<h2>Edytor wspólnej listy</h2>
      <p class="small">Tworzy nowy plik <b>words.json</b> = obecna lista (${(shared.cards || []).length} słów) + nowe słowa.
      Pobrany plik wgraj do repozytorium na GitHubie (instrukcja w pliku INSTRUKCJA.md). Po chwili oba telefony same pobiorą nowe słowa.</p>
      <div class="row"><div><label>Data lekcji</label><input type="date" id="shLesson" value="${todayISO()}"></div>
      <div><label>Temat / tag (opcjonalnie)</label><input type="text" id="shTag" placeholder="np. restauracja"></div></div>
      <label>Nowe słowa</label>${FORMAT_HELP}
      <textarea id="shText"></textarea>
      <div id="shPrev"></div>
      <button class="btn" data-act="shared-download">Pobierz nowy words.json</button>
      <button class="btn ghost" data-act="close">Anuluj</button>`);
    const ta = $('#shText');
    ta.addEventListener('input', () => { $('#shPrev').innerHTML = previewTable(markDups(parseLines(ta.value), shared.cards || [])); });
  }

  async function saveFile(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (/iPhone|iPad|Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) { if (e && e.name === 'AbortError') return false; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return true;
  }

  async function backup() {
    const data = { app: 'fiszki-es', type: 'profile-backup', version: 1, exported: new Date().toISOString(), profile: P };
    const name = `fiszki-kopia-${P.name.replace(/[^\w-]+/g, '_')}-${todayISO()}.json`;
    if (await saveFile(name, JSON.stringify(data))) { P.lastBackup = Date.now(); saveP(); toast('Kopia zapisana'); render(); }
  }
  function restore(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.app !== 'fiszki-es' || d.type !== 'profile-backup' || !d.profile) throw new Error('format');
        if (!confirm(`Zastąpić postępy profilu „${P.name}” danymi z kopii (${d.exported ? d.exported.slice(0, 10) : '?'})?`)) return;
        const name = P.name;
        P = Object.assign(defaultProfile(name), d.profile, { name });
        P.settings = Object.assign(defaultProfile(name).settings, d.profile.settings || {});
        saveP(); toast('Przywrócono kopię'); render();
      } catch (e) { alert('To nie jest poprawny plik kopii fiszek.'); }
    };
    r.readAsText(file);
  }

  function renderStats() {
    const cards = allCards();
    const counts = { new: 0, learn: 0, young: 0, mature: 0, hard: 0, known: 0 };
    cards.forEach(c => counts[cardStatus(c)]++);
    let rev30 = 0, ok30 = 0;
    const now = Date.now();
    for (let i = 0; i < 30; i++) { const d = P.days[dayKey(now - i * SRS.DAY)]; if (d) { rev30 += d.rev; ok30 += d.ok; } }
    // mapa aktywności: 12 tygodni, kolumny = dni tygodnia (pon–nd)
    const start = new Date(now - 4 * 3600e3); start.setHours(12, 0, 0, 0);
    const dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow - 7 * 11);
    let heat = '';
    for (let i = 0; i < 84; i++) {
      const d = new Date(start.getTime() + i * SRS.DAY);
      const k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      const n = (P.days[k] || {}).rev || 0;
      const future = d.getTime() > now;
      heat += `<div class="${future ? '' : n >= 60 ? 'h4' : n >= 30 ? 'h3' : n >= 10 ? 'h2' : n > 0 ? 'h1' : ''}" style="${future ? 'opacity:.25' : ''}" title="${k}: ${n}"></div>`;
    }
    // prognoza 7 dni
    const fc = new Array(7).fill(0), base = SRS.dueInDays(now, 0);
    cards.filter(c => !P.known[c.id]).forEach(c => DIRS.forEach(d => {
      if (!P.settings[d]) return; const s = st(c.id, d); if (!s || s.st === 'new') return;
      const i = Math.max(0, Math.floor((s.due - base) / SRS.DAY)); if (i < 7) fc[i]++;
    }));
    const mx = Math.max(1, ...fc);
    const dn = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
    const hardest = cards.map(c => ({ c, l: DIRS.reduce((a, d) => a + ((st(c.id, d) || {}).lapses || 0), 0) }))
      .filter(x => x.l > 0 && !P.known[x.c.id]).sort((a, b) => b.l - a.l).slice(0, 10);

    view.innerHTML = `
      <h1>Statystyki</h1>
      <div class="big-numbers">
        <div><b>${streak()}🔥</b><span>seria dni</span></div>
        <div><b>${rev30 ? Math.round(100 * ok30 / rev30) : 0}%</b><span>trafność (30 dni)</span></div>
        <div><b>${counts.mature}</b><span>opanowane</span></div>
      </div>
      <div class="panel small">
        Wszystkich słów: <b>${cards.length}</b> · nowe ${counts.new} · w nauce ${counts.learn} · powtarzane ${counts.young} ·
        opanowane ${counts.mature} · trudne ${counts.hard} · znane ${counts.known}
      </div>
      <div class="panel"><b>Aktywność – 12 tygodni</b><p class="muted small" style="margin:2px 0 8px">kolumny = tygodnie, wiersze = pn…nd; im ciemniej, tym więcej odpowiedzi</p><div class="heat">${heat}</div></div>
      <div class="panel"><b>Powtórki w najbliższych dniach</b>
        <div class="bars" style="margin-top:10px">${fc.map(n => `<div style="height:${Math.round(100 * n / mx)}%" title="${n}"></div>`).join('')}</div>
        <div class="bars-labels">${fc.map((n, i) => `<span>${i === 0 ? 'dziś' : dn[new Date(now + i * SRS.DAY).getDay()]}<br>${n}</span>`).join('')}</div></div>
      <div class="panel"><b>Najtrudniejsze słowa</b>
        ${hardest.length ? `<ul class="wlist" style="margin-top:8px">${hardest.map(x => `<li data-act="card" data-id="${esc(x.c.id)}"><div class="w"><div class="es">${esc(x.c.es)}</div><div class="pl">${esc(x.c.pl)}</div></div><div class="meta">${x.l}× zapomniane</div></li>`).join('')}</ul>` : '<p class="muted small">Jeszcze brak – i oby tak zostało 🙂</p>'}</div>
      <p class="muted small">Porównanie wyników między profilami (rywalizacja) pojawi się w kolejnej wersji – wymaga synchronizacji przez internet.</p>`;
  }

  function renderSettings() {
    const S = P.settings;
    const upd = shared.fetched ? new Date(shared.fetched).toLocaleString('pl-PL') : 'nigdy';
    view.innerHTML = `
      <h1>Ustawienia</h1>
      <div class="panel">
        <b>Nauka – profil „${esc(P.name)}”</b>
        <div class="switch"><span>Nowe słowa dziennie (na kierunek)</span><input type="number" min="0" max="100" data-set="newPerDay" value="${S.newPerDay}"></div>
        <div class="switch"><span>Kierunek ES → PL</span><input type="checkbox" data-set="es2pl" ${S.es2pl ? 'checked' : ''}></div>
        <div class="switch"><span>Kierunek PL → ES</span><input type="checkbox" data-set="pl2es" ${S.pl2es ? 'checked' : ''}></div>
        <div class="switch"><span>Wpisywanie co którąś powtórkę</span><select data-set="typingShare">
          ${[[0, 'nigdy'], [10, '10%'], [20, '20%'], [35, '35%'], [50, '50%'], [100, 'zawsze']].map(([v, l]) => `<option value="${v}" ${S.typingShare == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="switch"><span>Automatycznie czytaj po hiszpańsku</span><input type="checkbox" data-set="autoSpeak" ${S.autoSpeak ? 'checked' : ''}></div>
        <div class="switch"><span>Maks. powtórek w sesji</span><input type="number" min="10" max="1000" data-set="maxReviews" value="${S.maxReviews}"></div>
        <p class="muted small">PL → ES pojawia się dla słowa dopiero, gdy ES → PL jest już przyswojone.</p>
      </div>
      <div class="panel">
        <b>Wspólna lista</b>
        <p class="small">${(shared.cards || []).length} słów · ostatnie pobranie: ${esc(upd)}${shared.updated ? ' · wersja z ' + esc(String(shared.updated).slice(0, 10)) : ''}</p>
        <button class="btn inline secondary" data-act="sync">↻ Sprawdź nowe słowa</button>
        <button class="btn inline ghost" data-act="shared-editor">Edytor wspólnej listy</button>
      </div>
      <div class="panel">
        <b>Kopia zapasowa</b>
        <p class="small muted">Postępy są tylko w tym urządzeniu. Ostatnia kopia: ${P.lastBackup ? new Date(P.lastBackup).toLocaleDateString('pl-PL') : 'nigdy'}.</p>
        <button class="btn inline" data-act="backup">💾 Zapisz kopię</button>
        <label class="btn inline ghost" style="display:inline-block;font-weight:700">📂 Przywróć z pliku<input type="file" id="restoreIn" accept=".json,application/json" hidden></label>
      </div>
      <div class="panel">
        <b>Profile na tym urządzeniu</b>
        ${profiles.list.map(p => `<div class="switch"><span>${p.id === profiles.active ? '👉 ' : ''}${esc(p.name)}</span>
          ${p.id === profiles.active ? `<button class="btn inline ghost" data-act="rename">Zmień nazwę</button>` : `<button class="btn inline ghost" data-act="switch" data-id="${p.id}">Przełącz</button>`}</div>`).join('')}
        <button class="btn inline secondary" data-act="new-profile">+ Dodaj profil</button>
        ${profiles.list.length > 1 ? `<button class="btn inline danger" data-act="del-profile">Usuń bieżący profil</button>` : ''}
      </div>
      <p class="muted small">Fiszki ES · dane zapisane lokalnie w tej przeglądarce. ${HTTP ? '' : '<br>⚠️ Uruchomiono z pliku – wspólna lista i tryb offline działają dopiero z adresu internetowego.'}</p>`;
    view.querySelectorAll('[data-set]').forEach(el => el.addEventListener('change', () => {
      const k = el.dataset.set;
      S[k] = el.type === 'checkbox' ? el.checked : Number(el.value);
      if (!S.es2pl && !S.pl2es) { S.es2pl = true; toast('Musi być włączony co najmniej jeden kierunek'); }
      saveP(); renderSettings();
    }));
    $('#restoreIn').addEventListener('change', e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; });
  }

  // ---------- profile ----------
  function askName(title, cb, initial, locked) {
    openModal(`<h2>${esc(title)}</h2><label>Imię</label><input type="text" id="pname" value="${esc(initial || '')}" maxlength="30">
      <button class="btn" id="pnameOk">OK</button>${locked ? '' : '<button class="btn ghost" data-act="close">Anuluj</button>'}`, locked);
    const inp = $('#pname'); setTimeout(() => inp.focus(), 50);
    const go = () => { const v = inp.value.trim(); if (!v) return inp.focus(); closeModal(); cb(v); };
    $('#pnameOk').addEventListener('click', go);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  function createProfile(name) {
    const id = uid('u');
    if (!profiles) profiles = { list: [], active: id };
    profiles.list.push({ id, name }); profiles.active = id; saveProfiles();
    P = defaultProfile(name);
    (shared.cards || []).forEach(c => { P.seen[c.id] = 1; });
    saveP();
  }
  function switchProfile(id) {
    profiles.active = id; saveProfiles(); P = loadProfile(id) || defaultProfile('?');
    closeModal(); tab = 'home'; render(); announceNew();
  }
  function profilePicker() {
    openModal(`<h2>Kto się uczy?</h2>
      ${profiles.list.map(p => `<button class="btn ${p.id === profiles.active ? '' : 'ghost'}" data-act="switch" data-id="${p.id}">👤 ${esc(p.name)}</button>`).join('')}
      <button class="btn secondary" data-act="new-profile">+ Dodaj profil</button>`);
  }

  // ---------- wspólna lista ----------
  function announceNew() {
    if (!P) return;
    const fresh = (shared.cards || []).filter(c => !P.seen[c.id]);
    if (!fresh.length) return;
    fresh.forEach(c => { P.seen[c.id] = 1; }); saveP();
    toast(`Nowe słowa ze wspólnej listy: ${fresh.length} 🎉`, 3500);
  }
  async function syncShared(manual) {
    if (!HTTP) { if (manual) toast('Wspólna lista działa po uruchomieniu z adresu internetowego'); return; }
    try {
      const r = await fetch('words.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      if (!Array.isArray(d.cards)) throw new Error('format');
      shared = { updated: d.updated || '', cards: d.cards.filter(c => c && c.id && c.es), fetched: Date.now() };
      LS.set(K.shared, shared);
      if (manual) toast(`Wspólna lista: ${shared.cards.length} słów`);
      announceNew();
      if (!session) render();
    } catch (e) { if (manual) toast('Nie udało się pobrać listy (brak internetu?)'); }
  }

  // ---------- zdarzenia ----------
  document.querySelector('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]'); if (!b) return; tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  });
  $('#profileBtn').addEventListener('click', () => { if (!session) profilePicker(); });

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, id = el.dataset.id;
    if (el.tagName === 'A') e.preventDefault();
    switch (a) {
      case 'start': startSession(); break;
      case 'start-typing': startSession({ typingAll: true }); break;
      case 'practice-lesson': { const l = latestLesson(); startSession({ practice: allCards().filter(c => c.lesson === l), title: 'Ćwiczenie: lekcja ' + l }); break; }
      case 'practice-hard': startSession({ practice: hardCards(), title: 'Ćwiczenie: trudne słowa' }); break;
      case 'practice-type': {
        const pool = allCards().filter(c => !P.known[c.id] && DIRS.some(d => { const s = st(c.id, d); return s && s.st !== 'new'; }));
        startSession({ practice: pool, typingAll: true, title: 'Ćwiczenie: wpisywanie' }); break;
      }
      case 'end': endSession(); break;
      case 'reveal': if (!session.cur.typing) reveal(); break;
      case 'check': { const v = $('#typeIn').value; session.cur.typedValue = v; reveal(v); break; }
      case 'dontknow': session.cur.typedValue = ''; reveal(''); break;
      case 'acc': { const ti = $('#typeIn'); const p = ti.selectionStart; ti.value = ti.value.slice(0, p) + el.dataset.ch + ti.value.slice(ti.selectionEnd); ti.focus(); ti.setSelectionRange(p + 1, p + 1); break; }
      case 'grade': grade(Number(el.dataset.g)); break;
      case 'speak': e.stopPropagation(); speak(session.cards[session.cur.id].es); break;
      case 'speak-text': speak(el.dataset.text); break;
      case 'known': e.stopPropagation(); markKnownInSession(); break;
      case 'wf': wf.f = el.dataset.f; renderWords(); break;
      case 'card': openCard(id); break;
      case 'close': closeModal(); break;
      case 'toggle-known': if (P.known[id]) delete P.known[id]; else P.known[id] = 1; saveP(); closeModal(); render(); break;
      case 'reset-card': if (confirm('Wyzerować postęp tego słowa?')) { delete P.prog[id]; saveP(); closeModal(); render(); } break;
      case 'add-one': cardForm(); break;
      case 'edit-priv': cardForm(P.priv.find(c => c.id === id)); break;
      case 'del-priv': if (confirm('Usunąć to słowo?')) { P.priv = P.priv.filter(c => c.id !== id); delete P.prog[id]; delete P.known[id]; saveP(); closeModal(); render(); } break;
      case 'save-priv': {
        const es = $('#f_es').value.trim(), pl = $('#f_pl').value.trim();
        if (!es || !pl) { toast('Uzupełnij hiszpański i polski'); break; }
        const data = { es, pl, ex: $('#f_ex').value.trim(), tags: $('#f_tags').value.split(',').map(t => t.trim()).filter(Boolean) };
        if (id) Object.assign(P.priv.find(c => c.id === id), data);
        else {
          if (allCards().some(c => dupKey(c.es) === dupKey(es)) && !confirm('Takie słowo już jest w bazie. Dodać mimo to?')) break;
          P.priv.push(Object.assign({ id: uid('p'), lesson: todayISO() }, data));
        }
        saveP(); closeModal(); toast('Zapisano'); render(); break;
      }
      case 'add-bulk': bulkPriv(); break;
      case 'bulk-priv-save': {
        const rows = markDups(parseLines($('#bulkText').value), allCards()).filter(r => !r.err && !r.dup);
        if (!rows.length) { toast('Brak nowych słów do dodania'); break; }
        rows.forEach(r => P.priv.push({ id: uid('p'), es: r.es, pl: r.pl, ex: r.ex, tags: r.tags, lesson: todayISO() }));
        saveP(); closeModal(); toast(`Dodano słów: ${rows.length}`); render(); break;
      }
      case 'shared-editor': await syncShared(false); sharedEditor(); break;
      case 'shared-download': {
        const lesson = $('#shLesson').value || todayISO(), tag = $('#shTag').value.trim();
        const rows = markDups(parseLines($('#shText').value), shared.cards || []).filter(r => !r.err && !r.dup);
        if (!rows.length) { toast('Brak nowych słów'); break; }
        const cards = (shared.cards || []).map(c => { const o = Object.assign({}, c); delete o.src; delete o.ord; return o; });
        rows.forEach(r => cards.push({ id: uid('s'), es: r.es, pl: r.pl, ex: r.ex, tags: [...new Set(r.tags.concat(tag ? [tag] : []))], lesson }));
        const out = { version: 1, updated: new Date().toISOString(), cards };
        await saveFile('words.json', JSON.stringify(out, null, 1));
        toast(`Plik gotowy: ${cards.length} słów (nowych: ${rows.length})`, 3500); break;
      }
      case 'sync': syncShared(true); break;
      case 'backup': backup(); break;
      case 'switch': switchProfile(id); break;
      case 'new-profile': askName('Nowy profil', name => { createProfile(name); tab = 'home'; render(); }); break;
      case 'rename': askName('Zmień nazwę', name => { P.name = name; profiles.list.find(p => p.id === profiles.active).name = name; saveP(); saveProfiles(); render(); }, P.name); break;
      case 'del-profile':
        if (confirm(`Usunąć profil „${P.name}” i wszystkie jego postępy z tego urządzenia?`)) {
          localStorage.removeItem(K.p(profiles.active));
          profiles.list = profiles.list.filter(p => p.id !== profiles.active);
          switchProfile(profiles.list[0].id);
        }
        break;
    }
  });

  // Klawiatura (komputer): spacja = pokaż, 1–4 = ocena
  document.addEventListener('keydown', e => {
    if (!session || !session.cur || e.target.tagName === 'INPUT' || !$('#modal').hidden) return;
    if ((e.key === ' ' || e.key === 'Enter') && !session.cur.shown && !session.cur.typing) { e.preventDefault(); reveal(); }
    else if (session.cur.shown && /^[1-4]$/.test(e.key)) {
      const g = Number(e.key);
      if (session.mode === 'practice') grade(g <= 1 ? 1 : 3); else grade(g);
    } else if (e.key === 'Escape') endSession();
  });

  // ---------- start ----------
  function boot() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && HTTP) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!profiles || !profiles.list.length) {
      profiles = null;
      render0();
      askName('Witaj! Jak masz na imię?', name => { createProfile(name); render(); syncShared(false); }, '', true);
      return;
    }
    P = loadProfile(profiles.active) || (createProfile('Ja'), P);
    render();
    if (profiles.list.length > 1) profilePicker();
    syncShared(false);
  }
  function render0() { view.innerHTML = '<p class="muted">Ładowanie…</p>'; }
  boot();
})();
