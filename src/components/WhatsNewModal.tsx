import { CHANGELOG } from '../lib/changelog';
import { Button, Tag } from './ui';
import { StageDialog } from './stage/StageDialog';

interface WhatsNewModalProps {
  onClose: () => void;
}

// Popup mostrado na abertura do app quando há uma versão nova que o usuário
// ainda não viu. Exibe a entrada mais recente do changelog, na janela do palco.
export function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const latest = CHANGELOG[0];
  if (!latest) return null;

  return (
    <StageDialog
      open
      title={latest.title}
      onClose={onClose}
      footer={<Button tone="primary" onClick={onClose}>Entendi</Button>}
    >
      <div className="flex flex-col gap-3">
        <p><Tag>Novidades · v{latest.version}</Tag></p>
        <ul className="flex flex-col gap-2.5">
          {latest.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 leading-relaxed text-ps-bone">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-ps-mut" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </StageDialog>
  );
}
