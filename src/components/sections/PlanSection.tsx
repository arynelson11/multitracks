import { ArrowRight } from 'lucide-react'

interface Props {
  onEnter: () => void
}

export function PlanSection({ onEnter }: Props) {
  return (
    <section className="py-24 px-5 sm:px-8 bg-tinta-soft">
      <div className="max-w-4xl mx-auto">
        <p className="text-warm-400 text-[12px] font-bold uppercase tracking-[0.25em] mb-4 text-center">o domingo em 3 passos</p>
        <h2 className="font-display font-semibold text-[clamp(1.8rem,4.5vw,2.8rem)] leading-tight text-bone mb-16 text-center">
          Como você chega pronto.
        </h2>

        <div className="space-y-5">
          {[
            { n: '1', title: 'Sobe a música', desc: 'Qualquer formato: MP3, WAV, ou link do YouTube.' },
            { n: '2', title: 'O Playback Studio separa tudo', desc: 'Voz, guitarra, baixo, bateria, piano, pads. Em alguns minutos.' },
            { n: '3', title: 'Sua banda chega pronta no domingo', desc: 'Multitracks, click, voice guide, seções marcadas (intro, verso, refrão, ponte). Tudo na mão.' },
          ].map(step => (
            <div key={step.n} className="bg-tinta-raised border border-tinta-border rounded-2xl p-6 sm:p-8 flex items-start gap-6">
              <div className="w-14 h-14 rounded-full bg-laranja text-bone flex items-center justify-center font-display font-semibold text-[24px] shrink-0">
                {step.n}
              </div>
              <div className="flex-1 pt-1">
                <h3 className="font-display font-semibold text-[22px] text-bone mb-2 leading-tight">{step.title}</h3>
                <p className="text-[15px] text-warm-200 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <button
            onClick={onEnter}
            className="inline-flex items-center justify-center gap-2.5 bg-laranja hover:bg-laranja-dark text-bone px-8 py-4 rounded-xl font-semibold text-[15px] transition-all hover:scale-[1.02] cursor-pointer shadow-lg shadow-laranja/25"
          >
            Sobe sua primeira música <ArrowRight size={17} />
          </button>
        </div>
      </div>
    </section>
  )
}
