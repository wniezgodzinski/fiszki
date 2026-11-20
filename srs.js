/*
 * Algorytm powtórek (uproszczony SM-2, w stylu Anki).
 * Każda fiszka ma osobny stan dla każdego kierunku (es2pl, pl2es).
 *
 * Stan: { st: 'new'|'learn'|'review'|'relearn', step, ivl (dni), ease, due (ms), reps, lapses, last }
 * Oceny: 1 = Nie pamiętam, 2 = Trudne, 3 = Dobrze, 4 = Łatwe
 */
(function (global) {
  'use strict';

  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;

  const CONFIG = {
    learnSteps: [1, 10],      // minuty – kroki nauki nowego słowa
    relearnSteps: [10],       // minuty – po zapomnieniu
    graduateIvl: 1,           // dni – pierwszy odstęp po nauczeniu
    easyIvl: 4,               // dni – gdy nowe słowo jest "łatwe"
    startEase: 2.5,
    minEase: 1.3,
    hardFactor: 1.2,
    easyBonus: 1.3,
    lapseFactor: 0.5,         // po zapomnieniu odstęp maleje o połowę
    maxIvl: 365
  };

  function newState() {
    return { st: 'new', step: 0, ivl: 0, ease: CONFIG.startEase, due: 0, reps: 0, lapses: 0, last: 0 };
  }

  // Lekki "rozrzut" odstępów, żeby słowa dodane razem nie wracały zawsze razem.
  function fuzz(ivl) {
    if (ivl < 3) return ivl;
    const f = Math.max(1, Math.round(ivl * 0.05));
    return ivl + Math.floor(Math.random() * (2 * f + 1)) - f;
  }

  // Termin w dniach liczony od początku dnia (o 4:00), żeby wieczorna nauka nie przesuwała wszystkiego.
  function dueInDays(now, days) {
    const d = new Date(now);
    d.setHours(4, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime() + days * DAY;
  }

  function clampIvl(x) { return Math.min(CONFIG.maxIvl, Math.max(1, Math.round(x))); }

  function answer(prev, grade, now) {
    now = now || Date.now();
    const s = Object.assign(newState(), prev || {});
    s.reps += 1;
    s.last = now;

    if (s.st === 'new' || s.st === 'learn') {
      const steps = CONFIG.learnSteps;
      if (grade === 1) { s.st = 'learn'; s.step = 0; s.due = now + steps[0] * MIN; }
      else if (grade === 2) { s.st = 'learn'; s.due = now + (steps[s.step] || steps[0]) * MIN * 1.5; }
      else if (grade === 3) {
        if (s.st === 'new') s.step = 0;
        s.step += 1;
        if (s.step >= steps.length) { s.st = 'review'; s.ivl = CONFIG.graduateIvl; s.due = dueInDays(now, s.ivl); }
        else { s.st = 'learn'; s.due = now + steps[s.step] * MIN; }
      } else { s.st = 'review'; s.ivl = CONFIG.easyIvl; s.due = dueInDays(now, s.ivl); }
      return s;
    }

    if (s.st === 'relearn') {
      const steps = CONFIG.relearnSteps;
      if (grade === 1) { s.step = 0; s.due = now + steps[0] * MIN; }
      else if (grade === 2) { s.due = now + steps[Math.min(s.step, steps.length - 1)] * MIN; }
      else {
        s.step += 1;
        if (grade === 4 || s.step >= steps.length) {
          s.st = 'review';
          s.ivl = clampIvl(grade === 4 ? s.ivl + 1 : s.ivl);
          s.due = dueInDays(now, s.ivl);
        } else { s.due = now + steps[s.step] * MIN; }
      }
      return s;
    }

    // review
    const overdueDays = Math.max(0, Math.floor((now - s.due) / DAY));
    if (grade === 1) {
      s.lapses += 1;
      s.ease = Math.max(CONFIG.minEase, s.ease - 0.2);
      s.ivl = clampIvl(s.ivl * CONFIG.lapseFactor);
      s.st = 'relearn'; s.step = 0;
      s.due = now + CONFIG.relearnSteps[0] * MIN;
    } else if (grade === 2) {
      s.ease = Math.max(CONFIG.minEase, s.ease - 0.15);
      s.ivl = clampIvl(Math.max(s.ivl + 1, s.ivl * CONFIG.hardFactor));
      s.due = dueInDays(now, s.ivl);
    } else if (grade === 3) {
      s.ivl = clampIvl(fuzz(Math.max(s.ivl + 1, (s.ivl + overdueDays / 2) * s.ease)));
      s.due = dueInDays(now, s.ivl);
    } else {
      s.ease += 0.15;
      s.ivl = clampIvl(fuzz(Math.max(s.ivl + 2, (s.ivl + overdueDays) * s.ease * CONFIG.easyBonus)));
      s.due = dueInDays(now, s.ivl);
    }
    return s;
  }

  // Podgląd odstępu dla przycisku (np. "10 min", "3 d")
  function preview(prev, grade, now) {
    now = now || Date.now();
    const s = answer(JSON.parse(JSON.stringify(prev || newState())), grade, now);
    if (s.st === 'review') return formatDelta(s.ivl * DAY);
    return formatDelta(s.due - now);
  }

  function formatDelta(ms) {
    if (ms < 60 * MIN) return Math.max(1, Math.round(ms / MIN)) + ' min';
    if (ms < DAY) return Math.round(ms / (60 * MIN)) + ' godz.';
    const d = Math.round(ms / DAY);
    if (d < 31) return d + ' d';
    if (d < 365) return (d / 30).toFixed(1).replace('.0', '') + ' mies.';
    return (d / 365).toFixed(1).replace('.0', '') + ' r.';
  }

  global.SRS = { CONFIG, MIN, DAY, newState, answer, preview, formatDelta, dueInDays };
})(typeof window !== 'undefined' ? window : globalThis);
