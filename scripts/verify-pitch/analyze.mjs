// Critérios de aceite da troca de tom, calculados sobre o JSON que a página grava.
// Uso direto: node scripts/verify-pitch/analyze.mjs results/S1.json [S1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALIGN_MS = 2;        // click x instrumento transposto
const SPREAD_MS = 0.5;     // início entre faixas (medido na saída)
const START_EPS_MS = 0.01; // início agendado entre faixas do mesmo play
const JUMP_S = 0.02;       // salto de posição ao reiniciar
const CLOCK_MIN = 0.95;    // relógio de áudio / relógio de parede
const LEVEL_DB = -40;      // pico de RMS (janelas de 50 ms) antes de cada snapshot

const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? String(x) : (+x).toFixed(d));

export function analyze(key, R) {
  const checks = [];
  const add = (item, name, pass, detail) => checks.push({ item, scenario: key, name, pass: !!pass, detail });
  const cfg = R.cfg;
  const seq = cfg.SEQ;
  const exempt = new Set([cfg.CLICK, 'Voz Guia']);
  const instruments = cfg.instruments;
  const nChannels = cfg.channels.length;
  const voice = new Set(cfg.voice);
  const changes = R.events.filter((e) => e.type === 'changePitch');

  // ---------- item 1: worklets e fontes por snapshot ----------
  const wlInfo = (s) => {
    const wl = s.worklets.filter((w) => !w.noDebug);
    const active = wl.filter((w) => w.live + w.buf > 0);
    const inUse = wl.filter((w) => w.live > 0);
    const leaking = wl.filter((w) => w.buf > 0);
    const perCh = {};
    s.worklets.forEach((w) => w.targets.forEach((t) => { perCh[t] = (perCh[t] || 0) + 1; }));
    const dupCh = Object.entries(perCh).filter(([, n]) => n > 1).map(([c, n]) => `${c}x${n}`);
    return { existing: s.worklets.length, active: active.length, inUse: inUse.length, leaking: leaking.length, dupCh, noDebug: s.worklets.length - wl.length };
  };
  const srcInfo = (s) => {
    const byCh = {};
    s.sourcesAlive.forEach((a) => { byCh[a.ch] = (byCh[a.ch] || 0) + 1; });
    const dup = Object.entries(byCh).filter(([, n]) => n > 1).map(([c, n]) => `${c}x${n}`);
    const orphans = s.sourcesAlive.filter((a) => !a.referenced).map((a) => a.ch);
    return { alive: s.sourcesAlive.length, dup, orphans };
  };
  const isPlayingSnap = (s) => !s.label.startsWith('fim');
  if (seq !== 'NAN') {
    for (const s of R.snaps) {
      const w = wlInfo(s);
      const src = srcInfo(s);
      const tag = `[${s.label}] tom ${s.pitch}`;
      const wDetail = `existentes ${w.existing}, ativos ${w.active} (com fonte ${w.inUse}, sem fonte ${w.leaking})${w.dupCh.length ? ', duplicados ' + w.dupCh.join(' ') : ''}`;
      const expActive = isPlayingSnap(s) && s.pitch !== 0 ? instruments.length : 0;
      add(1, `${tag}: worklets ativos = ${expActive}`, w.active === expActive && w.inUse === expActive && w.leaking === 0 && w.noDebug === 0, wDetail);
      add(1, `${tag}: no máx. 1 worklet por canal e existentes <= ${instruments.length}`, w.dupCh.length === 0 && w.existing <= instruments.length, wDetail);
      const expAlive = isPlayingSnap(s) ? nChannels : 0;
      add(1, `${tag}: fontes vivas = ${expAlive}, sem órfãs/duplicadas`, src.alive === expAlive && src.dup.length === 0 && src.orphans.length === 0,
        `vivas ${src.alive}${src.dup.length ? ', duplicadas ' + src.dup.join(' ') : ''}${src.orphans.length ? ', órfãs ' + src.orphans.length : ''}`);
    }
    // velocidade do relógio de áudio entre snapshots tocando
    const pts = R.snaps.filter(isPlayingSnap).map((s) => [s.t, s.ctxTime]);
    const ratios = [];
    for (let i = 1; i < pts.length; i++) ratios.push((pts[i][1] - pts[i - 1][1]) / ((pts[i][0] - pts[i - 1][0]) / 1000));
    if (ratios.length) add(1, `relógio de áudio >= ${CLOCK_MIN} do tempo real`, Math.min(...ratios) >= CLOCK_MIN, ratios.map((r) => fmt(r, 3)).join(', '));
  }

  // ---------- nível de saída e NaN ----------
  const nanTotal = R.rms.reduce((a, r) => a + (r[3] || 0), 0);
  for (const s of R.snaps.filter(isPlayingSnap)) {
    const win = R.rms.filter((r) => r[0] >= s.ctxTime - 1.5 && r[0] < s.ctxTime);
    const mL = win.length ? Math.max(...win.map((r) => r[1])) : -999;
    const mR = win.length ? Math.max(...win.map((r) => r[2])) : -999;
    const nan = win.reduce((a, r) => a + (r[3] || 0), 0);
    add(seq === 'NAN' ? 6 : 1, `[${s.label}] saída com som (pico L e R > ${LEVEL_DB} dB) e sem NaN`, mL > LEVEL_DB && mR > LEVEL_DB && nan === 0,
      `pico L ${fmt(mL, 1)} dB, R ${fmt(mR, 1)} dB, amostras NaN ${nan}`);
  }
  if (seq === 'NAN') {
    add(6, 'nenhuma amostra NaN na saída durante todo o teste', nanTotal === 0, `amostras NaN ${nanTotal}`);
    const sem = R.snaps.flatMap((s) => s.worklets.map((w) => w.semitones));
    add(6, 'nenhum worklet com semitons NaN', !sem.some((v) => v === null || Number.isNaN(v)), `semitons vistos: ${[...new Set(sem.map(String))].join(', ') || 'nenhum worklet'}`);
  }

  // ---------- item 2: início das fontes ----------
  const recs = R.sources.slice().sort((a, b) => a.tStart - b.tStart);
  const groups = [];
  for (const r of recs) {
    const g = groups[groups.length - 1];
    // Mesmo play: mesmo offset e, com `when` agendado, o mesmo `when`; com start(0), chamadas próximas.
    const same = g && Math.abs(r.offset - g[0].offset) < 1e-6
      && (r.when > 0 || g[0].when > 0 ? Math.abs(r.when - g[0].when) < 1e-9 : r.tStart - g[0].tStart < 100);
    if (same) g.push(r); else groups.push([r]);
  }
  const spreads = groups.map((g) => (Math.max(...g.map((r) => r.eff)) - Math.min(...g.map((r) => r.eff))) * 1000);
  const sizes = groups.map((g) => g.length);
  const split = spreads.filter((x) => x > START_EPS_MS);
  const sizesBad = sizes.filter((n) => n !== nChannels);
  add(2, `todas as fontes de cada play no mesmo instante (<= ${START_EPS_MS} ms)`, split.length === 0 && sizesBad.length === 0,
    groups.length > 8
      ? `plays ${groups.length}; com faixas separadas ${split.length} (até ${fmt(Math.max(0, ...spreads), 3)} ms)${sizesBad.length ? '; faixas por play fora do esperado: ' + sizesBad.join(', ') : ''}`
      : `plays ${groups.length}; espalhamento ms: ${spreads.map((x) => fmt(x, 3)).join(', ')}; faixas por play: ${sizes.join(', ')}`);
  // salto de posição ao reiniciar (corrida na troca rápida)
  const jumps = [];
  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1], cur = groups[i];
    const stops = prev.map((r) => r.ctxAtStop).filter((x) => x !== null);
    const stopAt = stops.length ? Math.min(...stops) : null;
    if (stopAt === null) { jumps.push(NaN); continue; }
    const playedFrom = Math.min(...prev.map((r) => r.eff));
    const expected = prev[0].offset + Math.max(0, stopAt - playedFrom);
    jumps.push(cur[0].offset - expected);
  }
  if (jumps.length && seq !== 'SEEKS') add(1, `posição contínua ao reiniciar (|salto| <= ${JUMP_S} s)`, jumps.every((j) => Math.abs(j) <= JUMP_S), `saltos s: ${jumps.map((j) => fmt(j, 3)).join(', ')}`);

  // ---------- item 3: alinhamento (R − L) por trecho ----------
  if (seq !== 'NAN') {
    const bounds = changes.map((c) => ({ ctx: c.ctx, pitch: c.to }));
    const segs = [{ from: 0, pitch: 0 }, ...bounds.map((b) => ({ from: b.ctx, pitch: b.pitch }))];
    const pauseEv = R.events.find((e) => e.type === 'pause');
    const endCtx = pauseEv ? pauseEv.ctx : 1e9;
    segs.forEach((s, i) => {
      const to = i + 1 < segs.length ? segs[i + 1].from : endCtx;
      if (to - s.from < 1.2) return; // trecho curto da troca rápida
      // SEEKS: fora os 300 ms depois de cada reinício (o click cortado pelo stop
      // sai diferente em cada phase vocoder); o instante agendado é checado acima.
      const seekCtx = R.events.filter((e) => e.type === 'seekTo').map((e) => e.ctx);
      const settled = (t) => !seekCtx.some((c) => t >= c && t < c + 0.3);
      const vals = R.rRelLms.filter((p) => p[0] >= s.from + 0.8 && p[0] < to && settled(p[0])).map((p) => p[1]);
      if (!vals.length) { add(seq === 'SPREAD' ? 2 : 3, `trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s: alinhamento`, false, 'sem pares de onset'); return; }
      const sorted = vals.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const worst = Math.max(...vals.map(Math.abs));
      const pk = R.rms.filter((r) => r[0] >= s.from + 0.8 && r[0] < to);
      if (pk.length) checks.push({ item: 0, scenario: key, name: `nível no trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s`, pass: true, info: true,
        detail: `pico L ${fmt(Math.max(...pk.map((r) => r[1])), 1)} dB, pico R ${fmt(Math.max(...pk.map((r) => r[2])), 1)} dB` });
      if (seq === 'SPREAD' || seq === 'SEEKS') {
        add(2, `trecho tom ${s.pitch}: 1ª e última faixa começam juntas (|R−L| <= ${SPREAD_MS} ms)`, worst <= SPREAD_MS,
          `n ${vals.length}, mediana ${fmt(med)} ms, pior ${fmt(worst)} ms, pares fora ${vals.filter((v) => Math.abs(v) > SPREAD_MS).length}`);
      } else {
        add(3, `trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s: click x instrumento (|R−L| <= ${ALIGN_MS} ms)`, worst <= ALIGN_MS,
          `n ${vals.length}, mediana ${fmt(med)} ms, pior ${fmt(worst)} ms`);
      }
    });
  }

  // ---------- item 3: rota de quem não passa pelo worklet ----------
  if (seq === 'S1' || seq === 'S2') {
    const bad = [];
    for (const s of R.snaps.filter(isPlayingSnap)) {
      for (const a of s.sourcesAlive.filter((x) => exempt.has(x.ch) && !x.route.includes('worklet'))) {
        const want = s.pitch !== 0 ? 'delay' : 'panner';
        if (a.route !== want) bad.push(`[${s.label}] ${a.ch}: ${a.route} (esperado ${want})`);
      }
    }
    add(3, 'click/guia: com atraso no tom != 0 e direto (sem atraso) no tom 0', bad.length === 0, bad.length ? bad.slice(0, 4).join('; ') : 'ok');
  }

  // ---------- item 4: click/guia fora do caminho do tom ----------
  if (seq === 'S1' || seq === 'S2') {
    const viaWorklet = new Set();
    for (const s of R.snaps) {
      s.sourcesAlive.filter((a) => exempt.has(a.ch) && a.route.includes('worklet')).forEach((a) => viaWorklet.add(a.ch));
      s.worklets.forEach((w) => w.targets.filter((t) => exempt.has(t)).forEach((t) => viaWorklet.add(t)));
    }
    add(4, `click "${cfg.CLICK}" e voz guia nunca passam pelo worklet de tom`, viaWorklet.size === 0, viaWorklet.size ? 'passaram: ' + [...viaWorklet].join(', ') : 'ok');
    const pan = cfg.pansAtLoad ? cfg.pansAtLoad[cfg.CLICK] : undefined;
    add(4, `click "${cfg.CLICK}" reconhecido na carga (autoPan manda pro L: pan -1)`, pan === -1, `pan na carga ${pan}`);
  }

  // ---------- item 5: formantes só em voz ----------
  if (seq === 'S1') {
    const wrong = new Set();
    let seen = 0;
    for (const s of R.snaps.filter((x) => isPlayingSnap(x) && x.pitch !== 0)) {
      for (const w of s.worklets) {
        if (w.noDebug || w.live === 0) continue;
        const ch = w.targets.find((t) => typeof t === 'string');
        if (!ch) continue;
        seen++;
        if (w.formant !== voice.has(ch)) wrong.add(`${ch}=${w.formant}`);
      }
    }
    add(5, `formantes ligados só em voz (${[...voice].join(', ') || 'nenhuma voz'})`, seen > 0 && wrong.size === 0, wrong.size ? 'errados: ' + [...wrong].join(', ') : `ok (${seen} leituras)`);
  }

  const errs = R.events.filter((e) => /error|rejection/.test(e.type));
  if (errs.length) checks.push({ item: 0, scenario: key, name: 'erros no console da página', pass: true, info: true, detail: errs.slice(0, 5).map((e) => e.msg).join(' | ') });
  return checks;
}

export function printReport(results) {
  let ok = true;
  const all = [];
  for (const r of results) {
    if (r.fatal) { ok = false; console.log(`\n### ${r.key}: ERRO ${r.fatal}`); continue; }
    all.push(...r.checks);
  }
  const items = [...new Set(all.map((c) => c.item))].sort();
  for (const it of items) {
    console.log(`\n== item ${it || '(info)'} ==`);
    for (const c of all.filter((x) => x.item === it)) {
      if (!c.pass) ok = false;
      console.log(`  ${c.info ? 'INFO' : c.pass ? 'PASS' : 'FAIL'}  ${c.scenario}  ${c.name}  ::  ${c.detail}`);
    }
  }
  const fails = all.filter((c) => !c.pass).length;
  console.log(`\nresumo: ${all.filter((c) => !c.info).length} critérios, ${fails} falhas`);
  return ok;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const key = process.argv[3] || path.basename(file).split('_')[0].replace('.json', '');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.fatal) { console.log('FATAL', data.fatal); process.exit(1); }
  process.exit(printReport([{ key, checks: analyze(key, data) }]) ? 0 : 1);
}
