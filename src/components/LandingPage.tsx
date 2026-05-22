import { MarketingNav } from './sections/MarketingNav'
import { HeroSection } from './sections/HeroSection'
import { StakesSection } from './sections/StakesSection'
import { GuideSection } from './sections/GuideSection'
import { PlanSection } from './sections/PlanSection'
import { AudienceSection } from './sections/AudienceSection'
import { SuccessSection } from './sections/SuccessSection'
import { TestimonialsSection } from './sections/TestimonialsSection'
import { PricingSection } from './sections/PricingSection'
import { FAQSection } from './sections/FAQSection'
import { CTASection } from './sections/CTASection'
import { MarketingFooter } from './sections/MarketingFooter'

interface LandingPageProps {
  onEnter: () => void
}

export function LandingPage({ onEnter }: LandingPageProps) {
  const goToCheckout = (planId: string, price: number, billing: 'monthly' | 'annual') => {
    if (price > 0) {
      localStorage.setItem('checkoutIntent', `${planId}_${billing === 'annual' ? 'anual' : 'mensal'}`)
    } else {
      localStorage.removeItem('checkoutIntent')
    }
    onEnter()
  }

  return (
    <div className="brand-context-dark min-h-screen overflow-x-hidden">
      <MarketingNav onEnter={onEnter} />
      <HeroSection onEnter={onEnter} />
      <StakesSection />
      <GuideSection />
      <PlanSection onEnter={onEnter} />
      <AudienceSection />
      <SuccessSection />
      <TestimonialsSection />
      <PricingSection onCheckout={goToCheckout} />
      <FAQSection />
      <CTASection onEnter={onEnter} />
      <MarketingFooter onEnter={onEnter} />
    </div>
  )
}
