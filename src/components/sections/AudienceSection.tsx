import { AUDIENCE } from './data'

export function AudienceSection() {
  return (
    <section className="py-24 px-5 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">feito pra</p>
        <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
          Quem toca todo fim de semana.
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AUDIENCE.map((a, i) => (
            <div key={i} className="group bg-tinta-raised border border-tinta-border hover:border-musgo/50 rounded-2xl p-6 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-musgo/15 group-hover:bg-musgo/25 flex items-center justify-center mb-4 transition-colors">
                <a.icon size={20} className="text-musgo-light" />
              </div>
              <h4 className="font-display font-semibold text-[16px] text-bone mb-2">{a.title}</h4>
              <p className="text-[13px] text-warm-200 leading-relaxed">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
