/*
 * Silnik odmiany czasowników hiszpańskich: presente, pretérito perfecto, estar + gerundio.
 * Regularne -ar/-er/-ir odmienia sam; wyjątki w tabelach poniżej.
 */
(function (global) {
  'use strict';

  const PERSONS = ['yo', 'tú', 'él / ella / usted', 'nosotros', 'vosotros', 'ellos / ellas / ustedes'];
  const REFL = ['me', 'te', 'se', 'nos', 'os', 'se'];
  const TENSES = { pres: 'Presente', perf: 'Pretérito perfecto', ger: 'Estar + gerundio' };
  const TENSE_PL = { pres: 'czas teraźniejszy', perf: 'np. he comido', ger: 'np. estoy comiendo' };
  const HABER = ['he', 'has', 'ha', 'hemos', 'habéis', 'han'];
  const ESTAR = ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'];
  const END = {
    ar: ['o', 'as', 'a', 'amos', 'áis', 'an'],
    er: ['o', 'es', 'e', 'emos', 'éis', 'en'],
    ir: ['o', 'es', 'e', 'imos', 'ís', 'en']
  };

  const IRREG_PRES = {
    ser: ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
    estar: ESTAR,
    ir: ['voy', 'vas', 'va', 'vamos', 'vais', 'van'],
    haber: HABER,
    dar: ['doy', 'das', 'da', 'damos', 'dais', 'dan'],
    ver: ['veo', 'ves', 've', 'vemos', 'veis', 'ven'],
    saber: ['sé', 'sabes', 'sabe', 'sabemos', 'sabéis', 'saben'],
    tener: ['tengo', 'tienes', 'tiene', 'tenemos', 'tenéis', 'tienen'],
    venir: ['vengo', 'vienes', 'viene', 'venimos', 'venís', 'vienen'],
    decir: ['digo', 'dices', 'dice', 'decimos', 'decís', 'dicen'],
    oír: ['oigo', 'oyes', 'oye', 'oímos', 'oís', 'oyen'],
    oler: ['huelo', 'hueles', 'huele', 'olemos', 'oléis', 'huelen'],
    reír: ['río', 'ríes', 'ríe', 'reímos', 'reís', 'ríen'],
    esquiar: ['esquío', 'esquías', 'esquía', 'esquiamos', 'esquiáis', 'esquían'],
    enviar: ['envío', 'envías', 'envía', 'enviamos', 'enviáis', 'envían']
  };
  // nieregularna tylko 1. osoba (yo)
  const YO = { hacer: 'hago', poner: 'pongo', salir: 'salgo', traer: 'traigo', caer: 'caigo', valer: 'valgo', seguir: 'sigo', conseguir: 'consigo' };
  // zmiany w rdzeniu (w osobach yo, tú, él, ellos)
  const STEM = {
    ie: 'empezar comenzar querer pensar recomendar encender entender cerrar preferir sentir mentir despertar perder sentar divertir nevar calentar',
    ue: 'volver devolver dormir poder contar probar recordar encontrar costar morir acostar soñar mover resolver almorzar llover',
    i: 'medir pedir repetir servir vestir seguir conseguir elegir corregir',
    ueu: 'jugar'
  };
  const STEM_MAP = {};
  Object.keys(STEM).forEach(k => STEM[k].split(' ').forEach(v => { STEM_MAP[v] = k; }));
  const PP = { hacer: 'hecho', poner: 'puesto', morir: 'muerto', romper: 'roto', ver: 'visto', escribir: 'escrito', abrir: 'abierto',
    decir: 'dicho', volver: 'vuelto', devolver: 'devuelto', cubrir: 'cubierto', descubrir: 'descubierto', resolver: 'resuelto', freír: 'frito' };
  const GER = { ir: 'yendo', poder: 'pudiendo', decir: 'diciendo', venir: 'viniendo', dormir: 'durmiendo', morir: 'muriendo', reír: 'riendo', oír: 'oyendo' };
  // czasowniki, których nie ćwiczymy w pełnej odmianie (jak gustar) lub zwykle tylko w 3. osobie
  const EXCLUDE = new Set(['gustar', 'doler', 'encantar', 'molar', 'llover', 'nevar', 'haber', 'parecer', 'importar']);
  // czasowniki, dla których „estar + gerundio” brzmi nienaturalnie
  const NO_GER = new Set(['ser', 'estar', 'saber', 'poder', 'querer', 'tener', 'conocer', 'deber', 'pertenecer', 'haber']);

  // podstawowe czasowniki – zawsze dostępne w ćwiczeniach
  const CORE = [
    ['ser', 'być (kim się jest, cechy stałe)'], ['estar', 'być (stan, miejsce)'], ['tener', 'mieć'], ['ir', 'iść, jechać'],
    ['hacer', 'robić'], ['poder', 'móc'], ['querer', 'chcieć; kochać'], ['saber', 'wiedzieć, umieć'], ['decir', 'mówić, powiedzieć'],
    ['ver', 'widzieć, oglądać'], ['dar', 'dawać'], ['poner', 'kłaść'], ['venir', 'przychodzić'], ['salir', 'wychodzić'],
    ['hablar', 'mówić, rozmawiać'], ['vivir', 'mieszkać, żyć'], ['comer', 'jeść'], ['trabajar', 'pracować'], ['volver', 'wracać'],
    ['empezar', 'zaczynać'], ['dormir', 'spać'], ['pedir', 'prosić, zamawiać'], ['jugar', 'grać'], ['conocer', 'znać, poznawać'],
    ['pensar', 'myśleć'], ['leer', 'czytać'], ['escribir', 'pisać'], ['llamarse', 'nazywać się'], ['levantarse', 'wstawać'], ['ducharse', 'brać prysznic']
  ];
  const NOT_VERBS = new Set(['ayer', 'mujer', 'lugar', 'hogar', 'bar', 'mar', 'taller', 'alquiler', 'azúcar', 'dólar', 'collar', 'familiar', 'similar', 'regular', 'militar', 'popular', 'placer', 'cáncer', 'carácter', 'deber de']);

  function parse(inf) {
    let base = String(inf).trim().toLowerCase(), refl = false;
    if (/(ar|er|ir|ír)se$/.test(base)) { refl = true; base = base.slice(0, -2); }
    const t = base.slice(-2);
    const type = t === 'ír' ? 'ir' : t;
    return { inf: String(inf).trim().toLowerCase(), base, refl, type, stem: base.slice(0, -2) };
  }
  function isVerb(w) {
    w = String(w || '').toLowerCase();
    return /^[a-záéíóúñü]+(ar|er|ir|ír)(se)?$/.test(w) && !NOT_VERBS.has(w) && w.length > 2;
  }
  function stemChange(stem, kind) {
    const swap = (from, to) => { const i = stem.lastIndexOf(from); return i < 0 ? stem : stem.slice(0, i) + to + stem.slice(i + 1); };
    if (kind === 'ie') return swap('e', 'ie');
    if (kind === 'ue') return swap('o', 'ue');
    if (kind === 'i') return swap('e', 'i');
    if (kind === 'ueu') return swap('u', 'ue');
    return stem;
  }
  const withRefl = (v, p, form) => (v.refl ? REFL[p] + ' ' + form : form);

  function presRaw(v, p, regular) {
    if (!regular && IRREG_PRES[v.base]) return IRREG_PRES[v.base][p];
    let st = v.stem;
    const kind = STEM_MAP[v.base];
    if (!regular && kind && [0, 1, 2, 5].includes(p)) st = stemChange(st, kind);
    let form = st + END[v.type][p];
    if (regular) return form;
    if (p === 0) {
      if (YO[v.base]) form = YO[v.base];
      else if (/[aeiouáéó]c(er|ir)$/.test(v.base) && !['hacer', 'decir', 'cocer'].includes(v.base)) form = v.stem.slice(0, -1) + 'zco';
      else if (/g(er|ir)$/.test(v.base)) form = st.slice(0, -1) + 'jo';
      else if (/guir$/.test(v.base)) form = st.slice(0, -1) + 'o';
    }
    if (/[^gq]uir$/.test(v.base) && [0, 1, 2, 5].includes(p)) form = v.stem + 'y' + END.ir[p];
    return form;
  }
  function participle(v, regular) {
    if (!regular && PP[v.base]) return PP[v.base];
    if (v.type === 'ar') return v.stem + 'ado';
    if (!regular && /[aeo]$/.test(v.stem)) return v.stem + 'ído';
    return v.stem + 'ido';
  }
  function gerund(v, regular) {
    if (!regular && GER[v.base]) return GER[v.base];
    if (v.type === 'ar') return v.stem + 'ando';
    if (regular) return v.stem + 'iendo';
    const kind = STEM_MAP[v.base];
    let st = v.stem;
    if (v.type === 'ir' && (kind === 'i' || kind === 'ie')) st = stemChange(st, 'i');
    if (/[aeiou]$/.test(st)) return st + 'yendo';
    return st + 'iendo';
  }
  const accentGer = g => g.replace(/ando$/, 'ándo').replace(/iendo$/, 'iéndo').replace(/yendo$/, 'yéndo');

  // główna funkcja: forma + akceptowane warianty
  function conjugate(inf, tense, p, regular) {
    const v = parse(inf);
    if (tense === 'pres') { const f = withRefl(v, p, presRaw(v, p, regular)); return { answer: f, alts: [f] }; }
    if (tense === 'perf') { const f = withRefl(v, p, HABER[p] + ' ' + participle(v, regular)); return { answer: f, alts: [f] }; }
    const g = gerund(v, regular);
    if (v.refl) {
      const f = REFL[p] + ' ' + ESTAR[p] + ' ' + g;
      return { answer: f, alts: [f, ESTAR[p] + ' ' + accentGer(g) + REFL[p]] };
    }
    const f = ESTAR[p] + ' ' + g;
    return { answer: f, alts: [f] };
  }
  function table(inf, tense) {
    return PERSONS.map((_, p) => {
      const c = conjugate(inf, tense, p), r = conjugate(inf, tense, p, true);
      return { person: PERSONS[p], form: c.answer, irregular: c.answer !== r.answer };
    });
  }
  function isIrregularVerb(inf) {
    return ['pres', 'perf', 'ger'].some(t => table(inf, t).some(r => r.irregular));
  }

  global.CONJ = { PERSONS, REFL, TENSES, TENSE_PL, CORE, EXCLUDE, NO_GER, parse, isVerb, conjugate, table, isIrregularVerb };
})(typeof window !== 'undefined' ? window : globalThis);
