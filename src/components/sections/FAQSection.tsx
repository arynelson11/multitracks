import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { FAQS } from './data'

interface Props {
  hideHeading?: boolean
}

export function FAQSection({ hideHeading = false }: Props) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <section id="faq" className="py-24 px-5 sm:px-8">
      <div className="max-w-2xl mx-auto">
        {!hideHeading && (
          <h2 className="font-display font-semibold text-[clamp(1.6rem,4vw,2.4rem)] text-bone text-center mb-12">
            Perguntas frequentes
          </h2>
        )}
        <div className="space-y-2.5">
          {FAQS.map((faq, i) => (
            <div key={i} className="border border-tinta-border rounded-xl overflow-hidden bg-tinta-raised">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between px-5 py-4 text-left cursor-pointer hover:bg-tinta-border/40 transition-colors"
              >
                <span className="font-semibold text-[14px] text-bone pr-4">{faq.q}</span>
                <ChevronDown size={15} className={`text-warm-400 shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === i && (
                <div className="px-5 pb-5 pt-4 text-[13px] text-warm-200 leading-relaxed border-t border-tinta-border">
                  {faq.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
