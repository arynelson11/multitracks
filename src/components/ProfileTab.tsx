import { useState, useRef } from 'react';
import { Camera, Loader2, Check, LogOut, Crown, Calendar, Mail, User as UserIcon, KeyRound, Trash2 } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { uploadToR2 } from '../lib/r2';
import { planDisplayName, isPaidPlan } from '../lib/plans';

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
    const typed = prompt('Isto apaga sua conta permanentemente e não pode ser desfeito.\n\nDigite EXCLUIR para confirmar:');
    if (typed !== 'EXCLUIR') return;
    setDeleting(true);
    try {
      await deleteAccount();
      onClose();
    } catch {
      alert('Não foi possível excluir a conta. Tente novamente.');
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-7 max-w-lg mx-auto">
      {/* Avatar + nome */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="relative w-20 h-20 rounded-full overflow-hidden bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 cursor-pointer group"
          title="Trocar foto"
        >
          {avatar ? (
            <img src={avatar} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-primary font-black text-2xl">{initial}</span>
          )}
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatar} />
        </button>
        <div className="min-w-0">
          <p className="text-white font-bold text-lg truncate">{name || user.email?.split('@')[0]}</p>
          <p className="text-text-muted text-xs flex items-center gap-1.5"><Mail size={11} /> {user.email}</p>
        </div>
      </div>

      {/* Nome de exibição */}
      <div>
        <label className="text-[11px] uppercase tracking-widest font-semibold text-text-muted flex items-center gap-1.5 mb-2"><UserIcon size={12} /> Nome de exibição</label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNameMsg(null); }}
            placeholder="Como você quer ser chamado"
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary/50 outline-none"
          />
          <button
            onClick={handleSaveName}
            disabled={savingName}
            className="shrink-0 px-4 py-2 rounded-lg bg-primary text-black text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {savingName ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Salvar
          </button>
        </div>
        {nameMsg && <p className="text-[11px] text-text-muted mt-1.5">{nameMsg}</p>}
      </div>

      {/* Senha */}
      <div>
        <label className="text-[11px] uppercase tracking-widest font-semibold text-text-muted flex items-center gap-1.5 mb-2"><KeyRound size={12} /> Senha</label>
        <div className="flex flex-col gap-2">
          <input type="password" value={pw1} onChange={(e) => { setPw1(e.target.value); setPwMsg(null); }} placeholder="Nova senha"
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary/50 outline-none" />
          <div className="flex gap-2">
            <input type="password" value={pw2} onChange={(e) => { setPw2(e.target.value); setPwMsg(null); }} placeholder="Confirmar nova senha"
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-text-muted focus:border-primary/50 outline-none" />
            <button onClick={handleSavePassword} disabled={savingPw || !pw1}
              className="shrink-0 px-4 py-2 rounded-lg bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/15 active:scale-95 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
              {savingPw ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Atualizar
            </button>
          </div>
        </div>
        {pwMsg && <p className="text-[11px] text-text-muted mt-1.5">{pwMsg}</p>}
      </div>

      {/* Plano */}
      <div className="flex items-center justify-between gap-3 bg-white/[0.03] border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Crown size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm">Plano {planDisplayName(userPlan)}</p>
            <p className="text-text-muted text-[11px] flex items-center gap-1.5"><Calendar size={10} /> Membro desde {formatMemberSince(user.created_at)}</p>
          </div>
        </div>
        {!isPaidPlan(userPlan) && (
          <button onClick={onUpgrade} className="shrink-0 px-4 py-2 rounded-lg bg-primary text-black text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all cursor-pointer">
            Fazer upgrade
          </button>
        )}
      </div>

      {/* Segurança */}
      <div className="border-t border-white/10 pt-4 flex flex-col gap-2">
        <button onClick={handleSignOutAll}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/5 border border-white/10 text-text-muted hover:text-white hover:bg-white/10 text-xs font-bold transition-all active:scale-95 cursor-pointer">
          <LogOut size={14} /> Sair de todos os dispositivos
        </button>
        <button onClick={handleDelete} disabled={deleting}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 text-xs font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-50">
          {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Excluir minha conta
        </button>
      </div>
    </div>
  );
}
