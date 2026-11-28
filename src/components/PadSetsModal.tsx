import { apiUrl } from '../lib/api';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Layers, Pencil, Trash2 } from 'lucide-react';
import type { SelectedPadSet } from '../hooks/usePadSynth';
import { getAuthHeaders } from '../lib/supabase';
import { Button, IconButton, Led, Notice, TextField, cx } from './ui';
import { StageDialog } from './stage/StageDialog';

interface CatalogEntry {
    id: string;
    name: string;
    description: string | null;
    base_path: string;
    created_at: string;
    note_urls?: Record<string, string>;
}

interface PadSetsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (padSet: SelectedPadSet) => void;
    selectedPadSet: SelectedPadSet | null;
    isAdmin?: boolean;
}

// Renomear e apagar que não chegaram ao servidor (manutenção 2026-11-27): a frase fica na janela.
const RENAME_ERROR = 'Não deu pra salvar o nome agora. Confira a internet e tente de novo.';
const DELETE_ERROR = 'Não deu pra apagar agora. Confira a internet e tente de novo.';

export function PadSetsModal({ isOpen, onClose, onSelect, selectedPadSet, isAdmin }: PadSetsModalProps) {
    const [sets, setSets] = useState<CatalogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    // Envio do renomear ou do apagar: os botões mostram e travam (o ref barra o segundo toque antes
    // da renderização), e a falha vira frase na linha, que fica aberta pra tentar de novo.
    const [sending, setSending] = useState<'save' | 'delete' | null>(null);
    const sendingRef = useRef(false);
    const [sendError, setSendError] = useState<string | null>(null);
    // O foco no envio (revisão das telas, I1): no Chromium o botão focado que fica desligado perde o
    // foco pro body, e aí o Esc não cancela, o Tab sai pra trás da janela e o palco antigo recebe a
    // tecla. O foco que está num botão vai pra janela enquanto envia e, no fim, volta pro botão
    // apertado (falha, pra tentar de novo) ou fica na janela (sucesso: a linha some).
    const contentRef = useRef<HTMLDivElement>(null);
    const focusAfterSend = useRef<'save' | 'delete' | 'dialog' | null>(null);
    const dialogEl = () => contentRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    const holdFocusInDialog = () => {
        const dialog = dialogEl();
        if (document.activeElement instanceof HTMLButtonElement && dialog?.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    };
    useEffect(() => {
        const target = focusAfterSend.current;
        if (sending !== null || !target) return;
        focusAfterSend.current = null;
        // Janela fechada no meio do envio: nada a focar.
        const el = target === 'dialog' ? dialogEl() : contentRef.current?.querySelector<HTMLElement>(`[data-send="${target}"]`) ?? dialogEl();
        el?.focus({ preventScroll: true });
    }, [sending]);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        setLoadError(null);
        fetch(apiUrl('/api/pad-catalog'))
            .then(async r => {
                if (r.ok) return r.json() as Promise<{ sets: CatalogEntry[] }>;
                const body = await r.json().catch(() => ({})) as { error?: string; code?: string };
                throw new Error(`${r.status} ${body.code || body.error || 'erro desconhecido'}`);
            })
            .then(data => setSets(data.sets || []))
            .catch(err => {
                setSets([]);
                setLoadError(err instanceof Error ? err.message : 'erro de rede');
            })
            .finally(() => setLoading(false));
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSelect = (padSet: CatalogEntry) => {
        if (editingId) return; // don't select while editing
        onSelect({ id: padSet.id, name: padSet.name, base_path: padSet.base_path, note_urls: padSet.note_urls });
        onClose();
    };

    // Uma linha aberta por vez (revisão das telas, M3): abrir a edição fecha o apagar e vice-versa,
    // e a frase de falha é sempre da linha aberta.
    const startEdit = (padSet: CatalogEntry, e: React.MouseEvent) => {
        e.stopPropagation();
        setSendError(null);
        setDeletingId(null);
        setEditingId(padSet.id);
        setEditName(padSet.name);
        setEditDesc(padSet.description || '');
    };

    const saveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editingId || sendingRef.current) return;
        const id = editingId;
        const name = editName.trim() || 'Sem nome';
        const description = editDesc.trim() || null;
        sendingRef.current = true;
        setSending('save');
        setSendError(null);
        holdFocusInDialog();
        try {
            const res = await fetch(apiUrl('/api/pad-catalog'), {
                method: 'PATCH',
                headers: await getAuthHeaders(),
                body: JSON.stringify({ id, name, description }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setSets(prev => prev.map(s => s.id === id ? { ...s, name, description } : s));
            setEditingId(null);
            focusAfterSend.current = 'dialog';
        } catch (err) {
            console.error('[pads] renomear falhou', err);
            setSendError(RENAME_ERROR);
            focusAfterSend.current = 'save';
        } finally {
            sendingRef.current = false;
            setSending(null);
        }
    };

    const confirmDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSendError(null);
        setEditingId(null);
        setDeletingId(id);
    };

    const executeDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!deletingId || sendingRef.current) return;
        const id = deletingId;
        sendingRef.current = true;
        setSending('delete');
        setSendError(null);
        holdFocusInDialog();
        try {
            const res = await fetch(apiUrl(`/api/pad-catalog?id=${encodeURIComponent(id)}`), {
                method: 'DELETE',
                headers: await getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setSets(prev => prev.filter(s => s.id !== id));
            setDeletingId(null);
            focusAfterSend.current = 'dialog';
        } catch (err) {
            console.error('[pads] apagar falhou', err);
            setSendError(DELETE_ERROR);
            focusAfterSend.current = 'delete';
        } finally {
            sendingRef.current = false;
            setSending(null);
        }
    };

    const cancelEdit = () => { if (sendingRef.current) return; setSendError(null); setEditingId(null); };
    const cancelDelete = () => { if (sendingRef.current) return; setSendError(null); setDeletingId(null); };
    // Renomeando ou confirmando o apagar, o Esc cancela só isso (a janela não fecha, nem no toque
    // fora) e o foco fica na janela, porque a linha some.
    const cancelOnEscape = (cancel: () => void) => (e: React.KeyboardEvent<HTMLLIElement>) => {
        if (e.key !== 'Escape' || sendingRef.current) return;
        e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
        cancel();
    };

    return (
        <StageDialog open title="Pads da nuvem" size="sm" onClose={onClose} dismissible={!editingId && !deletingId}>
            <div ref={contentRef} className="flex flex-col gap-3">
                <p className="text-ps-mut">Escolha um conjunto de pads.</p>

                {loading && (
                    <p role="status" className="flex items-center gap-2 text-ps-mut">
                        <Loader2 size={16} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />
                        Carregando...
                    </p>
                )}

                {!loading && loadError && (
                    <Notice tone="alert" role="alert">
                        <span className="block">Falha ao carregar o catálogo.</span>
                        <span className="block ps-num text-ps-sm font-normal">{loadError}</span>
                    </Notice>
                )}

                {!loading && !loadError && sets.length === 0 && (
                    <Notice role="status">
                        <span className="block font-bold">Nenhum conjunto de pads disponível.</span>
                        <span className="block text-ps-mut">Envie pads pelo painel Admin.</span>
                    </Notice>
                )}

                {sets.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {sets.map(padSet => {
                            const isActive = selectedPadSet?.id === padSet.id;

                            if (editingId === padSet.id) {
                                return (
                                    <li key={padSet.id} onKeyDown={cancelOnEscape(cancelEdit)} className="flex flex-col gap-3 rounded-ps-lg bg-ps-s1 p-3 inset-ring inset-ring-ps-line-2">
                                        <TextField label="Nome do conjunto" autoFocus value={editName} onChange={e => setEditName(e.target.value)} placeholder="Nome do conjunto" />
                                        <TextField label="Descrição (opcional)" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Descrição (opcional)" />
                                        {sendError && <Notice tone="alert" role="alert">{sendError}</Notice>}
                                        <div className="flex flex-wrap justify-end gap-2">
                                            <Button tone="ghost" disabled={sending !== null} onClick={cancelEdit}>Cancelar</Button>
                                            <Button
                                                tone="primary" data-send="save" disabled={sending !== null} aria-busy={sending === 'save' || undefined} onClick={saveEdit}
                                                icon={sending === 'save' ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : undefined}
                                            >
                                                {sending === 'save' ? 'Salvando...' : 'Salvar'}
                                            </Button>
                                        </div>
                                    </li>
                                );
                            }

                            if (deletingId === padSet.id) {
                                return (
                                    <li key={padSet.id} onKeyDown={cancelOnEscape(cancelDelete)} className="flex flex-col gap-2 rounded-ps-lg bg-ps-alert-soft p-3 inset-ring inset-ring-ps-alert-line">
                                        <p className="font-bold text-ps-alert break-words">Apagar "{padSet.name}"?</p>
                                        <p className="text-ps-sm text-ps-mut">Esta ação não pode ser desfeita.</p>
                                        {sendError && <Notice tone="alert" role="alert">{sendError}</Notice>}
                                        <div className="flex flex-wrap justify-end gap-2">
                                            {/* A lixeira some com a confirmação: o foco vem pro Cancelar, dentro da janela. */}
                                            <Button tone="ghost" autoFocus disabled={sending !== null} onClick={cancelDelete}>Cancelar</Button>
                                            <Button
                                                tone="alert" data-send="delete" disabled={sending !== null} aria-busy={sending === 'delete' || undefined} onClick={executeDelete}
                                                icon={sending === 'delete' ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> : undefined}
                                            >
                                                {sending === 'delete' ? 'Apagando...' : 'Apagar'}
                                            </Button>
                                        </div>
                                    </li>
                                );
                            }

                            return (
                                <li
                                    key={padSet.id}
                                    className={cx('flex items-center gap-1 rounded-ps-lg p-1 inset-ring', isActive ? 'bg-ps-or-soft inset-ring-ps-or-line' : 'bg-ps-s1 inset-ring-ps-line')}
                                >
                                    {/* Escolher é tocar no conjunto: em uso fica laranja (ligado). */}
                                    <button
                                        type="button"
                                        aria-current={isActive ? 'true' : undefined}
                                        onClick={() => handleSelect(padSet)}
                                        className="flex min-h-ps-touch min-w-0 flex-1 items-center gap-3 rounded-ps-md px-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ps-or"
                                    >
                                        <Layers size={18} aria-hidden="true" className={cx('shrink-0', isActive ? 'text-ps-or' : 'text-ps-mut')} />
                                        <span className="min-w-0 flex-1">
                                            <span className={cx('block break-words text-ps-base font-bold', isActive ? 'text-ps-or' : 'text-ps-bone')}>{padSet.name}</span>
                                            {padSet.description && (
                                                <span className="block break-words text-ps-sm text-ps-mut">{padSet.description}</span>
                                            )}
                                        </span>
                                        {isActive && <Led state="on" label="Em uso" />}
                                    </button>
                                    {isAdmin && (
                                        <>
                                            <IconButton tone="ghost" aria-label={`Renomear ${padSet.name}`} title="Renomear" icon={<Pencil size={16} />} disabled={sending !== null} onClick={e => startEdit(padSet, e)} />
                                            <IconButton tone="ghost" aria-label={`Apagar ${padSet.name}`} title="Apagar" icon={<Trash2 size={16} />} disabled={sending !== null} onClick={e => confirmDelete(padSet.id, e)} />
                                        </>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </StageDialog>
    );
}
