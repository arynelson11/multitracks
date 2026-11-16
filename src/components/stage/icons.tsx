import type { ReactNode } from 'react'
import { cx } from '../ui/cx'
import type { IconName } from './iconNames'

// Desenhos dos ícones do palco, em SVG inline (nunca caractere que vira emoji no Mac).
// De 'mark' a 'rev': cópia literal dos <symbol> do mockup v5 (palco-desktop-v5.html).
// De 'trash' a 'check': mesmos desenhos do lucide-react (Trash2, GripVertical, Plus, Minus,
// Check; licença ISC), na caixa de 24 e no traço do v5. Traço, cor e ponta vêm do <svg>.
const DRAWINGS: Record<IconName, { viewBox: string; body: ReactNode }> = {
  mark: { viewBox: '10 10 44 44', body: <g fill="currentColor" stroke="none"><path d="M14 12L29.2 20H14z" /><path d="M14 24H36.8L48.2 30H14z" /><path d="M14 34H48.2L36.8 40H14z" /><path d="M14 44H29.2L14 52z" /></g> },
  pause: { viewBox: '0 0 24 24', body: <g fill="currentColor" stroke="none"><rect x="6" y="5" width="4.2" height="14" rx="1.2" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" /></g> },
  start: { viewBox: '0 0 24 24', body: <><path d="M5 5v14" /><path d="M19 12H9.5" /><path d="M13.5 7.5 9 12l4.5 4.5" /></> },
  prev: { viewBox: '0 0 24 24', body: <><path d="M5.5 5.5v13" /><path d="M18.5 5.5 9.5 12l9 6.5z" fill="currentColor" /></> },
  next: { viewBox: '0 0 24 24', body: <><path d="M18.5 5.5v13" /><path d="M5.5 5.5l9 6.5-9 6.5z" fill="currentColor" /></> },
  loop: { viewBox: '0 0 24 24', body: <><path d="M17 2.5l3 3-3 3" /><path d="M4 11v-1a4.5 4.5 0 0 1 4.5-4.5H20" /><path d="M7 21.5l-3-3 3-3" /><path d="M20 13v1a4.5 4.5 0 0 1-4.5 4.5H4" /></> },
  metro: { viewBox: '0 0 24 24', body: <><path d="M9 3.5h6L19 20.5H5z" /><path d="M12 15.5l5.5-9" /><path d="M6.5 16h11" /></> },
  sliders: { viewBox: '0 0 24 24', body: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></> },
  count: { viewBox: '0 0 24 24', body: <g fill="currentColor" stroke="none"><circle cx="4" cy="12" r="1.9" /><circle cx="9.3" cy="12" r="1.9" /><circle cx="14.6" cy="12" r="1.9" /><circle cx="20" cy="12" r="2.7" /></g> },
  chl: { viewBox: '0 0 24 24', body: <path d="M15 5l-7 7 7 7" /> },
  chr: { viewBox: '0 0 24 24', body: <path d="M9 5l7 7-7 7" /> },
  chd: { viewBox: '0 0 24 24', body: <path d="M6 9l6 6 6-6" /> },
  x: { viewBox: '0 0 24 24', body: <path d="M6 6l12 12M18 6 6 18" /> },
  inf: { viewBox: '0 0 24 24', body: <path d="M12 12c-2-2.6-3.7-4-5.6-4a4 4 0 0 0 0 8c1.9 0 3.6-1.4 5.6-4zm0 0c2 2.6 3.7 4 5.6 4a4 4 0 0 0 0-8c-1.9 0-3.6 1.4-5.6 4z" /> },
  pad: { viewBox: '0 0 24 24', body: <path d="M2 12c2.2-4.6 4.4-4.6 6.6 0s4.4 4.6 6.6 0 4.4-4.6 6.6 0" /> },
  lyrics: { viewBox: '0 0 24 24', body: <path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7" /> },
  edit: { viewBox: '0 0 24 24', body: <><path d="M4 20h4L19.3 8.7a2.1 2.1 0 0 0-3-3L5 17z" /><path d="M14.5 7.5l2.9 2.9" /></> },
  cloud: { viewBox: '0 0 24 24', body: <path d="M7 18.5h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.4 9.2 4.7 4.7 0 0 0 7 18.5z" /> },
  home: { viewBox: '0 0 24 24', body: <path d="M4 11 12 4l8 7v9h-5.5v-5.5h-5V20H4z" /> },
  out: { viewBox: '0 0 24 24', body: <><path d="M9.5 4H5v16h4.5" /><path d="M14 8l4 4-4 4" /><path d="M18 12H9" /></> },
  rev: { viewBox: '0 0 24 24', body: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4v4.5H9" /></> },
  trash: { viewBox: '0 0 24 24', body: <><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6" /><path d="M14 11v6" /></> },
  grip: { viewBox: '0 0 24 24', body: <><circle cx="9" cy="5" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="19" r="1" /></> },
  plus: { viewBox: '0 0 24 24', body: <><path d="M5 12h14" /><path d="M12 5v14" /></> },
  minus: { viewBox: '0 0 24 24', body: <path d="M5 12h14" /> },
  check: { viewBox: '0 0 24 24', body: <path d="M20 6 9 17l-5-5" /> },
}

/** Ícone do palco: decoração (escondido do leitor de tela); o nome acessível fica no botão. 20px como no v5; a classe muda tamanho e cor. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  const { viewBox, body } = DRAWINGS[name]
  return (
    <svg
      viewBox={viewBox} width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      className={cx('shrink-0', className)}
    >
      {body}
    </svg>
  )
}
