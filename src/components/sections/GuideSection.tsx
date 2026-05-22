export function GuideSection() {
  return (
    <section id="como-funciona" className="py-24 px-5 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o que o Playback Studio entrega</p>
        <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
          Construída por quem toca.
          <br />
          Pra quem toca.
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { title: 'Qualquer música, separada', desc: 'Sobe MP3, WAV ou link. O Playback Studio separa em voz, bateria, baixo, guitarras e mais.' },
            { title: 'Biblioteca de Separações Local', desc: 'Suas separações ficam salvas no seu navegador. Feche e abra depois sem gastar tokens novamente.' },
            { title: 'Sem catálogo travando', desc: 'Você escolhe a música. O Playback Studio prepara. Sem esperar release, sem licença gringa.' },
          ].map((item, i) => (
            <div key={i} className="bg-tinta-raised border border-tinta-border rounded-2xl p-7 hover:border-laranja/40 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-laranja/15 border border-laranja/25 flex items-center justify-center mb-5">
                <span className="text-laranja font-display font-semibold text-[15px]">{i + 1}</span>
              </div>
              <h3 className="font-display font-semibold text-[20px] text-bone mb-3 leading-tight">{item.title}</h3>
              <p className="text-[14px] text-warm-200 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
