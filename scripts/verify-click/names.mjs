// Medição 4: qual faixa o botão AUTO escolhe, com nomes reais de pacotes.
// Transcrição fiel de src/components/MetronomeModal.tsx:152-166 (v1.4.14).
function pickTrack(channels) {
  let t = channels.find(c => c.name.toLowerCase().includes('drum') || c.name.toLowerCase().includes('bateria'));
  if (!t) t = channels.find(c => c.name.toLowerCase().includes('bass') || c.name.toLowerCase().includes('baixo'));
  if (!t) t = channels.find(c => { const n = c.name.toLowerCase(); return !n.includes('click') && !n.includes('metronomo') && !n.includes('guia') && !n.includes('guide'); });
  if (!t) t = channels[0];
  return t;
}
const packs = {
  'BR completo': ['Click', 'Guia', 'Bateria', 'Baixo', 'Guitarra 1', 'Teclado', 'Pad', 'Vocal'],
  'EN completo': ['CLICK', 'GUIDE', 'DRUMS', 'BASS', 'EG1', 'KEYS', 'PAD', 'VOX'],
  'kit separado EN': ['Click', 'Cues', 'KICK', 'SNARE', 'HIHAT', 'OH', 'TOMS', 'PERC', 'LOOP', 'BASS', 'KEYS'],
  'kit separado BR': ['Click', 'Guia', 'BUMBO', 'CAIXA', 'CHIMBAL', 'OVER', 'LOOP', 'PERCUSSÃO', 'BAIXO', 'VIOLÃO'],
  'kit separado BR sem baixo, violão antes': ['Click', 'Guia', 'VIOLÃO', 'LOOP', 'BUMBO', 'CAIXA'],
  'Drum Loop antes de Drums': ['Click', 'Drum Loop', 'Drums', 'Bass'],
  'só fills de bateria antes': ['Click', 'Drum Fills', 'Drums', 'Bass'],
  'só loop/perc': ['Click', 'Guia', 'Loop', 'Perc', 'Pad', 'Vocal'],
  'só loop/perc, pad primeiro': ['Click', 'Guia', 'Pad', 'Loop', 'Perc'],
  'espanhol': ['Click', 'Guía', 'Batería', 'Bajo', 'Teclado'],
  'espanhol, guia acentuada primeiro': ['Guía', 'Teclado', 'Batería'],
  'metrônomo com acento primeiro': ['Metrônomo', 'Pad', 'Vocal'],
  'Batera / Bat': ['Click', 'Batera', 'Bx', 'Gtr'],
  'Synth Bass': ['Click', 'Kick', 'Snare', 'Synth Bass', 'Pad'],
  'Contrabaixo': ['Click', 'Contrabaixo', 'Piano'],
  'Bass Drum': ['Click', 'Bass Drum', 'Snare'],
  'Playback (mix)': ['Click', 'Guia', 'Playback'],
  'Separador (nomes do app)': ['Metrônomo', 'Vocais', 'Bateria', 'Baixo', 'Outros'],
};
for (const [k, names] of Object.entries(packs)) {
  const t = pickTrack(names.map(name => ({ name })));
  console.log(`${k.padEnd(42)} -> ${t.name}`);
}
