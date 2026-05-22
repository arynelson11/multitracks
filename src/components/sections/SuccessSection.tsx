export function SuccessSection() {
  return (
    <section className="py-24 px-5 sm:px-8 bg-tinta-soft">
      <div className="max-w-3xl mx-auto">
        <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">seu próximo domingo, diferente</p>
        <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-12 text-center">
          Sexta separa. Sábado ensaia.
          <br />
          <span className="italic text-musgo-light">Domingo flui.</span>
        </h2>
        <div className="bg-tinta-raised border border-tinta-border rounded-2xl p-7 sm:p-9 space-y-4 text-[15px] leading-relaxed">
          {[
            { day: 'Sexta', text: 'Ministro de louvor manda o setlist. Você sobe no Playback Studio.' },
            { day: 'Sábado', text: 'Tudo separado. Equipe baixou. Ensaio fluiu.' },
            { day: 'Domingo', text: 'Banda travada mas leve. Ministração fluindo.' },
            { day: 'Segunda', text: '"Vamo pra próxima."' },
          ].map((row, i) => (
            <div key={i} className="flex items-baseline gap-5 pb-4 last:pb-0 border-b border-tinta-border last:border-0">
              <span className="font-display font-semibold text-bone text-[18px] w-24 shrink-0">{row.day}</span>
              <span className="text-warm-200">{row.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
