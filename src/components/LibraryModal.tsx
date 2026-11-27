import { useState, useEffect } from 'react';
import { useCloudLibrary } from '../hooks/useCloudLibrary';
import { useAuth } from '../hooks/useAuth';
import { updateSong, type CloudSong } from '../lib/supabase';
import { updateCachedSongMeta } from '../lib/offlineCache';
import { uploadToR2 } from '../lib/r2';
import { type Marker } from '../types';
import { INVALID_BPM_MESSAGE, editedBpmColumns, preciseBpm } from '../lib/cloudBpm';
import type { TimeSignatureType } from '../lib/AudioAnalyzer';
import { LibraryView } from './library/LibraryView';
import { EDIT_COPY, downloadStateOf, libraryCountText, libraryEmptyText, removeScopeHolds, removeScopeOf, songsForTab, type LibraryEdit, type LibraryRow, type LibraryTab, type RemoveScope } from './library/libraryRows';

interface LibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDownload: (files: File[], songName: string, coverUrl: string | null, markers?: Marker[], originalKey?: string | null, artist?: string, bpm?: number, extra?: { lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null; timeSignature?: TimeSignatureType | null }, songId?: string) => void;
    // Pergunta antes de baixar (Parte 3, Livre): falso não baixa nada. Sem ela, baixa como sempre.
    onBeforeDownload?: (songId: string) => boolean;
    // Reflete a edição (nome/tom/bpm/capa) na música já baixada/no ao vivo.
    onSongEdited?: (e: { songId: string; prevName: string; prevBpm?: number; prevOriginalKey?: string | null; name: string; artist?: string; originalKey?: string | null; bpm?: number; coverImage?: string }) => void;
}

export function LibraryModal({ isOpen, onClose, onDownload, onBeforeDownload, onSongEdited }: LibraryModalProps) {
    const {
        songs,
        searchQuery,
        setSearchQuery,
        isLoadingList,
        downloadingSongId,
        downloadProgress,
        deletingSongId,
        downloadSong,
        refreshSongs,
        removeSong,
        cancelDownload,
        cachedSongIds,
        isOnline
    } = useCloudLibrary();

    const { user, isAdmin } = useAuth();

    const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
    // bpmText: o que está digitado no campo de BPM (undefined = não mexeu).
    const [editingSong, setEditingSong] = useState<Partial<CloudSong> & { file?: File | null; bpmText?: string }>({});
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [activeTab, setActiveTab] = useState<LibraryTab>('platform');
    // Erro da edição (antes era o aviso do navegador): frase em alerta dentro da janela (Parte 3).
    const [message, setMessage] = useState<string | null>(null);
    // A música da confirmação de excluir (antes era a pergunta do navegador): a segunda janela do palco.
    // Guarda o escopo de quando abriu (Ruling INICIO-residuais): a internet voltando não troca a janela.
    const [deleteAsk, setDeleteAsk] = useState<{ id: string; scope: RemoveScope } | null>(null);

    useEffect(() => {
        if (isOpen) refreshSongs();
    }, [isOpen]);

    const handleEditSave = async (song: CloudSong) => {
        // O BPM vai pra nuvem nas duas colunas (bpmColumns): o inteiro, que os
        // apps antigos leem, e o exato com 2 casas. Aceita "72,5" ou "72.5";
        // texto inválido avisa e não grava (nunca apaga o BPM por engano).
        const bpmCols = editedBpmColumns(song, editingSong.bpmText);
        if (!bpmCols) {
            setMessage(INVALID_BPM_MESSAGE);
            return;
        }

        setMessage(null);
        setIsSavingEdit(true);
        try {
            let newCoverUrl = song.cover_url;
            if (editingSong.file) {
                const cName = `${Date.now()}_${editingSong.file.name.replace(/\s+/g, '_')}`;
                const rRes = await uploadToR2('covers', cName, editingSong.file);
                if (!rRes.error && rRes.url) {
                    newCoverUrl = rRes.url;
                }
            }
            
            const updates = {
                name: editingSong.name ?? song.name,
                artist: editingSong.artist ?? song.artist,
                ...bpmCols,
                key: editingSong.key ?? song.key,
                cover_url: newCoverUrl
            };
            
            const ok = await updateSong(song.id, updates);
            if (ok) {
                // Sincroniza os dois snapshots que ficavam congelados de quando a
                // música foi baixada: (1) o índice do cache offline e (2) o item
                // já presente no repertório/ao vivo. Sem isto, a lista atualizava
                // mas a música baixada continuava com nome/tom/bpm antigos.
                // O patch leva bpm e bpm_exact, e o repertório recebe o BPM
                // exato (preciseBpm): é por ele que o syncSongMeta acha a música.
                await updateCachedSongMeta(song.id, updates);
                const prevName = song.artist ? `${song.artist} - ${song.name}` : song.name;
                const newName = updates.artist ? `${updates.artist} - ${updates.name}` : updates.name;
                onSongEdited?.({
                    songId: song.id,
                    prevName,
                    prevBpm: preciseBpm(song),
                    prevOriginalKey: song.key ?? null,
                    name: newName,
                    artist: updates.artist ?? undefined,
                    originalKey: updates.key ?? null,
                    bpm: preciseBpm(bpmCols) ?? 0,
                    coverImage: newCoverUrl ?? undefined,
                });
                await refreshSongs();
                setEditingSong({});
            } else {
                setMessage(EDIT_COPY.saveError);
            }
        } catch (e) {
            console.error(e);
            setMessage(EDIT_COPY.editError);
        } finally {
            setIsSavingEdit(false);
        }
    };


    if (!isOpen) return null;

    const handleDownload = async (songId: string, songName: string) => {
        // No Livre a música conta nas do mês: sem vaga, o App mostra a tela de limite e nada baixa.
        if (onBeforeDownload && !onBeforeDownload(songId)) return;
        setMessage(null);
        const result = await downloadSong(songId);
        // Sem espaço no aparelho: a frase aparece na janela (antes era o aviso do navegador, inicio-1 M2).
        if (result && 'refused' in result) {
            setMessage(result.refused);
            return;
        }
        // files vazio + cachedSourceId = música no cache: o engine carrega lendo do
        // cache 1 stem por vez (sem segurar todos os blobs na memória = OOM mobile).
        if (result && (result.files.length > 0 || result.cachedSourceId)) {
            onDownload(result.files, songName, result.coverUrl, result.markers || undefined, result.originalKey, result.artist, result.bpm, { lyrics: result.lyrics, lyricsSynced: result.lyricsSynced, chords: result.chords, timeSignature: result.timeSignature }, songId);
            setDownloadedIds(prev => new Set(prev).add(songId));
        }
    };

    const shownSongs = songsForTab(songs, activeTab, user?.id);
    const rows: LibraryRow[] = shownSongs.map((song) => {
        const cached = cachedSongIds.has(song.id);
        const mine = isAdmin || song.user_id === user?.id;
        return {
            id: song.id,
            name: song.name,
            artist: song.artist || null,
            coverUrl: song.cover_url,
            key: song.key || null,
            bpm: preciseBpm(song),
            cached,
            state: downloadStateOf({ downloading: downloadingSongId === song.id, added: downloadedIds.has(song.id), online: isOnline, cached }),
            progress: downloadingSongId === song.id ? String(downloadProgress || '') : '',
            canEdit: isOnline && mine,
            remove: removeScopeOf({ online: isOnline, isAdmin, cached }),
            deleting: deletingSongId === song.id,
        };
    });

    // A edição aberta, com o que está digitado por cima dos valores da música (o que não foi mexido
    // continua indefinido no editingSong e o salvar usa o da música, como antes). Só a da aba (e da
    // busca) à vista (inicio-1 M4): fora dela a Biblioteca fecha no Esc e a frase fica no alto da
    // lista; de volta, a edição continua com o que foi digitado.
    const editedSong = editingSong.id ? shownSongs.find((s) => s.id === editingSong.id) : undefined;
    const edit: LibraryEdit | null = editedSong ? {
        id: editedSong.id,
        name: editingSong.name ?? editedSong.name,
        artist: (editingSong.artist ?? editedSong.artist) || '',
        bpmText: editingSong.bpmText ?? String(preciseBpm(editedSong) ?? ''),
        key: (editingSong.key ?? editedSong.key) || '',
        file: editingSong.file ?? null,
    } : null;

    // A lixeira lê a internet e o aparelho quando abre e guarda o escopo (Ruling INICIO-residuais): o
    // título, o texto e o removeSong andam juntos com ele até a janela fechar. Aberta como "Tirar
    // deste aparelho?", a internet voltar não a vira "Excluir da nuvem?" e confirmar só tira do aparelho.
    const handleAskDelete = (id: string) => {
        const scope = removeScopeOf({ online: isOnline, isAdmin, cached: cachedSongIds.has(id) });
        if (scope) setDeleteAsk({ id, scope });
    };
    const deleteSong = deleteAsk ? songs.find((s) => s.id === deleteAsk.id) : undefined;
    const deleteScope = deleteSong && deleteAsk && removeScopeHolds(deleteAsk.scope, { online: isOnline, isAdmin, cached: cachedSongIds.has(deleteSong.id) })
        ? deleteAsk.scope : null;
    // A música saiu da lista (a internet caiu e a lista virou a do aparelho) ou o escopo dela não dá
    // mais pra fazer: a confirmação fecha de vez e nunca reabre sozinha quando a lista volta (inicio-1 M3).
    if (deleteAsk && !deleteScope) setDeleteAsk(null);
    const confirmDelete = deleteSong && deleteScope ? { name: deleteSong.name, scope: deleteScope, busy: deletingSongId === deleteSong.id } : null;
    const handleConfirmDelete = async () => {
        if (!deleteSong || !deleteScope) return;
        try {
            await removeSong(deleteSong.id, deleteScope);
        } finally {
            setDeleteAsk(null);
        }
    };

    return (
        <LibraryView
            open
            onClose={onClose}
            onRefresh={() => { void refreshSongs(); }}
            query={searchQuery}
            onQuery={setSearchQuery}
            tab={activeTab}
            onTab={setActiveTab}
            loading={isLoadingList}
            countText={libraryCountText(shownSongs.length)}
            emptyText={shownSongs.length === 0 ? libraryEmptyText(searchQuery, activeTab) : null}
            message={message}
            rows={rows}
            anyDownloading={!!downloadingSongId}
            edit={edit}
            savingEdit={isSavingEdit}
            onImport={(id, name) => { void handleDownload(id, name); }}
            onCancel={cancelDownload}
            onEdit={(id) => { setMessage(null); setEditingSong({ id }); }}
            onEditChange={(p) => setEditingSong((e) => ({ ...e, ...p }))}
            onEditSave={() => { if (editedSong) void handleEditSave(editedSong); }}
            onEditClose={() => { setMessage(null); setEditingSong({}); }}
            onAskDelete={handleAskDelete}
            confirmDelete={confirmDelete}
            onConfirmDelete={() => { void handleConfirmDelete(); }}
            onCancelDelete={() => setDeleteAsk(null)}
        />
    );
}
