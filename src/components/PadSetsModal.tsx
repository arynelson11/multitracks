import { apiUrl } from '../lib/api';
import { useEffect, useState } from 'react';
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

export function PadSetsModal({ isOpen, onClose, onSelect, selectedPadSet, isAdmin }: PadSetsModalProps) {
    const [sets, setSets] = useState<CatalogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const startEdit = (padSet: CatalogEntry, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingId(padSet.id);
        setEditName(padSet.name);
        setEditDesc(padSet.description || '');
    };

    const saveEdit = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editingId) return;
        const res = await fetch(apiUrl('/api/pad-catalog'), {
            method: 'PATCH',
            headers: await getAuthHeaders(),
            body: JSON.stringify({ id: editingId, name: editName.trim() || 'Sem nome', description: editDesc.trim() || null }),
        });
        if (res.ok) {
            setSets(prev => prev.map(s => s.id === editingId
                ? { ...s, name: editName.trim() || 'Sem nome', description: editDesc.trim() || null }
                : s
            ));
        }
        setEditingId(null);
    };

    const confirmDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeletingId(id);
    };

    const executeDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!deletingId) return;
        const res = await fetch(apiUrl(`/api/pad-catalog?id=${encodeURIComponent(deletingId)}`), {
            method: 'DELETE',
            headers: await getAuthHeaders(),
        });
        if (res.ok) {
            setSets(prev => prev.filter(s => s.id !== deletingId));
        }
        setDeletingId(null);
    };

    const cancelEdit = () => setEditingId(null);
    const cancelDelete = () => setDeletingId(null);
    // Renomeando ou confirmando o apagar, o Esc cancela só isso (a janela não fecha, nem no toque
    // fora) e o foco fica na janela, porque a linha some.
    const cancelOnEscape = (cancel: () => void) => (e: React.KeyboardEvent<HTMLLIElement>) => {
        if (e.key !== 'Escape') return;
        e.currentTarget.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
        cancel();
    };

    return (
        <StageDialog open title="Pads da nuvem" size="sm" onClose={onClose} dismissible={!editingId && !deletingId}>
            <div className="flex flex-col gap-3">
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
                                        <div className="flex flex-wrap justify-end gap-2">
                                            <Button tone="ghost" onClick={cancelEdit}>Cancelar</Button>
                                            <Button tone="primary" onClick={saveEdit}>Salvar</Button>
                                        </div>
                                    </li>
                                );
                            }

                            if (deletingId === padSet.id) {
                                return (
                                    <li key={padSet.id} onKeyDown={cancelOnEscape(cancelDelete)} className="flex flex-col gap-2 rounded-ps-lg bg-ps-alert-soft p-3 inset-ring inset-ring-ps-alert-line">
                                        <p className="font-bold text-ps-alert break-words">Apagar "{padSet.name}"?</p>
                                        <p className="text-ps-sm text-ps-mut">Esta ação não pode ser desfeita.</p>
                                        <div className="flex flex-wrap justify-end gap-2">
                                            {/* A lixeira some com a confirmação: o foco vem pro Cancelar, dentro da janela. */}
                                            <Button tone="ghost" autoFocus onClick={cancelDelete}>Cancelar</Button>
                                            <Button tone="alert" onClick={executeDelete}>Apagar</Button>
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
                                            <IconButton tone="ghost" aria-label={`Renomear ${padSet.name}`} title="Renomear" icon={<Pencil size={16} />} onClick={e => startEdit(padSet, e)} />
                                            <IconButton tone="ghost" aria-label={`Apagar ${padSet.name}`} title="Apagar" icon={<Trash2 size={16} />} onClick={e => confirmDelete(padSet.id, e)} />
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
