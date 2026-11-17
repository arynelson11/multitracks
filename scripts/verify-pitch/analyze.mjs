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
    else checks.push({ item: 'R1-2', scenario: key, name: 'plays refeitos (relógio passou do instante comum durante o laço)', pass: true, info: true, detail: `${redone.length}` });
  }
  if (jumps.length && !['SEEKS', 'RESTART', 'LOOP', 'STALL'].includes(seq)) add(1, `posição contínua ao reiniciar (|salto| <= ${JUMP_S} s)`, jumps.every((j) => Math.abs(j) <= JUMP_S), `saltos s: ${jumps.map((j) => fmt(j, 3)).join(', ')}`);

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
      if (ctl !== null) checks.push({ item: 'R1-1', scenario: key, name: `[${other.label}] controle (erro do vocoder em 440 Hz)`, pass: true, info: true, detail: `dif ${fmt(ctl)} dB` });
      for (const name of ['Mono R', 'Mono C', 'Estereo R', 'Estereo C']) {
        const a = base.levels[name], b = other.levels[name];
        const d = b.total - a.total;
        const detail = `tom 0 ${fmt(a.total)} dB (L ${fmt(a.L)} R ${fmt(a.R)}), agora ${fmt(b.total)} dB (L ${fmt(b.L)} R ${fmt(b.R)}), dif ${fmt(d)} dB`;
        // Estéreo: o critério é não mudar com a correção (compara-se entre execuções);
        // a diferença que sobra é do próprio phase vocoder naquele tom.
        if (name.startsWith('Estereo')) checks.push({ item: 'R1-1', scenario: key, name: `[${other.label}] ${name}: nível transposto x tom 0`, pass: true, info: true, detail });
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
  if (seq !== 'NAN' && seq !== 'LEVELS' && seq !== 'PENDENTE') {
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
      if (pk.length) checks.push({ item: 0, scenario: key, name: `nível no trecho tom ${s.pitch} desde ${fmt(s.from, 1)} s`, pass: true, info: true,
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
  if (seq === 'LOOP') {
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
  if (seq === 'RESTART' || seq === 'SEEKS' || seq === 'STALL' || seq === 'LOOP') {
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
