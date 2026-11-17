// Critérios de aceite da troca de tom e do palco novo, calculados sobre o JSON que a página grava.
// Uso direto: node scripts/verify-pitch/analyze.mjs results/S1.json [S1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ALIGN_MS = 2;        // click x instrumento transposto
const SPREAD_MS = 0.5;     // início entre faixas (medido na saída)
const START_EPS_MS = 0.01; // início agendado entre faixas do mesmo play
const JUMP_S = 0.02;       // salto de posição ao reiniciar
const CLOCK_MIN = 0.95;    // relógio de áudio / relógio de parede
const LEVEL_DB = -40;      // pico de RMS (janelas de 50 ms) antes de cada snapshot
const LEVEL_MATCH_DB = 0.1; // LEVELS: nível transposto x tom 0, por faixa
const CH_LEVEL_DB = -70;   // SONGS: nível mínimo de cada faixa da música tocando (silêncio = -180)
// Rodada 1, item 2: referência da v1.4.9 (5e051c2, start(0) sem folga) medida neste
// harness. Seek no tom 0: mediana 0,0 ms. Loop: buraco na emenda, sem o atraso do
// rAF, mediana 0,0 ms. O código promete a folga de 2 blocos de áudio (5,33 ms a
// 48 kHz, a mínima que não separa faixas sob carga) contada do relógio lido no FIM
// da preparação das fontes; isso é conferido exato no `when` instrumentado (critério
// "folga agendada"). O tempo de reação (da chamada até o som) é medido do relógio
// lido na CHAMADA, e entre os dois o motor pode virar 1 bloco (a preparação com
// worklets posta mensagens pra cada um): por isso a MEDIANA do tempo de reação no
// RESTART e no LOOP aceita 2 blocos + 1 bloco de tolerância + 0,5 ms de medição
// (revisão da v1.4.16, seção 6); transposto, só a latência compensada a mais. Os
// critérios de alinhamento entre faixas (START_EPS_MS, SPREAD_MS) não mudam.
const V149_SEEK_MS = 0.0;
const V149_LOOP_HOLE_MS = 0.0;
const START_LEAD_QUANTA = 2;
const REACTION_SLACK_QUANTA = 1;
const RESTART_SLACK_MS = (START_LEAD_QUANTA + REACTION_SLACK_QUANTA) * 128 / 48 + 0.5;
// Folga de reserva da rede de segurança do play() (RETRY_LEAD_S = 40 ms).
const RETRY_LEAD_S = 0.04;
const LEAD_EPS_MS = 0.01;  // `when` - relógio no start(), gravado com 10 µs de resolução
const LATENCY_MS = 120;

const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? String(x) : (+x).toFixed(d));

export function analyze(key, R, opts = {}) {
  const checks = [];
  const label = opts.part ? `${key}-${opts.part}` : key;
  const add = (item, name, pass, detail) => checks.push({ item, scenario: label, name, pass: !!pass, detail });
  const cfg = R.cfg;
  const seq = cfg.SEQ;
  // Música de teste do palco novo (T30): critérios próprios, mais os gerais que valem pra ela.
  const palco = !!cfg.SONG;
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
      const expT = s.expect ? s.expect.transposable : instruments.length;
      const maxT = cfg.maxTransposable || instruments.length;
      const expActive = isPlayingSnap(s) && s.pitch !== 0 ? expT : 0;
      add(1, `${tag}: worklets ativos = ${expActive}`, w.active === expActive && w.inUse === expActive && w.leaking === 0 && w.noDebug === 0, wDetail);
      add(1, `${tag}: no máx. 1 worklet por canal e existentes <= ${maxT}`, w.dupCh.length === 0 && w.existing <= maxT, wDetail);
      const expAlive = isPlayingSnap(s) ? (s.expect ? s.expect.channels : nChannels) : 0;
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
  let groups = [];
  for (const r of recs) {
    const g = groups[groups.length - 1];
    // Mesmo play: mesmo offset e, com `when` agendado, o mesmo `when`; com start(0), chamadas próximas.
    const same = g && Math.abs(r.offset - g[0].offset) < 1e-6
      && (r.when > 0 || g[0].when > 0 ? Math.abs(r.when - g[0].when) < 1e-9 : r.tStart - g[0].tStart < 100);
    if (same) g.push(r); else groups.push([r]);
  }
  // Play refeito: todas as fontes paradas na mesma execução do start() (o play
  // viu o relógio passar do instante comum e reagendou) e o grupo seguinte com o
  // mesmo offset. Esse grupo não conta como play (as fontes dele foram descartadas).
  const isRedone = (g, next) => !!next && Math.abs(next[0].offset - g[0].offset) < 1e-6
    && g.every((r) => typeof r.tStop === 'number' && r.tStop - r.tStart < 30);
  const redone = groups.filter((g, i) => isRedone(g, groups[i + 1]));
  const allGroups = groups;
  groups = groups.filter((g) => !redone.includes(g));
  const spreads = groups.map((g) => (Math.max(...g.map((r) => r.eff)) - Math.min(...g.map((r) => r.eff))) * 1000);
  const sizes = groups.map((g) => g.length);
  const split = spreads.filter((x) => x > START_EPS_MS);
  // Com várias músicas, cada play tem o número de faixas da música dele.
  const sizesBad = groups.filter((g) => g.length !== (cfg.songSizes && g[0].song >= 0 ? cfg.songSizes[g[0].song] : nChannels)).map((g) => g.length);
  add(2, `todas as fontes de cada play no mesmo instante (<= ${START_EPS_MS} ms)`, split.length === 0 && sizesBad.length === 0,
    groups.length > 8
      ? `plays ${groups.length}; com faixas separadas ${split.length} (até ${fmt(Math.max(0, ...spreads), 3)} ms)${sizesBad.length ? '; faixas por play fora do esperado: ' + sizesBad.join(', ') : ''}`
      : `plays ${groups.length}; espalhamento ms: ${spreads.map((x) => fmt(x, 3)).join(', ')}; faixas por play: ${sizes.join(', ')}`);
  // salto de posição ao reiniciar (corrida na troca rápida)
  const jumps = [];
  for (let i = 1; i < groups.length; i++) {
    const prev = groups[i - 1], cur = groups[i];
    // Música trocada: a nova começa do 0.
    if (cur[0].song !== undefined && cur[0].song !== prev[0].song) { jumps.push(cur[0].offset); continue; }
    const stops = prev.map((r) => r.ctxAtStop).filter((x) => x !== null);
    const stopAt = stops.length ? Math.min(...stops) : null;
    if (stopAt === null) { jumps.push(NaN); continue; }
    const playedFrom = Math.min(...prev.map((r) => r.eff));
    const expected = prev[0].offset + Math.max(0, stopAt - playedFrom);
    jumps.push(cur[0].offset - expected);
  }
  if (redone.length || seq === 'STALL') {
    const stalls = R.events.filter((e) => e.type === 'seekTo' && e.stall).length;
    if (seq === 'STALL') add('R1-2', `play travado no meio do laço de start(): descartado e reagendado (${stalls} travas)`, redone.length === stalls, `refeitos ${redone.length} de ${allGroups.length} grupos de start()`);
    else checks.push({ item: 'R1-2', scenario: label, name: 'plays refeitos (relógio passou do instante comum durante o laço)', pass: true, info: true, detail: `${redone.length}` });
  }
  if (jumps.length && !palco && !['SEEKS', 'RESTART', 'LOOP', 'STALL'].includes(seq)) add(1, `posição contínua ao reiniciar (|salto| <= ${JUMP_S} s)`, jumps.every((j) => Math.abs(j) <= JUMP_S), `saltos s: ${jumps.map((j) => fmt(j, 3)).join(', ')}`);

  // ---------- rodada 1, item 5: play pendente cancelado na troca de música ----------
  if (seq === 'PENDENTE') {
    const ends = R.events.filter((e) => e.type === 'pendingSwitch' || (e.type === 'play' && !e.pending));
    for (const e of R.events.filter((x) => x.type === 'pendingSwitch')) {
      const end = ends.find((x) => x.t > e.t);
      const late = R.sources.filter((r) => r.song === e.from && r.tStart >= e.t && (!end || r.tStart < end.t));
      add('R1-5', `play pendente da música ${'ABC'[e.from]} e ${e.kind} antes do worklet nascer: a música anterior não toca`, late.length === 0,
        late.length ? `${late.length} fontes dela começaram depois da troca` : 'nenhuma fonte dela começou');
    }
    const quiet = R.snaps.find((x) => x.label.startsWith('fim das trocas'));
    if (quiet) add('R1-5', 'depois das trocas: nada tocando', !quiet.isPlaying && quiet.sourcesAlive.length === 0, `isPlaying ${quiet.isPlaying}, fontes vivas ${quiet.sourcesAlive.length}`);
  }

  // ---------- rodada 1, itens 3 e 5: som em todas as faixas da música tocando ----------
  if (seq === 'SONGS' || seq === 'PENDENTE') {
    for (const s of R.snaps.filter(isPlayingSnap)) {
      const lv = Object.entries(s.levels);
      const quiet = lv.filter(([, v]) => !(v.total > CH_LEVEL_DB));
      const low = lv.length ? Math.min(...lv.map(([, v]) => v.total)) : null;
      add(seq === 'SONGS' ? 'R1-3' : 'R1-5', `[${s.label}] som em todas as ${lv.length} faixas (> ${CH_LEVEL_DB} dB)`, lv.length === s.expect.channels && quiet.length === 0,
        quiet.length ? 'sem som: ' + quiet.map(([n, v]) => `${n} ${fmt(v.total)} dB`).join(', ') : `faixa mais baixa ${fmt(low)} dB`);
    }
  }

  // ---------- rodada 1, item 1: nível mono/estéreo transposto x tom 0 ----------
  if (seq === 'LEVELS') {
    const base = R.snaps.find((x) => x.label === 'tom 0');
    for (const other of R.snaps.filter((x) => isPlayingSnap(x) && x !== base)) {
      const ctl = other.levels['Controle C'] && base.levels['Controle C'] ? other.levels['Controle C'].total - base.levels['Controle C'].total : null;
      if (ctl !== null) checks.push({ item: 'R1-1', scenario: label, name: `[${other.label}] controle (erro do vocoder em 440 Hz)`, pass: true, info: true, detail: `dif ${fmt(ctl)} dB` });
      for (const name of ['Mono R', 'Mono C', 'Estereo R', 'Estereo C']) {
        const a = base.levels[name], b = other.levels[name];
        const d = b.total - a.total;
        const detail = `tom 0 ${fmt(a.total)} dB (L ${fmt(a.L)} R ${fmt(a.R)}), agora ${fmt(b.total)} dB (L ${fmt(b.L)} R ${fmt(b.R)}), dif ${fmt(d)} dB`;
        // Estéreo: o critério é não mudar com a correção (compara-se entre execuções);
        // a diferença que sobra é do próprio phase vocoder naquele tom.
        if (name.startsWith('Estereo')) checks.push({ item: 'R1-1', scenario: label, name: `[${other.label}] ${name}: nível transposto x tom 0`, pass: true, info: true, detail });
        else {
          add('R1-1', `[${other.label}] ${name}: nível igual ao do tom 0 (|dif| <= ${LEVEL_MATCH_DB} dB)`, Math.abs(d) <= LEVEL_MATCH_DB, detail);
          if (ctl !== null) add('R1-1', `[${other.label}] ${name}: efeito do panner (dif - controle) <= 0.05 dB`, Math.abs(d - ctl) <= 0.05, `dif ${fmt(d)} - controle ${fmt(ctl)} = ${fmt(d - ctl)} dB`);
        }
      }
    }
    if (cfg.pannerCfg) {
      const wrong = Object.entries(cfg.pannerCfg).filter(([, p]) => (p.canais === 1 ? !(p.count === 1 && p.mode === 'explicit') : !(p.count === 2 && p.mode !== 'explicit')));
      add('R1-1', 'panner: faixa mono em 1 canal (explicit); estéreo sem mudança', wrong.length === 0,
        wrong.length ? wrong.map(([n, p]) => `${n}: ${p.canais} canal(is), panner ${p.count}/${p.mode}`).join('; ') : 'ok');
    }
  }

  // ---------- item 3: alinhamento (R − L) por trecho ----------
  if (seq !== 'NAN' && seq !== 'LEVELS' && seq !== 'PENDENTE' && !palco) {
    const bounds = changes.map((c) => ({ ctx: c.ctx, pitch: c.to }));
    const segs = [{ from: 0, pitch: 0 }, ...bounds.map((b) => ({ from: b.ctx, pitch: b.pitch }))];
    const pauseEv = R.events.find((e) => e.type === 'pause');
    const endCtx = pauseEv ? pauseEv.ctx : 1e9;
    segs.forEach((s, i) => {
      const to = i + 1 < segs.length ? segs[i + 1].from : endCtx;
      if (to - s.from < 1.2) return; // trecho curto da troca rápida
      // SEEKS: fora os 300 ms depois de cada reinício (o click cortado pelo stop
      // sai diferente em cada phase vocoder); o instante agendado é checado acima.
      const seekCtx = R.events.filter((e) => ['seekTo', 'jumpToSong', 'removeSong'].includes(e.type)).map((e) => e.ctx);
      const settled = (t) => !seekCtx.some((c) => t >= c && t < c + 0.3);
      const vals = R.rRelLms.filter((p) => p[0] >= s.from + 0.8 && p[0] < to && settled(p[0])).map((p) => p[1]);
      if (!vals.length) { add(seq === 'SPREAD' ? 2 : 3, `trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s: alinhamento`, false, 'sem pares de onset'); return; }
      const sorted = vals.slice().sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const worst = Math.max(...vals.map(Math.abs));
      const pk = R.rms.filter((r) => r[0] >= s.from + 0.8 && r[0] < to);
      if (pk.length) checks.push({ item: 0, scenario: label, name: `nível no trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s`, pass: true, info: true,
        detail: `pico L ${fmt(Math.max(...pk.map((r) => r[1])), 1)} dB, pico R ${fmt(Math.max(...pk.map((r) => r[2])), 1)} dB` });
      if (seq === 'SPREAD' || seq === 'SEEKS' || seq === 'STALL') {
        add(2, `trecho tom ${s.pitch}: 1ª e última faixa começam juntas (|R−L| <= ${SPREAD_MS} ms)`, worst <= SPREAD_MS,
          `n ${vals.length}, mediana ${fmt(med)} ms, pior ${fmt(worst)} ms, pares fora ${vals.filter((v) => Math.abs(v) > SPREAD_MS).length}`);
      } else {
        add(3, `trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s: click x instrumento (|R−L| <= ${ALIGN_MS} ms)`, worst <= ALIGN_MS,
          `n ${vals.length}, mediana ${fmt(med)} ms, pior ${fmt(worst)} ms`);
      }
    });
  }

  // ---------- item 3: rota de quem não passa pelo worklet ----------
  if (seq === 'S1' || seq === 'S2' || seq === 'SONGS') {
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
  if (seq === 'S1' || seq === 'S2' || seq === 'SONGS') {
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

  // ---------- rodada 1, item 2: buraco no reinício e reinício sem await ----------
  const pitchAt = (t) => { let p = 0; for (const c of changes) if (c.ctx <= t) p = c.to; return p; };
  const stats = (v) => { if (!v.length) return null; const so = v.slice().sort((x, y) => x - y); return { n: v.length, med: so[Math.floor(so.length / 2)], max: so[so.length - 1], min: so[0] }; };
  if (seq === 'RESTART') {
    const L_on = R.onsetsL || [];
    const R_on = R.onsetsR || [];
    for (const p of [0, 2]) {
      const seeksP = R.events.filter((e) => e.type === 'seekTo' && pitchAt(e.ctx) === p);
      const gL = [], gR = [];
      // 2º click novo (0,55 s depois do alvo): o 1º pode se confundir com a cauda
      // de 120 ms do áudio antigo quando transposto. Inclui a latência quando há.
      for (const e of seeksP) {
        const pick = (on) => on.find((t) => t > e.ctx + 0.54 && t < e.ctx + 0.85);
        const l = pick(L_on), r = pick(R_on);
        if (l !== undefined) gL.push((l - e.ctx - 0.55) * 1000);
        if (r !== undefined) gR.push((r - e.ctx - 0.55) * 1000);
      }
      const sl = stats(gL), sr = stats(gR);
      const limit = V149_SEEK_MS + RESTART_SLACK_MS + (p !== 0 ? LATENCY_MS : 0);
      add('R1-2', `reinício (seek) no tom ${p}: chamada até o 2º click novo, menos 0,55 s (mediana <= ${fmt(limit, 2)} ms)`, !!sl && !!sr && sl.med <= limit && sr.med <= limit,
        sl && sr ? `click: mediana ${fmt(sl.med, 1)} ms, ${fmt(sl.min, 1)} a ${fmt(sl.max, 1)} ms; instrumento: mediana ${fmt(sr.med, 1)} ms, ${fmt(sr.min, 1)} a ${fmt(sr.max, 1)} ms (n ${sl.n})` : 'sem onsets');
    }
  }
  if (seq === 'LOOP' && !palco) {
    // Seção B do harness: [2, 3,0137) s. Cada volta do loop é um grupo de start()
    // com offset 2 (início da seção). O fim da seção é detectado pelo rAF da tela
    // (0 a 16,7 ms depois, igual na v1.4.9): esse atraso sai das fontes (stop x
    // fim da seção no relógio de áudio) e é descontado da emenda medida na saída.
    const SEC_START = 2, SEC_END = 3.0137;
    const effOf = (g) => Math.min(...g.map((r) => r.eff));
    const loops = [];
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i], prev = groups[i - 1];
      if (Math.abs(g[0].offset - SEC_START) > 1e-6) continue;
      const stopT = Math.min(...prev.map((r) => (typeof r.ctxAtStop === 'number' ? r.ctxAtStop : Infinity)));
      if (!Number.isFinite(stopT)) continue;
      const mark = prev.map((r) => r.stopMark).find(Boolean);
      loops.push({ T: stopT, over: (stopT - (effOf(prev) + SEC_END - prev[0].offset)) * 1000, sched: (effOf(g) - stopT) * 1000,
        sync: !!mark && g.every((r) => r.startMark === mark) });
    }
    const loopOn = R.events.find((e) => e.type === 'armLoop'); const loopOff = R.events.find((e) => e.type === 'cancelLoop');
    const ch = changes[0] ? changes[0].ctx : 1e9;
    for (const p of [0, 2]) {
      for (const side of ['L', 'R']) {
        const on = (side === 'L' ? R.onsetsL : R.onsetsR) || [];
        const raw = [], hole = [], over = [];
        for (let i = 1; i < on.length; i++) {
          const t0 = on[i - 1], t1 = on[i];
          if (t0 < loopOn.ctx + 1.2 || t1 > loopOff.ctx) continue;
          if (Math.abs(t0 - ch) < 1.2 || Math.abs(t1 - ch) < 1.2) continue;
          if (pitchAt(t0) !== p) continue;
          // Dentro da seção o intervalo é 0,5 s; na emenda o ideal é 0,5137 s.
          if (t1 - t0 < 0.5 + 0.0068) continue;
          const lp = loops.find((x) => x.T > t0 && x.T < t1);
          raw.push((t1 - t0 - 0.5137) * 1000);
          if (lp) { hole.push((t1 - t0 - 0.5137) * 1000 - lp.over); over.push(lp.over); }
        }
        const sr = stats(raw), sh = stats(hole), so = stats(over);
        const limit = V149_LOOP_HOLE_MS + RESTART_SLACK_MS + (p !== 0 ? LATENCY_MS : 0);
        add('R1-2', `loop no tom ${p}, ${side === 'L' ? 'click' : 'instrumento'}: buraco na emenda, sem o atraso do rAF (mediana <= ${fmt(limit, 2)} ms)`, !!sh && sh.med <= limit,
          sh ? `buraco: mediana ${fmt(sh.med, 1)} ms, ${fmt(sh.min, 1)} a ${fmt(sh.max, 1)} ms; emenda medida: mediana ${fmt(sr.med, 1)} ms; atraso do rAF: mediana ${fmt(so.med, 1)} ms, ${fmt(so.min, 1)} a ${fmt(so.max, 1)} ms (n ${sh.n})` : 'sem emendas');
      }
    }
    const asyncLoops = loops.filter((x) => !x.sync);
    add('R1-2', 'volta do loop sem await (start() na mesma execução do stop())', loops.length > 0 && asyncLoops.length === 0,
      `${loops.length} voltas; ${asyncLoops.length} com await; folga agendada: mediana ${fmt(stats(loops.map((x) => x.sched))?.med, 2)} ms`);
  }
  if (seq === 'RESTART' || seq === 'SEEKS' || seq === 'STALL') {
    // Depois que os worklets existem, reinício (seek/loop) e volta ao tom 0 não podem passar por await.
    const firstUp = changes.find((c) => c.to !== 0);
    const restarts = R.events.filter((e) => (e.type === 'seekTo' || (e.type === 'changePitch' && e !== firstUp)) && typeof e.syncStarts === 'number');
    const async = restarts.filter((e) => e.syncStarts !== e.nChannels);
    add('R1-2', 'reinício sem await (fontes agendadas na própria chamada)', async.length === 0,
      `${restarts.length} reinícios; ${async.length} com await${async.length ? ': ' + async.slice(0, 4).map((e) => `${e.type}@${fmt(e.ctx, 2)} (${e.syncStarts}/${e.nChannels})`).join(', ') : ''}`);
  }
  if (seq === 'RESTART' || seq === 'SEEKS' || seq === 'STALL' || (seq === 'LOOP' && !palco)) {
    // O que o código promete, exato: o `when` de cada play cai na grade de blocos de
    // 128 amostras, 2 blocos depois do relógio que o 1º start() do grupo lê (o mesmo
    // lido no fim da preparação). O play que a rede de segurança reagendou (grupo
    // seguinte a um descartado) usa a folga de reserva, também em blocos inteiros.
    const qMs = 128 / cfg.sampleRate * 1000;
    const retryQ = Math.ceil(RETRY_LEAD_S * cfg.sampleRate / 128);
    const retried = new Set(allGroups.filter((g, i) => i > 0 && redone.includes(allGroups[i - 1])));
    const bad = [];
    let n = 0;
    for (const g of allGroups) {
      const first = g[0];
      if (!(first.when > 0)) continue;
      n++;
      const want = retried.has(g) ? retryQ : START_LEAD_QUANTA;
      const leadMs = (first.when - first.ctxAtStart) * 1000;
      const grid = first.when * cfg.sampleRate / 128;
      if (Math.abs(leadMs - want * qMs) > LEAD_EPS_MS || Math.abs(grid - Math.round(grid)) > 1e-6) bad.push(`${fmt(leadMs, 3)} ms (esperado ${want} blocos)`);
    }
    add('R1-2', `folga agendada exata: when na grade, ${START_LEAD_QUANTA} blocos depois do relógio no start() (reagendado: ${retryQ} blocos)`, n > 0 && bad.length === 0,
      `${n} plays, ${retried.size} reagendados; fora: ${bad.length ? bad.slice(0, 4).join(', ') : 'nenhum'}`);
  }

  if (palco) analyzeStage(R, opts, add, (item, name, detail) => checks.push({ item, scenario: label, name, pass: true, info: true, detail }));

  const errs = R.events.filter((e) => /error|rejection/.test(e.type));
  if (errs.length) checks.push({ item: 0, scenario: label, name: 'erros no console da página', pass: true, info: true, detail: errs.slice(0, 5).map((e) => e.msg).join(' | ') });
  const timeouts = R.events.filter((e) => e.type === 'timeout');
  if (timeouts.length) checks.push({ item: 0, scenario: label, name: 'esperas que passaram do tempo no roteiro', pass: true, info: true, detail: timeouts.map((e) => e.label).join(' | ') });
  return checks;
}

// ===================== palco novo (T30) =====================
// Medido no Goertzel do tap (janela de Hann de 10 ms a cada 1 ms, por saída). O início de um
// click ou de um bipe é o cruzamento de 50% do platô, menos meia janela e meio ataque: exato pra
// ataque linear (bipe, 4 ms) ou em cosseno (click de teste, 2 ms) com o platô maior que a janela
// (numa simulação com a receita do bipe, erro abaixo de 0,04 ms). Tempos em tempo do contexto,
// como o tap vê: tudo o que entra no worklet ou no atraso da compensação sai L depois.
const STAGE_TOL_MS = 3;       // pulo, bipes, emenda do loop e 1º click da música
const PRECOUNT_STEP_MS = 2;   // passo entre os bipes da pré-contagem
const DETECTOR_MS = 1;        // clicks da linha do tempo antes do pulo (confere o medidor)
const BAR_MS = 1;             // o pulo no 1 do compasso, pela linha do tempo do play
const GUIDE_DROP_DB = 40;     // guia calada no último compasso
const GUIDE_BACK_DB = 1;      // guia de volta: até 1 dB do nível de antes
const GUIDE_BACK_S = 0.015;   // CANCEL: guia de volta em até 15 ms
const SILENT_DB = -60;        // "não chega" numa saída (seno de amplitude 1 = 0 dB)
const NO_BEEP_DB = -50;       // bipe ausente (os bipes soam perto de -4 dB)
const NO_BEEP_AFTER_S = 0.005;
const BEEP_EVENT_DB = -20;    // pulso com cara de bipe na frequência dele
const SPLIT_MATCH_DB = 0.1;   // nível igual ao da v1.4.15 (R-24)
const HOLE_MAX_MS = 10;       // buraco na VS em volta do pulo
const HOLE_DB = -20;          // buraco = RMS do passo 20 dB abaixo do nível da VS
const BEEP_ATTACK_S = 0.004;  // COUNT_TONE.attack (src/audio/countTones.ts)
const FADE_S = 0.005;         // FADE (src/audio/sectionScheduler.ts)
const BEAT_S = 0.5;           // 120 BPM
const BAR_S = 2;              // 4/4 a 120 BPM
const FLOOR = 0.02;           // piso do detector (-34 dB): os picos ficam entre -8 e -2 dB
const REF_TAG = 'v1415';      // SPLIT: referência gravada com --rev b53a95c --tag v1415
const FG = 330, F_BEEP = 988, F_ACCENT = 1319, FC = 4500, FI = 2200;

const dB = (a) => 20 * Math.log10(a + 1e-12);
const msOf = (s) => s * 1000;
const median = (v) => { if (!v.length) return NaN; const s = v.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const span2 = (v) => (v.length ? `${fmt(Math.min(...v), 2)} a ${fmt(Math.max(...v), 2)}` : 'nenhum');

function stageMeter(R) {
  const g = R.goertzel;
  const nf = g.freqs.length, stride = 2 * nf + 2;
  const fIdx = new Map(g.freqs.map((f, i) => [f, i]));
  const n = g.t.length;
  const W = g.win / R.cfg.sampleRate;
  const amp = (h, side, f) => 10 ** (g.v[h * stride + side * nf + fIdx.get(f)] / 20);
  const rms = (h, side) => 10 ** (g.v[h * stride + 2 * nf + side] / 20);
  // Primeiro passo com o fim da janela em `t` ou depois.
  const at = (t) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (g.t[m] < t) lo = m + 1; else hi = m; } return lo; };
  // Passos com a janela inteira dentro de [a, b].
  const inside = (a, b) => { const out = []; for (let h = at(a + W); h < n && g.t[h] <= b; h++) out.push(h); return out; };
  return { t: g.t, n, W, hopS: g.hop / R.cfg.sampleRate, amp, rms, at, inside };
}

// Inícios dos pulsos na frequência `f` da saída `side` entre `from` e `to` (`from` num silêncio).
function onsetsAt(M, side, f, attack, from, to) {
  const out = [];
  let h = M.at(from);
  while (h < M.n && M.t[h] <= to) {
    if (M.amp(h, side, f) < FLOOR) { h++; continue; }
    let peak = 0;
    for (let k = h; k < Math.min(M.n, h + Math.round(0.03 / M.hopS)); k++) peak = Math.max(peak, M.amp(k, side, f));
    let k = h;
    while (k < M.n - 1 && M.amp(k, side, f) < peak / 2) k++;
    const a = k > 0 ? M.amp(k - 1, side, f) : 0, b = M.amp(k, side, f);
    const tc = k > 0 && b > a ? M.t[k - 1] + ((peak / 2 - a) / (b - a)) * (M.t[k] - M.t[k - 1]) : M.t[k];
    out.push({ t: tc - M.W / 2 - attack / 2, peak: dB(peak) });
    let j = k + Math.round(0.06 / M.hopS);
    while (j < M.n && M.amp(j, side, f) >= FLOOR) j++;
    h = j;
  }
  return out;
}
// Bipes da contagem (988 Hz no tempo comum, 1319 Hz no acento), em ordem.
const beepsAt = (M, side, from, to) => [
  ...onsetsAt(M, side, F_BEEP, BEEP_ATTACK_S, from, to).map((b) => ({ ...b, accent: false })),
  ...onsetsAt(M, side, F_ACCENT, BEEP_ATTACK_S, from, to).map((b) => ({ ...b, accent: true })),
].sort((a, b) => a.t - b.t);
const maxDbIn = (M, side, f, a, b) => { let m = 0; for (const h of M.inside(a, b)) m = Math.max(m, M.amp(h, side, f)); return dB(m); };
const meanDbIn = (M, side, f, a, b) => { const hs = M.inside(a, b); let acc = 0; for (const h of hs) acc += M.amp(h, side, f) ** 2; return 10 * Math.log10(acc / Math.max(1, hs.length) + 1e-24); };

// Fim de uma fonte: o stop() pedido ou o 'ended' (o que vier antes); nunca soou se acabou no início.
const endOf = (r) => Math.min(r.stopWhen ?? Infinity, r.endedAt ?? Infinity);
const sounded = (r) => endOf(r) > r.eff + 1e-4;
// Grupos de start() por (when, offset): o play e cada pulo (as vozes novas).
function startGroups(R) {
  const map = new Map();
  for (const r of R.sources) {
    const k = `${r.when}|${r.offset}`;
    let g = map.get(k);
    if (!g) map.set(k, (g = { when: r.when, offset: r.offset, tStart: r.tStart, n: 0, sounded: false }));
    g.n++;
    g.sounded ||= sounded(r);
  }
  return [...map.values()].sort((a, b) => a.tStart - b.tStart);
}
// Pulos marcados no áudio (transitionView.committed), com o pouso visto no `landed` do motor.
function stageJumps(R) {
  const byT = new Map();
  for (const v of R.views || []) {
    if (v.switchAt === null || !v.committed) continue;
    byT.set(v.switchAt, { T: v.switchAt, from: v.from, to: v.to, kind: v.kind, countTimes: v.countTimes || [], countLabels: v.countLabels || [], L: v.L, pitch: v.pitch, seenT: v.t });
  }
  const landedAt = (R.views || []).filter((v) => v.landed).map((v) => v.landed.at);
  return [...byT.values()].map((j) => ({ ...j, landed: landedAt.some((a) => Math.abs(a - j.T) < 1e-4) })).sort((a, b) => a.T - b.T);
}
// Segmento da linha do tempo que vale em `t`: o último play (fora as vozes de pulo) ou pulo pousado.
function segmentAt(S, t) {
  let seg = null;
  for (const p of S.plays) if (p.when <= t && (!seg || p.when > seg.ctx)) seg = { ctx: p.when, song: p.offset };
  for (const j of S.jumps) if (j.landed && j.T <= t && (!seg || j.T > seg.ctx)) seg = { ctx: j.T, song: S.spans[j.to].start };
  return seg;
}
const ctxIn = (seg, s) => seg.ctx + (s - seg.song);
const songIn = (seg, t) => seg.song + (t - seg.ctx);
// Fontes vivas por canal em volta de `T`: o máximo em [from, to] e quantas em `T + 0,1`.
function voicesAround(R, T, from, to) {
  const byCh = new Map();
  for (const r of R.sources) {
    if (!sounded(r)) continue;
    if (!byCh.has(r.ch)) byCh.set(r.ch, []);
    byCh.get(r.ch).push([r.eff, endOf(r)]);
  }
  let max = 0, maxCh = '';
  const after = [];
  for (const [ch, iv] of byCh) {
    const pts = [from, ...iv.flat().filter((x) => x >= from && x <= to)];
    for (const p of pts) {
      const k = iv.filter(([a, b]) => a <= p + 1e-9 && p < b).length;
      if (k > max) { max = k; maxCh = ch; }
    }
    after.push([ch, iv.filter(([a, b]) => a <= T + 0.1 && T + 0.1 < b).length]);
  }
  return { max, maxCh, after, channels: byCh.size };
}
function longestHoleMs(M, side, ref, a, b) {
  let run = 0, best = 0;
  for (let h = M.at(a); h < M.n && M.t[h] <= b; h++) {
    if (M.rms(h, side) < ref * 10 ** (HOLE_DB / 20)) { run++; best = Math.max(best, run); } else run = 0;
  }
  return best * M.hopS * 1000;
}
// Bipes medidos x esperados ({ at, label }): tempo e acento (1319 Hz no 1, 988 Hz nos outros).
function countMatches(beeps, expected, tol) {
  const devs = expected.map((e, i) => (beeps[i] ? msOf(beeps[i].t - e.at) : NaN));
  const accents = expected.every((e, i) => beeps[i] && beeps[i].accent === (e.label === 1));
  return { pass: beeps.length === expected.length && devs.every((d) => Math.abs(d) <= tol) && accents,
    detail: `${beeps.length} bipes (esperados ${expected.length}); desvios ${devs.map((d) => fmt(d, 2)).join(', ')} ms; ${beeps.map((b) => (b.accent ? '1319' : '988')).join(' ')} Hz` };
}

function analyzeStage(R, opts, add, info) {
  const cfg = R.cfg;
  if (!R.goertzel || !R.goertzel.t.length) { add('palco', 'o medidor do tap (Goertzel) gravou', false, 'sem dados'); return; }
  const M = stageMeter(R);
  if (cfg.SEQ === 'SPLIT') { stageSplit(R, M, opts, add, info); return; }
  if (cfg.LEGACY) return;
  const jumps = stageJumps(R);
  const isJumpGroup = (g) => jumps.some((j) => Math.abs(g.when - (j.T - FADE_S)) < 1e-6 || Math.abs(g.when - j.T) < 1e-6);
  const S = {
    R, M, cfg, add, info, jumps, spans: cfg.spans || [],
    plays: startGroups(R).filter((g) => g.sounded && !isJumpGroup(g)),
    ear: cfg.outputs ? cfg.outputs.click[0] : 0, vs: cfg.outputs ? cfg.outputs.vs[0] : 1,
  };
  info('palco', 'grade e seções', `grade ${cfg.grid ? `${fmt(cfg.grid.bpm, 4)} BPM, 1 em ${fmt(cfg.grid.firstDownbeat, 5)} s, ${cfg.grid.signature} (${cfg.grid.source}/${cfg.grid.meterSource})` : 'nenhuma'}; seções ${S.spans.map((s) => fmt(s.start, 5)).join(' ')}; saídas ${cfg.outputs ? cfg.outputs.mode : '?'} (ouvido ${S.ear + 1}, VS ${S.vs + 1})`);
  if (!cfg.grid || cfg.grid.source !== 'click') add('palco', 'grade lida no click de teste (source click)', false, JSON.stringify(cfg.grid));
  if (cfg.device) info('palco', 'aparelho de saída (contexto de tempo real, depois das saídas ligadas)', `maxChannelCount ${cfg.device.maxChannelCount}, channelCount ${cfg.device.channelCount} (${cfg.device.interpretation}); o motor vê ${cfg.device.engineMax} canais`);
  if (cfg.SEQ === 'JUMP') stageJump(S);
  else if (cfg.SEQ === 'CANCEL') stageCancel(S);
  else if (cfg.SEQ === 'PRECOUNT') stagePrecount(S);
  else if (cfg.SEQ === 'LOOP') stageLoop(S);
}

function stageJump(S) {
  const { R, M, cfg, add, info, ear, vs, spans } = S;
  const tag = `tom ${cfg.PITCH}`;
  const J = S.jumps.filter((j) => j.landed);
  if (J.length !== 1) { add('pulo', `${tag}: um pulo marcado e pousado`, false, `pousados ${J.length}, marcados ${S.jumps.length}`); return; }
  const j = J[0], T = j.T, L = j.L || 0, Th = T + L;
  info('pulo', `${tag}: pulo`, `seção ${j.from} pra ${j.to}; T ${fmt(T, 5)}; latência da entrada ${fmt(msOf(L), 3)} ms; contagem planejada ${j.countTimes.map((x) => fmt(x - T, 4)).join(' ')} s de T`);
  const seg = segmentAt(S, T - 0.5);
  if (!seg) { add('pulo', `${tag}: linha do tempo do play`, false, 'sem play'); return; }
  const bar = spans[j.from].end;
  const barDev = msOf(T - ctxIn(seg, bar));
  add('pulo', `${tag}: o pulo cai no 1 do compasso (fim da seção ${j.from}, barra do click) na linha do tempo do play (até ${BAR_MS} ms)`,
    Math.abs(barDev) <= BAR_MS && Math.abs(msOf(bar - Math.round(bar / BAR_S) * BAR_S)) <= 2, `T menos a linha do tempo: ${fmt(barDev, 3)} ms; fim da seção ${fmt(bar, 5)} s`);
  // Clicks antes do pulo, na linha do tempo do play: confere o medidor no próprio Chrome.
  const clicks = onsetsAt(M, ear, FC, cfg.clickAttack, ctxIn(seg, 4.35) + L, Th + 1.2);
  const beatDev = (c, sg) => { const sb = Math.round(songIn(sg, c.t - L) / BEAT_S) * BEAT_S; return msOf(c.t - L - ctxIn(sg, sb)); };
  const pre = clicks.filter((c) => c.t < Th - 0.1);
  const preDev = pre.map((c) => beatDev(c, seg));
  add('pulo', `${tag}: clicks antes do pulo na linha do tempo (confere o medidor, até ${DETECTOR_MS} ms)`, pre.length >= 6 && preDev.every((d) => Math.abs(d) <= DETECTOR_MS), `${pre.length} clicks; desvio ${span2(preDev)} ms`);
  // 1º click depois do pulo: o da música no alvo (0:00 começa em T com envelope 1).
  const target = spans[j.to].start;
  const sFirst = Math.ceil((target - FADE_S - 1e-6) / BEAT_S) * BEAT_S;
  const want = Th + (sFirst - target);
  const post = clicks.find((c) => c.t >= Th - 0.1);
  add('pulo', `${tag}: 1º click depois do pulo a até ${STAGE_TOL_MS} ms de T${L ? ' + latência do worklet' : ''}`, !!post && Math.abs(msOf(post.t - want)) <= STAGE_TOL_MS,
    post ? `${fmt(msOf(post.t - want), 3)} ms (click de ${fmt(sFirst, 2)} s da música; alvo ${fmt(target, 5)} s)` : 'sem click');
  // Contagem no último compasso, só pela entrada do click.
  const beeps = beepsAt(M, ear, Th - 2.6, Th + 0.3);
  const cm = countMatches(beeps, [0, 1, 2, 3].map((k) => ({ at: Th - 2 + k * BEAT_S, label: k + 1 })), STAGE_TOL_MS);
  add('pulo', `${tag}: 4 bipes em T-2, T-1,5, T-1 e T-0,5 (até ${STAGE_TOL_MS} ms), 1319 Hz no 1`, cm.pass, cm.detail);
  // Guia calada no último compasso.
  const g0 = median(M.inside(Th - 3.4, Th - 2.4).map((h) => M.amp(h, ear, FG)));
  const muted = maxDbIn(M, ear, FG, Th - 2 + 0.02, Th - 0.02) - dB(g0);
  const backHs = M.inside(Th + 0.02, Th + 0.5);
  const back = dB(Math.min(...backHs.map((h) => M.amp(h, ear, FG)))) - dB(g0);
  add('pulo', `${tag}: guia ao menos ${GUIDE_DROP_DB} dB abaixo de T-2+0,02 a T-0,02 e de volta (até ${GUIDE_BACK_DB} dB) depois de T+0,02`, muted <= -GUIDE_DROP_DB && back >= -GUIDE_BACK_DB,
    `calada: ${fmt(muted, 1)} dB; depois: ${fmt(back, 2)} dB (guia a ${fmt(dB(g0), 1)} dB)`);
  stageVoices(S, tag, 'pulo', T);
  stageHole(S, tag, 'pulo', Th);
  // Nível dos clicks comuns (fora o 1) depois do pulo x antes: as vozes do pulo começam fora da
  // grade de amostras (T não é múltiplo de 1/48000) e o Chrome interpola a leitura do buffer
  // (linear), o que tira um pouco dos agudos. Informativo; a previsão é a da interpolação linear.
  const burst = (c) => { let e = 0; for (let h = M.at(c - 0.005); h < M.n && M.t[h] < c + 0.04; h++) e += M.amp(h, ear, FC) ** 2; return 10 * Math.log10(e + 1e-24); };
  const lvBefore = [4.5, 5, 5.5].map((s) => burst(ctxIn(seg, s) + L));
  const lvAfter = [0.5, 1, 1.5].map((s) => burst(Th + (s - target)));
  const mu = (((-T * cfg.sampleRate) % 1) + 1) % 1, w = (2 * Math.PI * FC) / cfg.sampleRate;
  const predicted = 10 * Math.log10((1 - mu) ** 2 + mu ** 2 + 2 * mu * (1 - mu) * Math.cos(w));
  info('pulo', `${tag}: nível do click depois do pulo x antes (vozes fora da grade de amostras)`, `${fmt(median(lvAfter) - median(lvBefore), 3)} dB; fração de amostra da leitura ${fmt(mu, 3)}; interpolação linear prevê ${fmt(predicted, 3)} dB em ${FC} Hz`);
  if (cfg.PITCH) {
    const w = R.events.filter((e) => e.type === 'worklets');
    const a = w.find((e) => e.label === 'no armar'), b = w.find((e) => e.label === 'depois do pulo');
    add('pulo', `${tag}: nenhum worklet novo no pulo`, !!a && !!b && a.n > 0 && a.n === b.n, a && b ? `${a.n} no armar, ${b.n} depois do pulo` : 'sem contagem de worklets');
  }
  // O instrumento com o trem de clicks (última faixa, na VS): antes do pulo com o click, e o 1º depois no 1.
  const rOn = (vs === 1 ? R.onsetsR : R.onsetsL) || [];
  const rPre = rOn.filter((t) => t >= ctxIn(seg, 4.35) + L && t < Th - 0.1);
  const rDev = rPre.map((t) => beatDev({ t }, seg));
  const dR = median(rDev);
  const rPost = rOn.find((t) => t >= Th - 0.1);
  const postDev = rPost === undefined ? NaN : msOf(rPost - want) - dR;
  add('pulo', `${tag}: instrumento${cfg.PITCH ? ' transposto' : ''} junto do click antes do pulo (até ${ALIGN_MS} ms) e o 1º depois no 1 (até ${STAGE_TOL_MS} ms)`,
    rPre.length >= 6 && Math.abs(dR) <= ALIGN_MS && Math.abs(postDev) <= STAGE_TOL_MS, `antes: ${rPre.length} clicks, mediana ${fmt(dR, 2)} ms; depois: ${fmt(postDev, 2)} ms`);
}

function stageVoices(S, tag, item, T) {
  const v = voicesAround(S.R, T, T - 0.5, T + 0.2);
  const bad = v.after.filter(([, n]) => n !== 1);
  S.add(item, `${tag}: no máximo 2 fontes por canal e 1 por canal 100 ms depois de T`, v.max <= 2 && bad.length === 0 && v.channels === S.cfg.channels.length,
    `máximo ${v.max}${v.maxCh ? ' (' + v.maxCh + ')' : ''}; 100 ms depois: ${bad.length ? bad.map(([c, n]) => `${c} ${n}`).join(', ') : `1 em cada um dos ${v.after.length} canais`}`);
}
function stageHole(S, tag, item, Th) {
  const ref = median(S.M.inside(Th - 1, Th - 0.2).map((h) => S.M.rms(h, S.vs)));
  const hole = longestHoleMs(S.M, S.vs, ref, Th - 0.1, Th + 0.1);
  S.add(item, `${tag}: sem buraco de mais de ${HOLE_MAX_MS} ms na VS em volta de T`, Number.isFinite(ref) && hole <= HOLE_MAX_MS, `maior trecho ${-HOLE_DB} dB abaixo da VS: ${fmt(hole, 0)} ms (VS a ${fmt(dB(ref), 1)} dB)`);
}

function stageCancel(S) {
  const { R, M, cfg, add, ear } = S;
  const armEv = R.events.find((e) => e.type === 'armSection');
  const cancelEv = R.events.find((e) => e.type === 'cancelArm');
  const v = (R.views || []).filter((x) => x.switchAt !== null && cancelEv && x.t <= cancelEv.t).pop();
  if (!armEv || !cancelEv || !v) { add('cancelar', 'armou e cancelou com a contagem planejada', false, `armou ${!!armEv}, cancelou ${!!cancelEv}, transição ${!!v}`); return; }
  const T = v.switchAt, c0 = cancelEv.ctx, times = v.countTimes || [];
  const seg = segmentAt(S, c0);
  S.info('cancelar', 'cancelamento', `T planejado ${fmt(T, 5)}; cancelado ${fmt(msOf(c0 - (times[1] ?? NaN)), 1)} ms depois do 2º bipe e ${fmt(msOf((times[2] ?? NaN) - c0), 1)} ms antes do 3º; marcado no áudio antes: ${v.committed}`);
  const before = beepsAt(M, ear, T - 2.6, c0);
  const cm = countMatches(before, [0, 1].map((k) => ({ at: T - 2 + k * BEAT_S, label: k + 1 })), STAGE_TOL_MS);
  add('cancelar', 'antes do cancelamento: os 2 primeiros bipes nos tempos', cm.pass, cm.detail);
  const nb = Math.max(maxDbIn(M, ear, F_BEEP, c0 + NO_BEEP_AFTER_S, T + 0.5), maxDbIn(M, ear, F_ACCENT, c0 + NO_BEEP_AFTER_S, T + 0.5));
  add('cancelar', `nenhum bipe ${msOf(NO_BEEP_AFTER_S)} ms depois do cancelamento (abaixo de ${NO_BEEP_DB} dB até T+0,5)`, nb <= NO_BEEP_DB, `${fmt(nb, 1)} dB`);
  // O click segue a linha do tempo de antes (nenhum pulo, nenhum buraco).
  const clicks = onsetsAt(M, ear, FC, cfg.clickAttack, c0, c0 + 3);
  const expected = [];
  for (let s = Math.ceil(songIn(seg, c0) / BEAT_S) * BEAT_S; ctxIn(seg, s) < c0 + 3 - 0.03; s += BEAT_S) expected.push(s);
  const devs = clicks.map((c) => { const sb = Math.round(songIn(seg, c.t) / BEAT_S) * BEAT_S; return msOf(c.t - ctxIn(seg, sb)); });
  add('cancelar', `o click segue a linha do tempo original (até ${STAGE_TOL_MS} ms, nenhum faltando)`, clicks.length === expected.length && devs.every((d) => Math.abs(d) <= STAGE_TOL_MS),
    `${clicks.length} clicks em 3 s (esperados ${expected.length}, de ${fmt(expected[0], 1)} a ${fmt(expected[expected.length - 1], 1)} s da música); desvio ${span2(devs)} ms`);
  const late = R.sources.filter((r) => r.tStart > armEv.t);
  add('cancelar', 'nenhuma voz do pulo chegou a soar', late.filter(sounded).length === 0, `${late.length} fontes preparadas depois do armar, ${late.filter(sounded).length} soaram`);
  // Guia: calada na contagem e de volta logo depois do cancelamento.
  const g0 = median(M.inside(ctxIn(seg, 4.6), ctxIn(seg, 5.6)).map((h) => M.amp(h, ear, FG)));
  const mutedBefore = maxDbIn(M, ear, FG, T - 2 + 0.02, c0 - 0.005) - dB(g0);
  const backHs = M.inside(c0 + GUIDE_BACK_S, c0 + 0.5);
  const back = dB(Math.min(...backHs.map((h) => M.amp(h, ear, FG)))) - dB(g0);
  add('cancelar', `guia calada na contagem (${GUIDE_DROP_DB} dB) e de volta em até ${msOf(GUIDE_BACK_S)} ms do cancelamento (até ${GUIDE_BACK_DB} dB)`, mutedBefore <= -GUIDE_DROP_DB && back >= -GUIDE_BACK_DB,
    `calada: ${fmt(mutedBefore, 1)} dB; de ${msOf(GUIDE_BACK_S)} ms em diante: ${fmt(back, 2)} dB`);
}

function stagePrecount(S) {
  const { R, M, cfg, add, info, ear, vs } = S;
  const playEv = R.events.find((e) => e.type === 'play' && e.precount);
  const play = S.plays[0];
  if (!playEv || !play) { add('pre-contagem', 'play com pré-contagem', false, `evento ${!!playEv}, play ${!!play}`); return; }
  const beeps = beepsAt(M, ear, playEv.ctx - 0.05, play.when + 0.3);
  const steps = beeps.slice(1).map((b, i) => msOf(b.t - beeps[i].t));
  const accents = beeps.map((b, i) => b.accent === (i === 0)).every(Boolean);
  add('pre-contagem', `4 bipes a 0,5 s um do outro (até ${PRECOUNT_STEP_MS} ms), 1319 Hz no 1`, beeps.length === 4 && steps.every((d) => Math.abs(d - msOf(BEAT_S)) <= PRECOUNT_STEP_MS) && accents,
    `${beeps.length} bipes; passos ${steps.map((d) => fmt(d, 2)).join(', ')} ms; ${beeps.map((b) => (b.accent ? '1319' : '988')).join(' ')} Hz`);
  const precountEv = R.events.find((e) => e.type === 'precountTimes');
  if (precountEv && beeps.length) info('pre-contagem', 'bipes medidos x precountTimes do motor', beeps.map((b, i) => fmt(msOf(b.t - (precountEv.times[i] ?? NaN)), 2)).join(', ') + ' ms');
  const first = beeps.length ? onsetsAt(M, ear, FC, cfg.clickAttack, beeps[0].t + 0.05, beeps[0].t + 3)[0] : undefined;
  const dev = first && beeps.length ? msOf(first.t - (beeps[0].t + 4 * BEAT_S)) : NaN;
  add('pre-contagem', `1º click da música no 5º tempo (até ${STAGE_TOL_MS} ms)`, Math.abs(dev) <= STAGE_TOL_MS,
    `${fmt(dev, 3)} ms do 5º tempo; música agendada em ${fmt(msOf(play.when - (beeps[0]?.t ?? NaN)), 2)} ms do 1º bipe`);
  const vsMax = beeps.length ? Math.max(maxDbIn(M, vs, F_BEEP, beeps[0].t - 0.05, beeps[beeps.length - 1].t + 0.3), maxDbIn(M, vs, F_ACCENT, beeps[0].t - 0.05, beeps[beeps.length - 1].t + 0.3)) : NaN;
  add('pre-contagem', `bipes só no ouvido: na saída da VS (${vs + 1}) abaixo de ${SILENT_DB} dB`, vsMax <= SILENT_DB, `${fmt(vsMax, 1)} dB na VS; pico no ouvido ${beeps.map((b) => fmt(b.peak, 1)).join(' ')} dB`);
}

function stageLoop(S) {
  const { R, M, cfg, add, info, ear, spans } = S;
  const loops = S.jumps.filter((j) => j.landed && j.kind === 'repete' && j.from === j.to);
  if (!loops.length) { add('loop', 'voltas do LOOP pousadas', false, `pulos marcados ${S.jumps.length}`); return; }
  const sec = spans[loops[0].from];
  const restarts = R.events.filter((e) => e.type === 'changePitch').map((e) => e.ctx);
  const first = S.plays[0];
  const clicks = onsetsAt(M, ear, FC, cfg.clickAttack, first.when + 0.1, loops[loops.length - 1].T + 2);
  const near = (t) => { let best = null; for (const c of clicks) if (!best || Math.abs(c.t - t) < Math.abs(best.t - t)) best = c; return best && Math.abs(best.t - t) < 0.02 ? best : null; };
  const lastBeat = Math.floor((sec.end - 1e-6) / BEAT_S) * BEAT_S;
  const firstBeat = Math.ceil((sec.start - FADE_S - 1e-6) / BEAT_S) * BEAT_S;
  const byPitch = new Map();
  for (const j of loops) {
    // Volta logo depois do reinício da troca de tom: a emenda dela não é do LOOP.
    if (restarts.some((c) => j.T > c - 0.5 && j.T < c + 1)) continue;
    const L = j.L || 0, Th = j.T + L;
    const seg = segmentAt(S, j.T - 0.5);
    const a = near(Th - (sec.end - lastBeat)), b = near(Th + (firstBeat - sec.start));
    const row = {
      T: j.T, barDev: seg ? msOf(j.T - ctxIn(seg, sec.end)) : NaN,
      last: a ? msOf(a.t - (Th - (sec.end - lastBeat))) : NaN, first: b ? msOf(b.t - (Th + (firstBeat - sec.start))) : NaN,
    };
    const ref = median(M.inside(Th - 1, Th - 0.2).map((h) => M.rms(h, S.vs)));
    row.hole = longestHoleMs(M, S.vs, ref, Th - 0.1, Th + 0.1);
    const v = voicesAround(R, j.T, j.T - 0.5, j.T + 0.2);
    row.voices = v.max <= 2 && v.after.every(([, n]) => n === 1);
    if (!byPitch.has(j.pitch)) byPitch.set(j.pitch, []);
    byPitch.get(j.pitch).push(row);
  }
  for (const p of [0, 2]) {
    const rows = byPitch.get(p) || [];
    const tag = `tom ${p}`;
    const seam = rows.flatMap((r) => [r.last, r.first]);
    add('loop', `${tag}: emenda do click a até ${STAGE_TOL_MS} ms (último click da seção e 1º da volta), pelo menos 3 voltas`, rows.length >= 3 && seam.every((d) => Math.abs(d) <= STAGE_TOL_MS),
      `${rows.length} voltas; último click ${span2(rows.map((r) => r.last))} ms; 1º da volta ${span2(rows.map((r) => r.first))} ms`);
    add('loop', `${tag}: cada volta no fim da seção pela linha do tempo (até ${BAR_MS} ms)`, rows.length >= 3 && rows.every((r) => Math.abs(r.barDev) <= BAR_MS), `${span2(rows.map((r) => r.barDev))} ms`);
    add('loop', `${tag}: sem buraco de mais de ${HOLE_MAX_MS} ms na VS e no máximo 2 fontes por canal em cada emenda`, rows.length >= 3 && rows.every((r) => r.hole <= HOLE_MAX_MS && r.voices),
      `maior buraco ${span2(rows.map((r) => r.hole))} ms; fontes ${rows.every((r) => r.voices) ? 'ok' : 'fora em ' + rows.filter((r) => !r.voices).length + ' voltas'}`);
  }
  // LOOP da própria seção não conta. Conta pulsos com cara de bipe (pico acima de -20 dB; os bipes
  // soam perto de -4 dB): o reinício da troca de tom começa a guia e o click sem rampa (T26) e
  // isso espalha até uns -36 dB nas frequências dos bipes, sem ser bipe.
  const t0 = loops[0].T - 2.2, t1 = loops[loops.length - 1].T + 0.2;
  const evs = beepsAt(M, ear, t0, t1).filter((b) => b.peak > BEEP_EVENT_DB);
  const nb = Math.max(maxDbIn(M, ear, F_BEEP, t0, t1), maxDbIn(M, ear, F_ACCENT, t0, t1));
  add('loop', 'nenhum bipe nas voltas do LOOP', evs.length === 0, `${evs.length} bipes${evs.length ? ' em ' + evs.map((b) => fmt(b.t, 3)).join(' ') : ''}; maior nível nas frequências dos bipes ${fmt(nb, 1)} dB`);
  info('loop', 'voltas', `${loops.length} pousadas; tom 0: ${(byPitch.get(0) || []).length}, tom 2: ${(byPitch.get(2) || []).length} (fora as do reinício da troca de tom)`);
}

// Níveis médios de 2,75 a 10,75 s da música (16 clicks inteiros) por frequência e saída.
function splitLevels(R, M) {
  const playEv = R.events.find((e) => e.type === 'play');
  const play = startGroups(R).find((g) => playEv && g.tStart >= playEv.t && g.sounded);
  if (!play) return null;
  const a = play.when + (2.75 - play.offset), b = play.when + (10.75 - play.offset);
  const lv = {};
  for (const f of [FG, FC, FI]) for (const side of [0, 1]) lv[`${f}:${side}`] = meanDbIn(M, side, f, a, b);
  return { lv, a, b, play, playEv };
}
const SPLIT_NAMES = { [FG]: 'guia', [FC]: 'click', [FI]: 'VS' };
const lvText = (lv) => [FC, FG, FI].map((f) => `${SPLIT_NAMES[f]} ${fmt(lv[`${f}:0`], 2)}/${fmt(lv[`${f}:1`], 2)}`).join('; ');

function stageSplit(R, M, opts, add, info) {
  const cfg = R.cfg;
  const part = opts.part || cfg.SAIDA;
  const L = splitLevels(R, M);
  if (!L) { add('saidas', `${part}: play gravado`, false, 'sem play'); return; }
  info('saidas', `${part}${cfg.LEGACY ? ' (v1.4.15)' : ''}: nível médio de 2,75 a 10,75 s (saída 1/saída 2, dB)`, lvText(L.lv));
  if (cfg.LEGACY) {
    const sides = cfg.SAIDA === 'stereo' ? [0, 1] : [0];
    add('saidas', `${part} (v1.4.15): gravação com som (click e guia acima de -40 dB)`, sides.every((s) => L.lv[`${FC}:${s}`] > -40 && L.lv[`${FG}:${s}`] > -40), lvText(L.lv));
    return;
  }
  const out = cfg.outputs;
  const ear = out.click[0], vs = out.vs[0];
  if (out.mode === 'split2') {
    const { a, b } = L;
    const vsClick = maxDbIn(M, vs, FC, a, b), vsGuide = maxDbIn(M, vs, FG, a, b), earVs = maxDbIn(M, ear, FI, a, b);
    add('saidas', `${part}: click e guia abaixo de ${SILENT_DB} dB na saída da VS (${vs + 1})`, vsClick <= SILENT_DB && vsGuide <= SILENT_DB, `click ${fmt(vsClick, 1)} dB, guia ${fmt(vsGuide, 1)} dB`);
    add('saidas', `${part}: instrumentos abaixo de ${SILENT_DB} dB na saída do ouvido (${ear + 1})`, earVs <= SILENT_DB, `${fmt(earVs, 1)} dB`);
    add('saidas', `${part}: cada um com som na sua saída (acima de -40 dB)`, L.lv[`${FC}:${ear}`] > -40 && L.lv[`${FG}:${ear}`] > -40 && L.lv[`${FI}:${vs}`] > -40, lvText(L.lv));
    // Janelas da contagem até o instante em que a música entra (ou o pulo cruza): o começo da
    // música sem rampa (T26) espalha um pouco em todas as frequências e não é contagem.
    const preEv = R.events.find((e) => e.type === 'play' && e.precount);
    const prePlay = preEv ? startGroups(R).find((g) => g.tStart >= preEv.t && g.sounded) : null;
    const J = stageJumps(R).find((j) => j.landed);
    const wins = [...(preEv && prePlay ? [[preEv.ctx - 0.05, prePlay.when - 0.001]] : []), ...(J ? [[J.T - 2.6, J.T - 0.001]] : [])];
    const pre = wins.length && preEv && prePlay ? beepsAt(M, ear, wins[0][0], wins[0][1]) : [];
    const jb = J ? beepsAt(M, ear, J.T - 2.6, J.T - 0.001) : [];
    const vsCount = wins.length ? Math.max(...wins.map(([x, y]) => Math.max(maxDbIn(M, vs, F_BEEP, x, y), maxDbIn(M, vs, F_ACCENT, x, y)))) : NaN;
    add('saidas', `${part}: contagem (pré-contagem e pulo) no ouvido e abaixo de ${SILENT_DB} dB na VS`, pre.length === 4 && jb.length === 4 && vsCount <= SILENT_DB,
      `no ouvido: ${pre.length} bipes na pré-contagem, ${jb.length} no pulo; na VS ${fmt(vsCount, 1)} dB`);
  }
  if (opts.tag === REF_TAG) return;
  const refFile = path.join(HERE, 'results', `SPLIT-${part}_${REF_TAG}.json`);
  const name = `${part}: nível de cada saída igual ao da v1.4.15 ${out.mode === 'stereo' ? 'sem' : 'com'} o pan automático (até ${SPLIT_MATCH_DB} dB, R-24)`;
  if (!fs.existsSync(refFile)) { add('saidas', name, false, `falta a referência: node scripts/verify-pitch/run.mjs SPLIT --rev b53a95c --tag ${REF_TAG}`); return; }
  const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'));
  const RL = !ref.fatal && ref.goertzel && ref.cfg.LEGACY ? splitLevels(ref, stageMeter(ref)) : null;
  if (!RL) { add('saidas', name, false, `referência sem dados ou não é da v1.4.15 (${refFile})`); return; }
  // Lado trocado: a saída 2 de agora é a saída 1 da v1.4.15.
  const mirror = cfg.SAIDA === 'split2t';
  const diffs = [];
  for (const f of [FC, FG, FI]) for (const side of [0, 1]) {
    const r = RL.lv[`${f}:${mirror ? 1 - side : side}`];
    if (r > SILENT_DB) diffs.push([`${SPLIT_NAMES[f]} saída ${side + 1}`, L.lv[`${f}:${side}`] - r]);
  }
  add('saidas', name, diffs.length >= 3 && diffs.every(([, d]) => Math.abs(d) <= SPLIT_MATCH_DB), diffs.map(([n, d]) => `${n} ${d >= 0 ? '+' : ''}${fmt(d, 3)}`).join('; ') + ' dB');
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
  // Nome do arquivo: CENARIO[-parte][_tag].json (o LOOP_ANTIGO tem o _ no nome).
  const base = path.basename(file).replace('.json', '');
  const key = process.argv[3] || (base.startsWith('LOOP_ANTIGO') ? 'LOOP_ANTIGO' : base.split(/[-_]/)[0]);
  const [, part, tag] = base.slice(key.length).match(/^(?:-([^_]+))?(?:_(.+))?$/) || [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.fatal) { console.log('FATAL', data.fatal); process.exit(1); }
  process.exit(printReport([{ key, checks: analyze(key, data, { part, tag }) }]) ? 0 : 1);
}
