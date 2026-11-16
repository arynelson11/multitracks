import { COMPANY, CONTACT, LEGAL_LINKS, WHATSAPP_URL } from '../content/site'

// Bloco legal do rodapé das páginas públicas (landing e /download): o contato, quem presta
// o serviço e, quando LEGAL_PAGES_LIVE estiver ligado (src/content/site.ts), os links de
// Privacidade, Termos e Cancelamento.
export function SiteLegalInfo({ className = '' }: { className?: string }) {
  const link = 'inline-flex items-center min-h-6 py-1 text-warm-200 hover:text-bone underline-offset-4 hover:underline transition-colors'
  return (
    <div className={`flex flex-col items-center gap-2 text-center text-[12px] ${className}`}>
      <nav aria-label="Informações legais e contato" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {LEGAL_LINKS.map(l => (
          <a key={l.href} href={l.href} className={link}>{l.label}</a>
        ))}
        <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={link}>
          WhatsApp {CONTACT.whatsappDisplay}
        </a>
        <a href={`mailto:${CONTACT.email}`} className={link}>{CONTACT.email}</a>
      </nav>
      <p className="text-ps-mut text-[11px]">
        {COMPANY.name} · CNPJ {COMPANY.cnpj} · {COMPANY.city}/{COMPANY.state}
      </p>
    </div>
  )
}
