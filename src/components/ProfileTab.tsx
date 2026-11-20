import { useState, useRef } from 'react';
import { Camera, Loader2, Check, LogOut, Crown, Calendar, Mail, Trash2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { uploadToR2 } from '../lib/r2';
import { planDisplayName, isPaidPlan } from '../lib/plans';
import { deleteAccountNotice, fetchCancelPreview } from '../lib/subscription';
import { Button, Panel, TextField } from './ui';

interface ProfileTabProps {
  user: User;
  userPlan: string;
  updateProfile: (data: { displayName?: string; avatarUrl?: string }) => Promise<unknown>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  onUpgrade: () => void;
  onClose: () => void;
}

function formatMemberSince(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  } catch {
    return '—';
  }
}

export function ProfileTab({ user, userPlan, updateProfile, updatePassword, signOutEverywhere, deleteAccount, onUpgrade, onClose }: ProfileTabProps) {
  const meta = (user.user_metadata || {}) as { display_name?: string; avatar_url?: string };
  const [name, setName] = useState(meta.display_name || '');
  const [avatar, setAvatar] = useState(meta.avatar_url || '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  const initial = (name || user.email || '?').trim().charAt(0).toUpperCase();

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const res = await uploadToR2('avatars', `${user.id}_${Date.now()}.${ext}`, file);
      if (res.error || !res.url) throw new Error(res.error || 'Falha no upload');
      await updateProfile({ avatarUrl: res.url });
      setAvatar(res.url);
    } catch (err) {
      alert('Não foi possível enviar a foto. Tente novamente.');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSaveName = async () => {
    setSavingName(true);
    setNameMsg(null);
    try {
      await updateProfile({ displayName: name.trim() });
      setNameMsg('Nome salvo!');
    } catch {
      setNameMsg('Erro ao salvar o nome.');
    } finally {
      setSavingName(false);
    }
  };

  const handleSavePassword = async () => {
    if (pw1.length < 6) { setPwMsg('A senha precisa de ao menos 6 caracteres.'); return; }
    if (pw1 !== pw2) { setPwMsg('As senhas não conferem.'); return; }
    setSavingPw(true);
    setPwMsg(null);
    try {
      await updatePassword(pw1);
      setPw1(''); setPw2('');
      setPwMsg('Senha atualizada!');
    } catch {
      setPwMsg('Erro ao atualizar a senha.');
    } finally {
      setSavingPw(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!confirm('Sair de todos os dispositivos? Você precisará entrar de novo em todos.')) return;
    await signOutEverywhere();
    onClose();
  };

  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    // Assinante: diz o que acontece com o dinheiro (data e valor quando dá pra saber).
    const subscriptionNote = isPaidPlan(userPlan)
      ? `\n\n${deleteAccountNotice(await fetchCancelPreview(), userPlan)}`
      : '';
    const typed = prompt(`Isto apaga sua conta permanentemente e não pode ser desfeito.${subscriptionNote}\n\nDigite EXCLUIR para confirmar:`);
    if (typed !== 'EXCLUIR') return;
    setDeleting(true);
    try {
      await deleteAccount();
      onClose();
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : 'Não foi possível excluir a conta. Tente novamente.');
      setDeleting(false);
    }
  };

  const spinner = (size: number) => <Loader2 size={size} className="animate-spin motion-reduce:animate-none" />;

  return (
    <div className="flex flex-col gap-7 max-w-lg mx-auto">
      {/* Foto + nome: o avatar do palco (degradê laranja e musgo) em 80 px */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Trocar foto"
          title="Trocar foto"
          className="group relative grid size-20 min-h-ps-touch min-w-ps-touch shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-linear-135 from-ps-or to-ps-moss text-ps-bone shadow-[0_0_0_2px_var(--color-ps-ink-0),0_0_0_3px_var(--color-ps-line-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
        >
          {avatar ? (
            <img src={avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-[28px] font-extrabold leading-none">{initial}</span>
          )}
          {/* Enviando, a camada fica à vista com o ícone girando; senão aparece no hover e no foco. */}
          <div aria-hidden="true" className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity ${uploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>
            {uploading ? <Loader2 className="size-5 text-ps-bone animate-spin motion-reduce:animate-none" /> : <Camera className="size-5 text-ps-bone" />}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
        </button>
        <div className="min-w-0">
          <p className="text-ps-md font-bold text-ps-bone break-words">{name || user.email?.split('@')[0]}</p>
          <p className="flex items-center gap-1.5 text-ps-base text-ps-mut break-all"><Mail size={12} aria-hidden="true" className="shrink-0" /> {user.email}</p>
        </div>
      </div>

      {/* Nome de exibição */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Nome de exibição"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameMsg(null); }}
            placeholder="Como você quer ser chamado"
            className="flex-1 basis-56"
          />
          <Button tone="primary" onClick={handleSaveName} disabled={savingName} icon={savingName ? spinner(14) : <Check size={14} />}>
            Salvar
          </Button>
        </div>
        {nameMsg && <p role="status" className="text-ps-base text-ps-mut">{nameMsg}</p>}
      </section>

      {/* Senha */}
      <section className="flex flex-col gap-2">
        <h3 className="text-ps-base font-bold text-ps-bone">Senha</h3>
        <TextField label="Nova senha" type="password" value={pw1} onChange={(e) => { setPw1(e.target.value); setPwMsg(null); }} placeholder="Nova senha" />
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Confirmar nova senha"
            type="password"
            value={pw2}
            onChange={(e) => { setPw2(e.target.value); setPwMsg(null); }}
            placeholder="Confirmar nova senha"
            className="flex-1 basis-56"
          />
          <Button onClick={handleSavePassword} disabled={savingPw || !pw1} icon={savingPw ? spinner(14) : <Check size={14} />}>
            Atualizar
          </Button>
        </div>
        {pwMsg && <p role="status" className="text-ps-base text-ps-mut">{pwMsg}</p>}
      </section>

      {/* Plano */}
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-ps-md bg-ps-s2 text-ps-mut inset-ring inset-ring-ps-line">
            <Crown size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-ps-base font-bold text-ps-bone">Plano {planDisplayName(userPlan)}</p>
            <p className="flex items-center gap-1.5 text-ps-sm text-ps-mut"><Calendar size={11} aria-hidden="true" className="shrink-0" /> Membro desde {formatMemberSince(user.created_at)}</p>
          </div>
        </div>
        {!isPaidPlan(userPlan) && (
          <Button tone="primary" onClick={onUpgrade}>
            Fazer upgrade
          </Button>
        )}
      </Panel>

      {/* Segurança */}
      <div className="flex flex-col gap-2 border-t border-ps-line pt-4">
        <Button onClick={handleSignOutAll} icon={<LogOut size={14} />}>
          Sair de todos os dispositivos
        </Button>
        {/* Excluir: o fluxo de hoje (prompt EXCLUIR), decisão do dono; só a cara é nova (âmbar de alerta). */}
        <Button tone="alert" onClick={handleDelete} disabled={deleting} icon={deleting ? spinner(14) : <Trash2 size={14} />}>
          Excluir minha conta
        </Button>
      </div>
    </div>
  );
}
