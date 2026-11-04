#!/usr/bin/env node
// UND — actualizador de datos (Node 20+, sin dependencias)
// Se ejecuta en GitHub Actions cada 5 min (el mínimo que permite GitHub) y escribe data/*.json
// Fuentes: Jolpica (F1), MotoGP Pulselive (MotoGP), NASCAR CF feed (NASCAR),
//          TheSportsDB (IndyCar, WEC, IMSA, WRC, WorldSBK y respaldo de todas).

import fs from 'node:fs/promises';

const OUT = new URL('../data/data.json', import.meta.url);
const TSDB_KEY = process.env.TSDB_KEY || '123';
const NOW = Date.now();
const Y = new Date().getUTCFullYear();
const UA = 'PitWall-App/1.0 (GitHub Actions data updater)';
const MAX_ROWS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(url, { retries = 2, timeout = 25000 } = {}) {
  for (let i = 0; ; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeout);
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 429 && i < retries) { await sleep(6000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      const txt = await r.text();
      if (!txt.trim()) return null;
      return JSON.parse(txt);
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

let lastTsdb = 0;
async function tsdb(path) {
  const wait = 2200 - (Date.now() - lastTsdb); // límite gratuito: 30 peticiones/min
  if (wait > 0) await sleep(wait);
  lastTsdb = Date.now();
  return getJSON(`https://www.thesportsdb.com/api/v1/json/${TSDB_KEY}/${path}`);
}

// Reintento de resultados que aún no existen: cada 15 min los 3 primeros días, luego cada 12 h
const recheck = (startISO, last) => { if (!last) return true; const age = NOW - Date.parse(startISO); return NOW - Date.parse(last) > (age < 3 * 864e5 ? 15 * 60e3 : 12 * 3600e3); };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const num = (v) => (v === null || v === undefined || v === '' || isNaN(+v) ? null : +v);
const clean = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();

function finalize(ev) {
  ev.sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
  ev.start = ev.sessions[0]?.start || ev.start;
  const last = ev.sessions[ev.sessions.length - 1];
  const endT = last ? new Date(last.start).getTime() + (last.dur || 120) * 60000 : new Date(ev.start).getTime() + 3 * 3600000;
  ev.end = iso(endT);
  ev.done = endT < NOW;
  const withRes = ev.sessions.filter((s) => s.result?.length);
  const main = withRes.filter((s) => s.main);
  ev.winner = (main[main.length - 1] || withRes[withRes.length - 1])?.result?.[0]?.name || null;
  return ev;
}

// ---------------------------------------------------------------- F1 (Jolpica)
async function f1(prev, year = Y, strict = false) {
  const B = 'https://api.jolpi.ca/ergast/f1';
  let races = (await getJSON(`${B}/${year}.json?limit=100`))?.MRData?.RaceTable?.Races || [];
  if (!races.length && !strict) { year = year - 1; races = (await getJSON(`${B}/${year}.json?limit=100`))?.MRData?.RaceTable?.Races || []; }
  if (!races.length) throw new Error('F1 sin calendario');

  async function paged(kind, key) {
    const out = {};
    let offset = 0, total = 1;
    while (offset < total) {
      const r = await getJSON(`${B}/${year}/${kind}.json?limit=100&offset=${offset}`);
      total = +r.MRData.total || 0;
      for (const race of r.MRData.RaceTable.Races || []) (out[race.round] ||= []).push(...(race[key] || []));
      offset += 100;
      await sleep(350);
    }
    return out;
  }
  const results = await paged('results', 'Results');
  const sprints = await paged('sprint', 'SprintResults').catch(() => ({}));

  const mapRes = (rows) => rows.slice(0, MAX_ROWS).map((x) => ({
    pos: num(x.position), name: `${x.Driver.givenName} ${x.Driver.familyName}`, code: x.Driver.code || '',
    team: x.Constructor?.name || '', time: x.Time?.time || x.status || '', pts: num(x.points),
  }));
  const at = (o) => (o?.date ? `${o.date}T${o.time || '12:00:00Z'}` : null);

  const events = races.map((r) => {
    const S = [];
    const add = (name, o, dur, extra = {}) => { const s = at(o); if (s) S.push({ name, start: iso(s), dur, tbc: !o.time, ...extra }); };
    add('Libres 1', r.FirstPractice, 60);
    add('Libres 2', r.SecondPractice, 60);
    add('Libres 3', r.ThirdPractice, 60);
    add('Clasif. Sprint', r.SprintQualifying || r.SprintShootout, 45);
    add('Sprint', r.Sprint, 45, { main: false, result: sprints[r.round] ? mapRes(sprints[r.round]) : undefined });
    add('Clasificación', r.Qualifying, 60);
    add('Carrera', { date: r.date, time: r.time }, 120, { main: true, result: results[r.round] ? mapRes(results[r.round]) : undefined });
    return finalize({
      id: `f1-${year}-${r.round}`, round: +r.round, name: r.raceName,
      circuit: r.Circuit?.circuitName || '', location: [r.Circuit?.Location?.locality, r.Circuit?.Location?.country].filter(Boolean).join(', '),
      country: r.Circuit?.Location?.country || '', city: r.Circuit?.Location?.locality || '',
      ...(r.Circuit?.Location?.lat ? { lat: +r.Circuit.Location.lat, lon: +r.Circuit.Location.long } : {}), sessions: S,
    });
  });

  const ds = (await getJSON(`${B}/${year}/driverStandings.json?limit=100`))?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const cs = (await getJSON(`${B}/${year}/constructorStandings.json?limit=100`))?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  return {
    season: year, source: 'Jolpica F1 API', events,
    standings: {
      drivers: ds.map((d) => ({ pos: num(d.position), name: `${d.Driver.givenName} ${d.Driver.familyName}`, team: d.Constructors?.[0]?.name || '', pts: num(d.points), wins: num(d.wins) })),
      teams: cs.map((c) => ({ pos: num(c.position), name: c.Constructor.name, pts: num(c.points), wins: num(c.wins) })),
      teamsLabel: 'Constructores',
    },
  };
}

// ---------------------------------------------------------------- MotoGP (Pulselive)
async function motogp(prev, year = Y, strict = false, catRe = /^motogp/i, key = 'motogp') {
  const B = 'https://api.motogp.pulselive.com/motogp/v1';
  const seasons = await getJSON(`${B}/results/seasons`);
  const season = seasons.find((s) => +s.year === year) || (!strict && seasons.find((s) => s.current));
  if (!season) throw new Error('MotoGP sin temporada');
  const cats = await getJSON(`${B}/results/categories?seasonUuid=${season.id}`);
  const cat = cats.find((c) => catRe.test(c.name));
  if (!cat) throw new Error(`${key}: categoría no encontrada`);
  const evs = [
    ...((await getJSON(`${B}/results/events?seasonUuid=${season.id}&isFinished=true`)) || []),
    ...((await getJSON(`${B}/results/events?seasonUuid=${season.id}&isFinished=false`)) || []),
  ].filter((e) => !e.test);

  const prevRes = new Map();
  for (const ev of prev?.events || []) for (const s of ev.sessions || []) if (s.id && s.result?.length) prevRes.set(s.id, s.result);

  const TYPE = { FP: ['Libres', 45], PR: ['Práctica', 60], Q: ['Clasificación', 15], SPR: ['Sprint', 30], RAC: ['Carrera', 45], WUP: ['Warm Up', 10] };
  const events = [];
  const prevEv = new Map((prev?.events || []).map((x) => [x.id, x]));
  for (const e of evs) {
    const pe = prevEv.get(`${key}-${e.id}`);
    if (pe?.done && pe.sessions.filter((x) => /^(Carrera|Sprint)$/.test(x.name)).every((x) => x.result?.length)) { events.push(pe); continue; } // ya cerrado: no se vuelve a pedir
    let sess = [];
    try { sess = (await getJSON(`${B}/results/sessions?eventUuid=${e.id}&categoryUuid=${cat.id}`)) || []; } catch { sess = []; }
    await sleep(250);
    const S = [];
    for (const s of sess) {
      const [lbl, dur] = TYPE[s.type] || [s.type, 45];
      const name = s.type === 'FP' || s.type === 'Q' ? `${lbl} ${s.number || ''}`.trim() : lbl;
      const o = { id: s.id, name, start: iso(s.date), dur, main: s.type === 'RAC' };
      if ((s.type === 'RAC' || s.type === 'SPR') && new Date(s.date).getTime() < NOW) {
        if (prevRes.has(s.id)) o.result = prevRes.get(s.id);
        else {
          try {
            const c = await getJSON(`${B}/results/session/${s.id}/classification?test=false`);
            o.result = (c?.classification || []).slice(0, MAX_ROWS).map((r) => ({
              pos: num(r.position), name: r.rider?.full_name || '', team: r.team?.name || '',
              time: r.position === 1 ? (r.time || '') : (r.gap?.first ? `+${r.gap.first}` : r.status || ''), pts: num(r.points),
            })).filter((r) => r.name);
          } catch { /* sin clasificación todavía */ }
          await sleep(250);
        }
      }
      if (o.start) S.push(o);
    }
    if (!S.length && e.date_start) S.push({ name: 'Gran Premio', start: iso(e.date_start), dur: 60 * 60, main: true, tbc: true });
    const lat = num(e.circuit?.latitude ?? e.circuit?.lat), lon = num(e.circuit?.longitude ?? e.circuit?.lng ?? e.circuit?.lon);
    events.push(finalize({
      id: `${key}-${e.id}`, uid: e.id, name: clean(e.sponsored_name || e.name), circuit: e.circuit?.name || '',
      location: [e.circuit?.place, e.country?.name].filter(Boolean).join(', '), country: e.country?.name || '', iso: e.country?.iso || '',
      city: e.circuit?.place || '', ...(lat !== null && lon !== null ? { lat, lon } : {}),
      sessions: S,
    }));
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  events.forEach((e, i) => (e.round = i + 1));

  const st = await getJSON(`${B}/results/standings?seasonUuid=${season.id}&categoryUuid=${cat.id}`);
  const drivers = (st?.classification || []).map((r) => ({ pos: num(r.position), name: r.rider?.full_name || '', team: r.team?.name || '', pts: num(r.points), wins: num(r.race_wins), rid: r.rider?.riders_api_uuid || undefined }));
  const teamMap = {};
  for (const d of drivers) if (d.team) teamMap[d.team] = (teamMap[d.team] || 0) + (d.pts || 0);
  const teams = Object.entries(teamMap).sort((a, b) => b[1] - a[1]).map(([name, pts], i) => ({ pos: i + 1, name, pts }));
  return { season: +season.year, source: 'MotoGP.com (Pulselive)', events, standings: { drivers, teams, teamsLabel: 'Equipos', teamsNote: 'Equipos: suma de puntos de sus pilotos.' } };
}

// ---------------------------------------------------------------- NASCAR Cup (CF feed)
async function nascar(prev, Y = new Date().getUTCFullYear()) {
  const list = await getJSON(`https://cf.nascar.com/cacher/${Y}/race_list_basic.json`);
  const races = (list?.series_1 || []).filter((r) => r.race_name);
  if (!races.length) throw new Error('NASCAR sin calendario');
  const prevRes = new Map(), prevChk = new Map();
  for (const ev of prev?.events || []) for (const s of ev.sessions || []) { if (s.main && s.result?.length) prevRes.set(ev.id, s.result); if (s.main && s.chk) prevChk.set(ev.id, s.chk); }

  const events = [];
  let round = 0;
  for (const r of races) {
    const S = [];
    for (const s of r.schedule || []) {
      if (!s.start_time_utc) continue;
      const isRace = s.run_type === 3;
      S.push({ name: isRace ? 'Carrera' : clean(s.event_name), start: iso(s.start_time_utc.endsWith('Z') ? s.start_time_utc : s.start_time_utc + 'Z'), dur: isRace ? 210 : 60, main: isRace });
    }
    if (!S.some((s) => s.main)) {
      const d = r.race_date || r.date_scheduled;
      if (d) S.push({ name: 'Carrera', start: iso(/Z|[+-]\d\d:\d\d$/.test(d) ? d : d + '-05:00'), dur: 210, main: true });
    }
    const ev = { id: `nascar-${r.race_id}`, raceId: r.race_id, round: r.race_type_id === 1 ? ++round : null, name: clean(r.race_name), circuit: clean(r.track_name), location: clean(r.track_name), country: 'USA', iso: 'US', city: clean(r.track_name).replace(/\b(international|motor|super|speedway|raceway|race ?way|course|circuit|road|street|park|of|the)\b/gi, '').replace(/\s+/g, ' ').trim(), sessions: S };
    const main = S.find((s) => s.main);
    if (main && new Date(main.start).getTime() + 4 * 3600000 < NOW) {
      if (prevRes.has(ev.id)) main.result = prevRes.get(ev.id);
      else if (!recheck(main.start, prevChk.get(ev.id))) main.chk = prevChk.get(ev.id);
      else {
        main.chk = new Date().toISOString();
        try {
          const w = await getJSON(`https://cf.nascar.com/cacher/${Y}/1/${r.race_id}/weekend-feed.json`);
          const res = w?.weekend_race?.[0]?.results || [];
          main.result = res.sort((a, b) => a.finishing_position - b.finishing_position).slice(0, MAX_ROWS).map((x) => ({
            pos: num(x.finishing_position), name: clean(x.driver_fullname), team: clean(x.team_name || x.car_make), time: x.finishing_status || '', pts: num(x.points_earned),
          }));
          if (main.result.length) delete main.chk; else delete main.result;
        } catch { /* aún sin resultados */ }
        await sleep(300);
      }
    }
    events.push(finalize(ev));
  }

  // Clasificación: intenta el feed oficial de puntos; si no, suma de puntos por carrera
  let drivers = [], note = '';
  const lastDone = [...events].reverse().find((e) => e.done && e.raceId);
  for (const url of [
    lastDone && `https://cf.nascar.com/live/feeds/series_1/${lastDone.raceId}/live_points.json`,
    `https://cf.nascar.com/cacher/${Y}/1/racinginsights-points-feed.json`,
  ].filter(Boolean)) {
    try {
      const p = await getJSON(url);
      const arr = Array.isArray(p) ? p : p?.items || [];
      drivers = arr.map((x, i) => ({
        pos: num(x.points_position ?? x.position) || i + 1,
        name: clean(x.driver_name || x.full_name || `${x.first_name || ''} ${x.last_name || ''}`),
        team: clean(x.team_name || x.car_make || ''), pts: num(x.points), wins: num(x.wins),
      })).filter((d) => d.name && d.pts !== null).sort((a, b) => a.pos - b.pos);
      if (drivers.length) break;
    } catch { /* probar siguiente */ }
  }
  if (!drivers.length) {
    const t = {};
    for (const e of events) for (const s of e.sessions) if (s.main && s.result) for (const r of s.result) {
      t[r.name] ||= { name: r.name, team: r.team, pts: 0, wins: 0 };
      t[r.name].pts += r.pts || 0; if (r.pos === 1) t[r.name].wins++;
    }
    drivers = Object.values(t).sort((a, b) => b.pts - a.pts).map((d, i) => ({ pos: i + 1, ...d }));
    note = 'Suma de puntos por carrera (no aplica el reseteo de playoffs).';
  }
  return { season: Y, source: 'NASCAR.com feed', events, standings: { drivers, teams: [], note } };
}

// ---------------------------------------------------------------- TheSportsDB (genérico)
const TSDB = { f1: 4370, motogp: 4407, indycar: 4373, wrc: 4409, wec: 4413, imsa: 4488, nascar: 4393, wsbk: 4454 };
const DUR = { indycar: 150, wrc: 3 * 24 * 60 + 600, wec: 360, imsa: 240, wsbk: 45, nascar: 210, f1: 120, motogp: 45 };
const PTS = {
  indycar: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 5, 5],
  wsbk: [25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  wsbkSP: [12, 9, 7, 6, 5, 4, 3, 2, 1],
  wrc: [25, 17, 15, 12, 10, 8, 6, 4, 2, 1],
  nascar: [40, ...Array.from({ length: 35 }, (_, i) => 35 - i)],
};

function tsdbStart(e) {
  let ts = e.strTimestamp;
  if (ts) { ts = ts.replace(' ', 'T'); if (!/Z|[+-]\d\d:?\d\d$/.test(ts)) ts += 'Z'; return { start: iso(ts), tbc: /T00:00:00/.test(ts) }; }
  const t = (e.strTime || '').slice(0, 8);
  const unknown = !t || t === '00:00:00';
  return { start: iso(`${e.dateEvent}T${unknown ? '12:00:00' : t}Z`), tbc: unknown };
}
const SUFFIX = /\s*[-–(]?\s*(superpole race|superpole|race\s*\d+|sprint race|sprint|warm ?up\s*\d*|free practice\s*\d*|practice\s*\d*|qualifying\s*\d*)\s*\)?\s*$/i;
function sessionLabel(full, base) {
  const s = full.slice(base.length).replace(/^[\s\-–(]+|\)\s*$/g, '').trim();
  if (!s) return 'Carrera';
  return s.replace(/^race\s*(\d)/i, 'Carrera $1').replace(/^free practice/i, 'Libres').replace(/^qualifying/i, 'Clasificación');
}

async function tsdbSeries(key, prev, year = Y, strict = false) {
  const id = TSDB[key];
  let evs = (await tsdb(`eventsseason.php?id=${id}&s=${year}`))?.events || [];
  if (!evs.length && !strict) { year = year - 1; evs = (await tsdb(`eventsseason.php?id=${id}&s=${year}`))?.events || []; }
  if (!evs.length) throw new Error(`${key}: sin eventos en TheSportsDB`);

  const prevRes = new Map(), prevChk = new Map();
  for (const ev of prev?.events || []) for (const s of ev.sessions || []) { if (s.id && s.result?.length) prevRes.set(s.id, s.result); if (s.id && s.chk) prevChk.set(s.id, s.chk); }

  const groups = new Map();
  for (const e of evs) {
    const base = clean(e.strEvent).replace(SUFFIX, '').trim() || clean(e.strEvent);
    const k = num(e.intRound) > 0 ? `r${e.intRound}` : base;
    if (!groups.has(k)) groups.set(k, { base, round: num(e.intRound), items: [] });
    groups.get(k).items.push(e);
  }

  const events = [];
  for (const [, g] of groups) {
    const S = [];
    for (const e of g.items) {
      const { start, tbc } = tsdbStart(e);
      const label = sessionLabel(clean(e.strEvent), g.base);
      const isSP = /superpole race/i.test(e.strEvent);
      const isRace = !/practice|qualifying|warm ?up|libres/i.test(label);
      const s = { id: `tsdb-${e.idEvent}`, name: label, start, tbc, dur: isSP ? 25 : DUR[key] || 120, main: isRace && !isSP };
      if (isRace && new Date(start).getTime() < NOW) {
        if (prevRes.has(s.id)) s.result = prevRes.get(s.id);
        else if (!recheck(start, prevChk.get(s.id))) s.chk = prevChk.get(s.id);
        else {
          s.chk = new Date().toISOString();
          try {
            const rr = (await tsdb(`eventresults.php?id=${e.idEvent}`))?.results || [];
            s.result = rr.map((x) => ({ pos: num(x.intPosition), name: clean(x.strPlayer), team: clean(x.strTeam), time: clean(x.strResult || x.strDetail), pts: num(x.intPoints) }))
              .filter((x) => x.name && x.pos).sort((a, b) => a.pos - b.pos).slice(0, MAX_ROWS);
            if (!s.result.length) delete s.result; else delete s.chk;
          } catch { /* sin resultados */ }
        }
        if (s.result) s.result.forEach((r) => (r._sp = isSP));
      }
      S.push(s);
    }
    const first = g.items[0];
    events.push(finalize({
      id: `${key}-${year}-${g.round || g.base}`, round: g.round, name: g.base, circuit: clean(first.strVenue),
      location: [clean(first.strCity), clean(first.strCountry)].filter(Boolean).join(', '), country: clean(first.strCountry), city: clean(first.strCity), sessions: S,
    }));
  }
  events.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Clasificación: puntos publicados o estimados con la tabla oficial (sin bonus)
  let note = '';
  const t = {}, tm = {};
  let usedEstimate = false, any = false;
  if (!['wec', 'imsa'].includes(key)) {
    for (const ev of events) for (const s of ev.sessions) if (s.result) for (const r of s.result) {
      let p = r.pts;
      if (p === null) {
        const table = key === 'wsbk' && r._sp ? PTS.wsbkSP : PTS[key];
        if (!table) continue;
        p = table[r.pos - 1] || 0; usedEstimate = true;
      }
      any = true;
      t[r.name] ||= { name: r.name, team: r.team, pts: 0, wins: 0 };
      t[r.name].pts += p; if (r.pos === 1 && !r._sp) t[r.name].wins++;
      if (r.team) tm[r.team] = (tm[r.team] || 0) + p;
    }
  }
  for (const ev of events) for (const s of ev.sessions) if (s.result) s.result.forEach((r) => delete r._sp);
  if (usedEstimate) note = 'Clasificación estimada a partir de los resultados (sin puntos de bonus).';
  if (!any) note = ['wec', 'imsa'].includes(key) ? 'Campeonato multiclase: consulta los resultados por carrera.' : 'La fuente gratuita aún no publica la clasificación.';
  const drivers = Object.values(t).sort((a, b) => b.pts - a.pts).map((d, i) => ({ pos: i + 1, ...d }));
  const teams = Object.entries(tm).sort((a, b) => b[1] - a[1]).map(([name, pts], i) => ({ pos: i + 1, name, pts }));
  return { season: year, source: 'TheSportsDB', events, standings: { drivers, teams, note, teamsLabel: 'Equipos' } };
}

// ---------------------------------------------------------------- NOTICIAS (RSS)
const NEWS_OUT = new URL('../data/news.json', import.meta.url);
const MS = (lang, slug) => [lang, lang === 'es' ? 'Motorsport.com' : 'Motorsport.com (EN)', `https://${lang === 'es' ? 'es' : 'www'}.motorsport.com/rss/${slug}/news/`];
const AS = (slug) => ['en', 'Autosport', `https://www.autosport.com/rss/${slug}/news/`];
const FEEDS = {
  f1: [MS('es', 'f1'), ['es', 'Marca', 'https://e00-marca.uecdn.es/rss/motor/formula1.xml'], ['es', 'AS', 'https://as.com/rss/motor/formula_1/portada.xml'], MS('en', 'f1'), AS('f1'), ['en', 'Formula1.com', 'https://www.formula1.com/en/latest/all.xml']],
  motogp: [MS('es', 'motogp'), ['es', 'Marca', 'https://e00-marca.uecdn.es/rss/motor/motogp.xml'], ['es', 'AS', 'https://as.com/rss/motor/motogp/portada.xml'], MS('en', 'motogp'), AS('motogp')],
  wsbk: [MS('es', 'wsbk'), MS('en', 'wsbk'), AS('wsbk')],
  indycar: [MS('es', 'indycar'), MS('en', 'indycar'), AS('indycar')],
  nascar: [MS('es', 'nascar-cup'), MS('en', 'nascar-cup'), AS('nascar-cup')],
  wec: [MS('es', 'wec'), MS('en', 'wec'), AS('wec')],
  imsa: [MS('es', 'imsa'), MS('en', 'imsa'), AS('imsa')],
  wrc: [MS('es', 'wrc'), MS('en', 'wrc'), AS('wrc')],
};
const KEYWORDS = /\b(gana|ganador|victoria|vence|campe[oó]n|t[ií]tulo|pole|sanci[oó]n|penaliza|fichaje|ficha|renueva|contrato|accidente|lesi[oó]n|operad|calendario|oficial|retir|abandon|descalifica|r[eé]cord|hist[oó]ric|wins?|winner|victory|champion|title|crash|injur|signs?|contract|penalt|disqualif|confirm|calendar|record|retire|official)/i;
const FLUFF = /\b(v[ií]deo|video|galer[ií]a|gallery|fotos|photos|quiz|podcast|encuesta|poll|livestream|en directo|live:|as it happened|minuto a minuto)\b/i;
const STOP = new Set('para como sobre tras entre desde hasta pero porque cuando donde este esta estos estas the and with from after that this into over what will have their about been more than when they your'.split(' '));

async function getText(url, timeout = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const ent = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|laquo|raquo|hellip);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', hellip: '…' })[e]);
const rawTag = (x, t) => { const m = x.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? unCdata(m[1]).trim() : ''; };
const text = (h) => ent(ent(h).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (x, t, a) => { const m = x.match(new RegExp(`<${t}\\b[^>]*?\\s${a}=["']([^"']+)["']`, 'i')); return m ? ent(m[1]) : ''; };
const cleanUrl = (u) => { try { const x = new URL(u); [...x.searchParams.keys()].forEach((k) => /^utm_/.test(k) && x.searchParams.delete(k)); return x.toString(); } catch { return u; } };

function parseFeed(xml, [lang, source], key) {
  const out = [];
  for (const chunk of xml.split(/<item[\s>]|<entry[\s>]/i).slice(1)) {
    const title = text(rawTag(chunk, 'title'));
    let link = text(rawTag(chunk, 'link')) || attr(chunk, 'link', 'href');
    if (!/^https?:/.test(link)) link = text(rawTag(chunk, 'guid'));
    const date = rawTag(chunk, 'pubDate') || rawTag(chunk, 'published') || rawTag(chunk, 'updated') || rawTag(chunk, 'dc:date');
    const t = Date.parse(text(date));
    if (!title || !/^https?:/.test(link) || !t) continue;
    const descRaw = rawTag(chunk, 'description') || rawTag(chunk, 'summary') || rawTag(chunk, 'content');
    let img = attr(chunk, 'enclosure', 'url') || attr(chunk, 'media:content', 'url') || attr(chunk, 'media:thumbnail', 'url') || (ent(descRaw).match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] || '';
    if (img && !/^https:/.test(img)) img = img.startsWith('//') ? 'https:' + img : '';
    let summary = text(descRaw).replace(/\s*(Keep reading|Seguir leyendo|Leer más|Read more)\.?\s*$/i, '');
    if (summary.length > 170) summary = summary.slice(0, 167).replace(/\s+\S*$/, '') + '…';
    if (summary.toLowerCase().startsWith(title.toLowerCase().slice(0, 40))) summary = '';
    out.push({ key, lang, source, title, link: cleanUrl(link), date: new Date(t).toISOString(), img, summary });
  }
  return out;
}
const words = (t) => new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)));
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i || 1); };

async function updateNews() {
  const jobs = Object.entries(FEEDS).flatMap(([key, list]) => list.map((f) => ({ key, f })));
  const items = [], status = {};
  for (let i = 0; i < jobs.length; i += 6) {
    await Promise.all(jobs.slice(i, i + 6).map(async ({ key, f }) => {
      try { const got = parseFeed(await getText(f[2]), f, key); items.push(...got); status[`${key}:${f[1]}`] = got.length; }
      catch (e) { status[`${key}:${f[1]}`] = 'error: ' + e.message; }
    }));
  }
  const fresh = items.filter((x) => NOW - Date.parse(x.date) < 5 * 864e5 && Date.parse(x.date) < NOW + 3600e3);
  // quitar duplicados exactos (mismo enlace)
  const byLink = new Map(); for (const x of fresh) if (!byLink.has(x.link)) byLink.set(x.link, x);
  const list = [...byLink.values()];
  for (const x of list) {
    const h = (NOW - Date.parse(x.date)) / 3600e3;
    x._w = words(x.title);
    x._s = 100 * Math.exp(-h / 30) + (KEYWORDS.test(x.title) ? 18 : 0) - (FLUFF.test(x.title) ? 25 : 0) + (x.img ? 4 : 0) + (x.lang === 'es' ? 6 : 0);
  }
  // agrupar la misma noticia contada por varios medios → más relevante
  const out = [];
  for (const key of Object.keys(FEEDS)) {
    const pool = list.filter((x) => x.key === key).sort((a, b) => b._s - a._s);
    const used = new Set();
    for (const x of pool) {
      if (used.has(x)) continue;
      const cluster = [x, ...pool.filter((y) => y !== x && !used.has(y) && y.source !== x.source && jaccard(x._w, y._w) >= 0.3)];
      cluster.forEach((y) => used.add(y));
      const best = cluster.find((y) => y.lang === 'es') || x;
      const others = [...new Set(cluster.filter((y) => y !== best).map((y) => y.source))];
      out.push({ ...best, img: best.img || cluster.find((y) => y.img)?.img || '', also: others, score: Math.round(x._s + 22 * others.length) });
    }
  }
  const news = out.map(({ _w, _s, ...r }) => r).sort((a, b) => b.score - a.score);
  const perKey = {}; const final = news.filter((n) => (perKey[n.key] = (perKey[n.key] || 0) + 1) <= 30);
  let prevItems = null; try { prevItems = JSON.parse(await fs.readFile(NEWS_OUT, 'utf8')).items; } catch {}
  const strip = (a) => JSON.stringify((a || []).map(({ score, ...r }) => r.link).sort());
  if (prevItems && strip(prevItems) === strip(final)) { log('Noticias sin cambios.'); return; }
  await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await fs.writeFile(NEWS_OUT, JSON.stringify({ updated: new Date().toISOString(), items: final, feeds: status }));
  log(`Noticias: ${final.length} (de ${items.length} titulares).`);
}

// ---------------------------------------------------------------- FOTOS DE PILOTOS
// Se buscan una sola vez por piloto y se guardan en data/faces.json (las que no se encuentran se reintentan cada 7 días)
const FACES_OUT = new URL('../data/faces.json', import.meta.url);
const normName = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const RACING = /piloto|corredor|motociclista|automovilismo|driver|racing|racer|rider|motorcycle|nascar|indycar|rally|motorsport|formula|f[oó]rmula|endurance|resistencia|superbike|motogp/i;
function findPicture(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^https:\/\/.+\.(jpe?g|png|webp)(\?|$)/i.test(v) && /pic|portrait|profile|photo|image|main/i.test(k)) return v;
  }
  for (const v of Object.values(obj)) { const r = findPicture(v, depth + 1); if (r) return r; }
  return null;
}
const HINT = { f1: 'Formula One driver', motogp: 'MotoGP rider', moto2: 'Moto2 rider', moto3: 'Moto3 rider', wsbk: 'Superbike rider', indycar: 'IndyCar driver', nascar: 'NASCAR driver', wec: 'racing driver', imsa: 'racing driver', wrc: 'rally driver' };
async function wikiSummary(lang, title) {
  try {
    const j = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { retries: 0, timeout: 12000 });
    if (j?.type === 'standard' && j.thumbnail?.source && RACING.test(`${j.description || ''} ${j.extract || ''}`)) return j.thumbnail.source;
  } catch { /* no existe */ }
  return null;
}
async function wikiFace(name, key) {
  for (const lang of ['en', 'es']) { const u = await wikiSummary(lang, name); if (u) return u; }
  // búsqueda: "Nombre MotoGP rider" → primer artículo que sea de un piloto
  try {
    const q = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(`${name} ${HINT[key] || 'racing driver'}`)}`, { retries: 0, timeout: 12000 });
    const want = normName(name).split(' ').pop();
    for (const r of q?.query?.search || []) {
      if (!normName(r.title).includes(want)) continue;
      const u = await wikiSummary('en', r.title); if (u) return u;
    }
  } catch { /* sin resultados */ }
  return null;
}
const FACES_V = 3; // sube este número para volver a buscar las fotos que no se encontraron
async function updateFaces(series) {
  let db = {}; try { db = JSON.parse(await fs.readFile(FACES_OUT, 'utf8')).faces || {}; } catch {}
  const before = JSON.stringify(db);
  const today = () => new Date().toISOString().slice(0, 10);
  const set = (name, u, src) => { const k = normName(name); if (k && u && !db[k]?.u) db[k] = { u, s: src, t: today(), v: FACES_V }; };

  // F1: fotos oficiales vía OpenF1 (una sola petición)
  try {
    const list = await getJSON('https://api.openf1.org/v1/drivers?session_key=latest');
    for (const d of list || []) if (d.headshot_url) { set(d.full_name, d.headshot_url, 'openf1'); set(`${d.first_name} ${d.last_name}`, d.headshot_url, 'openf1'); }
  } catch (e) { log('  OpenF1:', e.message); }

  // MotoGP / Moto2 / Moto3: lista oficial de pilotos con sus fotos (una sola petición)
  try {
    const riders = await getJSON('https://api.motogp.pulselive.com/motogp/v1/riders');
    let found = 0;
    for (const r of Array.isArray(riders) ? riders : riders?.riders || []) {
      const pics = r.current_career_step?.pictures || r.pictures || {};
      const u = pics.profile?.main || pics.portrait || pics.profile?.secondary || findPicture(pics);
      const nm = r.full_name || [r.name, r.surname].filter(Boolean).join(' ');
      if (u && nm) { set(nm, u, 'motogp'); found++; }
    }
    log(`  MotoGP: ${found} fotos en la lista oficial`);
  } catch (e) { log('  MotoGP riders:', e.message); }

  // Resto: por prioridad (líderes del mundial primero)
  const want = [];
  for (const [key, s] of Object.entries(series)) {
    for (const d of s.standings?.drivers || []) want.push({ key, name: d.name, rid: d.rid });
    for (const ev of [...(s.events || [])].reverse()) for (const se of ev.sessions || []) for (const r of se.result || []) want.push({ key, name: r.name });
  }
  const seen = new Set(), todo = [];
  for (const w of want) {
    const k = normName(w.name); if (!k || seen.has(k)) continue; seen.add(k);
    const e = db[k];
    if (e?.u) continue;
    if (e && e.v === FACES_V && Date.now() - Date.parse(e.t) < 7 * 864e5) continue;
    todo.push(w);
  }
  const LIMIT = 60; let n = 0; const t0 = Date.now(), bySrc = {};
  for (const w of todo.slice(0, LIMIT)) {
    if (Date.now() - t0 > 75000) break; // como mucho 75 s por pasada; el resto en la siguiente
    let u = null, src = '';
    if (w.rid) {
      try {
        const j = await getJSON(`https://api.motogp.pulselive.com/motogp/v1/riders/${w.rid}`, { retries: 0 });
        const pics = j?.current_career_step?.pictures || j?.pictures || {};
        u = pics.profile?.main || pics.portrait || findPicture(pics) || null; src = 'motogp';
      } catch {}
    }
    if (!u) {
      try {
        const pl = (await tsdb(`searchplayers.php?p=${encodeURIComponent(w.name)}`))?.player || [];
        const hit = pl.find((x) => /motorsport/i.test(x.strSport || '')) || null;
        u = hit && (hit.strCutout || hit.strRender || hit.strThumb) || null; src = 'thesportsdb';
      } catch {}
    }
    if (!u) { u = await wikiFace(w.name, w.key); src = 'wikipedia'; }
    db[normName(w.name)] = u ? { u, s: src, t: today(), v: FACES_V } : { u: null, t: today(), v: FACES_V };
    if (u) bySrc[src] = (bySrc[src] || 0) + 1;
    n++;
  }
  if (JSON.stringify(db) !== before) {
    await fs.writeFile(FACES_OUT, JSON.stringify({ updated: new Date().toISOString(), faces: db }));
    log(`Fotos: ${Object.values(db).filter((x) => x.u).length} con foto (${n} búsquedas nuevas ${JSON.stringify(bySrc)}, ${Math.max(0, todo.length - n)} pendientes).`);
  }
}

// ---------------------------------------------------------------- COORDENADAS (para el tiempo)
const PLACES_OUT = new URL('../data/places.json', import.meta.url);
const ISO = { spain: 'ES', italy: 'IT', france: 'FR', germany: 'DE', portugal: 'PT', austria: 'AT', belgium: 'BE', netherlands: 'NL', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB', usa: 'US', 'united states': 'US', canada: 'CA', mexico: 'MX', brazil: 'BR', argentina: 'AR', japan: 'JP', china: 'CN', australia: 'AU', qatar: 'QA', bahrain: 'BH', 'saudi arabia': 'SA', uae: 'AE', 'united arab emirates': 'AE', singapore: 'SG', malaysia: 'MY', thailand: 'TH', indonesia: 'ID', india: 'IN', hungary: 'HU', 'czech republic': 'CZ', czechia: 'CZ', finland: 'FI', sweden: 'SE', estonia: 'EE', greece: 'GR', croatia: 'HR', kenya: 'KE', chile: 'CL', paraguay: 'PY', monaco: 'MC', azerbaijan: 'AZ', turkey: 'TR', poland: 'PL', latvia: 'LV', 'south africa': 'ZA', 'new zealand': 'NZ', 'san marino': 'SM' };
async function geocode(q, iso) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json${iso ? `&countryCode=${iso}` : ''}`;
  const j = await getJSON(url, { retries: 1, timeout: 12000 });
  const r = (j?.results || [])[0];
  return r ? { lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3) } : null;
}
async function updateGeo(series) {
  let db = {}; try { db = JSON.parse(await fs.readFile(PLACES_OUT, 'utf8')); } catch {}
  const before = JSON.stringify(db); let calls = 0;
  for (const s of Object.values(series)) for (const ev of [...(s.events || []), ...(s.next?.events || [])]) {
    if (ev.lat != null) continue;
    const iso = (ev.iso || ISO[String(ev.country || '').toLowerCase()] || '').toUpperCase();
    const tries = [ev.city, ev.circuit, String(ev.location || '').split(',')[0]].map((x) => clean(x)).filter((x) => x && x.length > 2);
    for (const q of [...new Set(tries)]) {
      const k = `${q}|${iso}`;
      if (!(k in db) && calls < 40) { try { db[k] = await geocode(q, iso); } catch { continue; } calls++; }
      if (db[k]) { ev.lat = db[k].lat; ev.lon = db[k].lon; break; }
    }
  }
  if (JSON.stringify(db) !== before) { await fs.writeFile(PLACES_OUT, JSON.stringify(db)); log(`Coordenadas: ${calls} búsquedas nuevas.`); }
}

// ---------------------------------------------------------------- TIEMPO POR SESIÓN (Open-Meteo)
// Cada día (se refresca cada 3 h) se busca la previsión de todas las sesiones de los próximos 6 días.
const WX_OUT = new URL('../data/weather.json', import.meta.url);
async function updateWeather(series) {
  let prev = { loc: {} }; try { prev = JSON.parse(await fs.readFile(WX_OUT, 'utf8')); if (!prev.loc) prev.loc = {}; } catch {}
  const now = Date.now(), want = new Map(); // "lat,lon" -> [{ id, t }]
  for (const s of Object.values(series)) for (const ev of [...(s.events || []), ...(s.next?.events || [])]) {
    if (ev.lat == null) continue;
    const key = `${(+ev.lat).toFixed(2)},${(+ev.lon).toFixed(2)}`;
    for (const se of ev.sessions || []) {
      const t = Date.parse(se.start); if (!t || se.tbc) continue;
      if (t < now - 6 * 3600e3 || t > now + 6 * 864e5) continue; // solo desde 6 días antes
      if (!want.has(key)) want.set(key, { lat: ev.lat, lon: ev.lon, list: [] });
      want.get(key).list.push({ id: `${ev.id}|${se.id || se.name}`, t });
    }
  }
  const out = { updated: new Date().toISOString(), loc: {}, s: {} };
  let calls = 0;
  for (const [key, w] of want) {
    let h = prev.loc[key]?.h, t = prev.loc[key]?.t || 0;
    if (!h || now - t > 3 * 3600e3) {
      try {
        const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&timezone=UTC&forecast_days=8`, { retries: 1, timeout: 15000 });
        if (j?.hourly?.time) { h = j.hourly; t = now; calls++; }
      } catch (e) { log('  tiempo:', e.message); }
    }
    if (!h) continue;
    out.loc[key] = { t, h };
    for (const x of w.list) {
      const d = new Date(x.t); d.setUTCMinutes(0, 0, 0);
      const i = h.time.indexOf(d.toISOString().slice(0, 13) + ':00');
      if (i >= 0 && h.temperature_2m[i] != null) out.s[x.id] = [Math.round(h.temperature_2m[i]), h.precipitation_probability?.[i] ?? null, h.weather_code[i], h.wind_speed_10m?.[i] != null ? Math.round(h.wind_speed_10m[i]) : null];
    }
  }
  const same = JSON.stringify(out.s) === JSON.stringify(prev.s || {}) && JSON.stringify(Object.keys(out.loc)) === JSON.stringify(Object.keys(prev.loc || {}));
  if (same && !calls) return;
  await fs.writeFile(WX_OUT, JSON.stringify(out));
  log(`Tiempo: ${Object.keys(out.s).length} sesiones con previsión (${calls} consultas nuevas).`);
}

// ---------------------------------------------------------------- AVISOS 15 MIN ANTES (ntfy)
// La app guarda tus preferencias en el tema "<tema>-cfg" de ntfy; aquí se leen y se programan
// los avisos en ntfy con entrega diferida, para que lleguen justo 15 minutos antes.
const ALERTS_CFG = new URL('../data/avisos.json', import.meta.url);
const ALERTS_SENT = new URL('../data/avisos-enviados.json', import.meta.url);
export const TOPIC = 'und-' + String(process.env.GITHUB_REPOSITORY || 'local/und').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56);
const NAMES2 = { f1: 'F1', motogp: 'MotoGP', moto2: 'Moto2', moto3: 'Moto3', wsbk: 'WorldSBK', indycar: 'IndyCar', nascar: 'NASCAR', wec: 'WEC', imsa: 'IMSA', wrc: 'WRC' };
function sessionType(name, main) {
  const n = String(name).toLowerCase();
  if (/superpole race|sprint/.test(n)) return 'sprint';
  if (/clasif|qualif|hyperpole|superpole|shootout/.test(n)) return 'clasif';
  if (/libre|práctica|practica|practice|warm|shakedown/.test(n)) return 'libres';
  if (main || /carrera|race|power stage|tramos/.test(n)) return 'carrera';
  return 'libres';
}
function tvText(tv, key, ev, se) {
  const c = tv?.series?.[key === 'moto2' || key === 'moto3' ? 'motogp' : key]; if (!c) return '';
  let canales = c.base || [], gratis = [];
  const year = new Date(se.start).getFullYear(), hay = `${ev.name} ${ev.circuit || ''} ${ev.location || ''}`;
  for (const r of c.reglas || []) {
    try {
      if (r.temporada && r.temporada !== year) continue;
      if (r.pais && ev.country !== r.pais && !String(ev.location || '').includes(r.pais)) continue;
      if (r.evento && !new RegExp(r.evento, 'i').test(hay)) continue;
      if (r.sesion && !new RegExp(r.sesion, 'i').test(se.name)) continue;
    } catch { continue; }
    if (r.canales) canales = r.canales;
    if (r.gratis) gratis = [...gratis, ...r.gratis];
  }
  return (gratis.length ? `GRATIS ${gratis.join(' · ')} · ` : '') + canales.join(' · ');
}
async function updateAlerts(series) {
  // Cada móvil guarda sus preferencias (con su propio tema de ntfy) en "<tema>-cfg"; aquí se juntan todas.
  let store = { devices: {} }; try { store = JSON.parse(await fs.readFile(ALERTS_CFG, 'utf8')); if (!store.devices) store = { devices: {} }; } catch {}
  const beforeStore = JSON.stringify(store);
  try {
    const txt = await getText(`https://ntfy.sh/${TOPIC}-cfg/json?poll=1&since=12h`);
    for (const l of txt.split('\n').filter(Boolean)) {
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m?.event !== 'message') continue;
      let c; try { c = JSON.parse(m.message); } catch { continue; }
      if (!c || typeof c !== 'object' || !/^[a-z0-9]{4,12}$/.test(String(c.dev || '')) || !/^[a-z0-9-]{8,64}$/.test(String(c.topic || ''))) continue;
      const old = store.devices[c.dev];
      if (!old || (c.t || 0) > (old.t || 0)) store.devices[c.dev] = { on: !!c.on, series: c.series || {}, tipos: c.tipos || {}, tz: c.tz, url: c.url, topic: c.topic, t: c.t || 0 };
    }
  } catch (e) { log('  ntfy cfg:', e.message); }
  const now = Date.now();
  for (const [d, c] of Object.entries(store.devices)) if (now - (c.t || 0) > 45 * 864e5) delete store.devices[d]; // móviles que no abren la app en 45 días
  if (JSON.stringify(store) !== beforeStore) { await fs.writeFile(ALERTS_CFG, JSON.stringify(store)); log(`Avisos: ${Object.keys(store.devices).length} móviles configurados.`); }
  const devices = Object.entries(store.devices).filter(([, c]) => c.on);
  if (!devices.length) return;

  let sent = {}; try { sent = JSON.parse(await fs.readFile(ALERTS_SENT, 'utf8')); } catch {}
  const beforeSent = JSON.stringify(sent);
  let tv = null; try { tv = JSON.parse(await fs.readFile(new URL('../data/tv.json', import.meta.url), 'utf8')); } catch {}
  let n = 0;
  for (const [key, s] of Object.entries(series)) {
    for (const ev of [...(s.events || []), ...(s.next?.events || [])]) for (const se of ev.sessions || []) {
      if (se.tbc || !se.start) continue;
      const t = Date.parse(se.start), at = t - 15 * 60000;
      if (t <= now || at > now + 3 * 3600e3) continue; // solo lo que empieza en las próximas ~3 h
      const type = sessionType(se.name, se.main);
      const tvs = tvText(tv, key, ev, se);
      for (const [dev, cfg] of devices) {
        if (!cfg.series?.[key] || !cfg.tipos?.[type]) continue;
        const id = `${dev}|${key}|${ev.name}|${se.name}|${se.start}`;
        if (sent[id]) continue;
        const tz = cfg.tz || 'Europe/Madrid';
        let fT, fD; try { fT = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz }); fD = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: tz }); } catch { fT = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }); fD = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' }); }
        const base = String(cfg.url || '').replace(/[^/]*$/, '');
        const body = {
          topic: cfg.topic, priority: 4, tags: ['checkered_flag'],
          title: `⏱️ ${at > now ? 'En 15 min' : `En ${Math.max(1, Math.round((t - now) / 60000))} min`} · ${NAMES2[key] || key} · ${se.name}`,
          message: `${ev.name}\n🕒 ${fD.format(t)} ${fT.format(t)}${tvs ? `\n📺 ${tvs}` : ''}`,
          ...(at > now + 60000 ? { delay: String(Math.floor(at / 1000)) } : {}),
          ...(/^https:\/\//.test(cfg.url || '') ? { click: cfg.url, icon: base + 'icons/icon-192.png' } : {}),
        };
        try {
          const r = await fetch('https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          sent[id] = new Date().toISOString(); n++;
        } catch (e) { log('  ntfy envío:', e.message); }
      }
    }
  }
  for (const [k, v] of Object.entries(sent)) if (now - Date.parse(v) > 4 * 864e5) delete sent[k];
  if (JSON.stringify(sent) !== beforeSent) await fs.writeFile(ALERTS_SENT, JSON.stringify(sent));
  if (n) log(`Avisos: ${n} programados.`);
}

// ---------------------------------------------------------------- main
async function main() {
  try { // datos fijos que la app necesita (tema de avisos)
    const meta = JSON.stringify({ topic: TOPIC, repo: process.env.GITHUB_REPOSITORY || '' });
    const mp = new URL('../data/meta.json', import.meta.url);
    let old = ''; try { old = await fs.readFile(mp, 'utf8'); } catch {}
    if (old !== meta) { await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true }); await fs.writeFile(mp, meta); }
  } catch {}
  try { // mantener despierto el proyecto de Supabase de la cuenta (los gratuitos se pausan si no se usan en 7 días)
    const cfg = await fs.readFile(new URL('../config.js', import.meta.url), 'utf8');
    const url = (cfg.match(/supabaseUrl:\s*'([^']+)'/) || [])[1], key = (cfg.match(/supabaseKey:\s*'([^']+)'/) || [])[1];
    if (url && key) await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } }).catch(() => {});
  } catch {}
  try { await updateNews(); } catch (e) { log('Noticias ERROR:', e.message); }

  let prev = { series: {} };
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* primera vez */ }

  const JOBS = [
    ['f1', f1], ['motogp', motogp],
    ['moto2', (p, y, st) => motogp(p, y, st, /^moto2/i, 'moto2')], ['moto3', (p, y, st) => motogp(p, y, st, /^moto3/i, 'moto3')],
    ['indycar', null], ['nascar', nascar],
    ['wec', null], ['imsa', null], ['wrc', null], ['wsbk', null],
  ];
  const out = { version: 1, updated: null, series: {} };
  for (const [key, fn] of JOBS) {
    const p = prev.series?.[key];
    log(`→ ${key}`);
    try {
      if (!fn) throw new Error('usa TheSportsDB');
      const d = await fn(p);
      if (!d.events?.length) throw new Error('sin eventos');
      out.series[key] = { ...d, status: 'ok' };
    } catch (e) {
      if (fn) log(`  ${key} principal falló: ${e.message} → TheSportsDB`);
      try {
        if (!TSDB[key]) throw e;
        out.series[key] = { ...(await tsdbSeries(key, p)), status: 'ok', fallback: !!fn };
      } catch (e2) {
        log(`  ${key} ERROR: ${e2.message}`);
        out.series[key] = p ? { ...p, status: 'stale', error: e2.message } : { status: 'error', error: e2.message, events: [], standings: { drivers: [], teams: [] } };
      }
    }
    log(`  ${key}: ${out.series[key].events.length} eventos`);

    // Próxima temporada: aparece sola en cuanto el campeonato publica el calendario
    if (key === 'moto2' || key === 'moto3') continue; // mismo calendario que MotoGP
    const ny = (out.series[key].season || Y) + 1;
    const pn = p?.next?.season === ny ? p.next : null;
    let nx = null;
    try { if (fn) nx = await fn(pn, ny, true); } catch { /* aún no publicado en la fuente principal */ }
    if (!nx?.events?.length) { try { nx = await tsdbSeries(key, pn, ny, true); } catch { nx = null; } }
    if (nx?.events?.length) {
      out.series[key].next = { season: ny, source: nx.source, events: nx.events, publishedAt: pn?.publishedAt || new Date().toISOString() };
      log(`  ${key} ${ny}: ${nx.events.length} eventos (próxima temporada)`);
    } else if (pn) out.series[key].next = pn; // no perder lo ya publicado si la fuente falla un rato
  }

  markChanges(prev.series || {}, out.series);
  try { await fs.rm(FACES_OUT, { force: true }); } catch {} // fotos de pilotos desactivadas: se borra el archivo antiguo
  try { await updateGeo(out.series); } catch (e) { log('Coordenadas ERROR:', e.message); }
  try { await updateWeather(out.series); } catch (e) { log('Tiempo ERROR:', e.message); }
  try { await updateAlerts(out.series); } catch (e) { log('Avisos ERROR:', e.message); }

  if (JSON.stringify(out.series) === JSON.stringify(prev.series)) { log('Sin cambios.'); return; }
  out.updated = new Date().toISOString();
  await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  log('data/data.json actualizado.');
  await writeCalendars(out);
}

// ---------------------------------------------------------------- cambios de horario
const evList = (s) => [...(s?.events || []), ...(s?.next?.events || [])];
function markChanges(prevSeries, series) {
  for (const [key, s] of Object.entries(series)) {
    const old = new Map();
    for (const ev of evList(prevSeries[key])) for (const se of ev.sessions || []) old.set(`${ev.id}|${se.id || se.name}`, se);
    for (const ev of evList(s)) for (const se of ev.sessions || []) {
      const o = old.get(`${ev.id}|${se.id || se.name}`);
      if (!o) continue;
      if (o.start !== se.start || !!o.tbc !== !!se.tbc) {
        se.changedAt = new Date().toISOString();
        se.prevStart = o.tbc ? null : o.start;
      } else if (o.changedAt) { se.changedAt = o.changedAt; if (o.prevStart !== undefined) se.prevStart = o.prevStart; }
    }
  }
}

// ---------------------------------------------------------------- calendarios suscribibles (.ics)
const NAMES = { f1: 'Fórmula 1', motogp: 'MotoGP', wsbk: 'WorldSBK', indycar: 'IndyCar', nascar: 'NASCAR Cup', wec: 'WEC', imsa: 'IMSA', wrc: 'WRC' };
const SHORT = { f1: 'F1', motogp: 'MotoGP', wsbk: 'SBK', indycar: 'IndyCar', nascar: 'NASCAR', wec: 'WEC', imsa: 'IMSA', wrc: 'WRC' };
const icsD = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsE = (s) => String(s || '').replace(/[\\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
const fold = (line) => { const out = []; let l = line; while (l.length > 74) { out.push(l.slice(0, 74)); l = ' ' + l.slice(74); } out.push(l); return out.join('\r\n'); };
function vevents(key, s) {
  const out = [], from = NOW - 30 * 864e5;
  for (const ev of evList(s)) for (const se of ev.sessions || []) {
    const t = new Date(se.start).getTime();
    if (!t || t < from) continue;
    const dur = Math.min((se.dur || 120) * 60000, 6 * 3600e3);
    const uid = `${key}-${(se.id || ev.id + '-' + se.name)}`.replace(/[^\w\-]/g, '') + '@pitwall';
    const L = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsD(se.changedAt || NOW)}`];
    if (se.tbc) L.push(`DTSTART;VALUE=DATE:${icsD(t).slice(0, 8)}`);
    else L.push(`DTSTART:${icsD(t)}`, `DTEND:${icsD(t + dur)}`);
    L.push(`SUMMARY:${icsE(`${SHORT[key]} · ${se.name}${se.tbc ? ' (hora por confirmar)' : ''} — ${ev.name}`)}`,
      `LOCATION:${icsE([ev.circuit, ev.location].filter(Boolean).join(' · '))}`,
      `DESCRIPTION:${icsE(`${NAMES[key]}${ev.round ? ' · Ronda ' + ev.round : ''}${se.result?.[0] ? '\nGanador: ' + se.result[0].name : ''}`)}`);
    if (!se.tbc && t > NOW) L.push('BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${icsE(SHORT[key] + ' ' + se.name)}`, 'END:VALARM');
    L.push('END:VEVENT');
    out.push(L.map(fold).join('\r\n'));
  }
  return out;
}
function vcal(name, events) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PitWall//Motor//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsE(name)}`, 'X-WR-TIMEZONE:Europe/Madrid', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H',
    ...events, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}
async function writeCalendars(data) {
  const dir = new URL('../data/cal/', import.meta.url);
  await fs.mkdir(dir, { recursive: true });
  const all = [];
  for (const [key, s] of Object.entries(data.series)) {
    const ev = vevents(key, s); all.push(...ev);
    await fs.writeFile(new URL(`${key}.ics`, dir), vcal(`UND · ${NAMES[key]}`, ev));
  }
  await fs.writeFile(new URL('todas.ics', dir), vcal('UND · Todas las series', all));
  log('Calendarios .ics actualizados.');
}

main().catch((e) => { console.error(e); process.exit(1); });
