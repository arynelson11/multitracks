import { Star } from 'lucide-react'
import { TESTIMONIALS } from './data'

export function TestimonialsSection() {
  return (
    <section className="py-24 px-5 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">bandas que já chegam prontas</p>
        <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
          Histórias de domingo.
        </h2>
        <div className="grid sm:grid-cols-3 gap-5">
          {TESTIMONIALS.map((r, i) => (
            <div key={i} className="bg-tinta-raised border border-tinta-border rounded-2xl p-7">
              <div className="flex gap-0.5 mb-4">
                {[1, 2, 3, 4, 5].map(j => <Star key={j} size={12} className="text-laranja fill-laranja" />)}
              </div>
              <p className="text-[14px] text-warm-200 leading-relaxed mb-5">"{r.text}"</p>
              <div>
                <div className="font-display font-semibold text-[15px] text-bone">{r.name}</div>
                <div className="text-[12px] text-warm-400">{r.role}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
