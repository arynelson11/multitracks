import { useState, useEffect } from 'react';
import { Search, X, Download, Cloud, Loader2, Music, RefreshCcw, Trash2, Edit2, Save, UploadCloud } from 'lucide-react';
import { useCloudLibrary } from '../hooks/useCloudLibrary';
import { useAuth } from '../hooks/useAuth';
import { updateSong, type CloudSong } from '../lib/supabase';
import { updateCachedSongMeta } from '../lib/offlineCache';
import { uploadToR2 } from '../lib/r2';
import { type Marker } from '../types';

interface LibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDownload: (files: File[], songName: string, coverUrl: string | null, markers?: Marker[], originalKey?: string | null, artist?: string, bpm?: number, extra?: { lyrics?: string | null; lyricsSynced?: string | null; chords?: string | null }, songId?: string) => void;
    // Reflete a edição (nome/tom/bpm/capa) na música já baixada/no ao vivo.
    onSongEdited?: (e: { songId: string; prevName: string; prevBpm?: number; prevOriginalKey?: string | null; name: string; artist?: string; originalKey?: string | null; bpm?: number; coverImage?: string }) => void;
}

export function LibraryModal({ isOpen, onClose, onDownload, onSongEdited }: LibraryModalProps) {
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

    const { user } = useAuth();
    const isAdmin = user?.email === 'arynelson11@gmail.com' || user?.email === 'arynel11@gmail.com';

    const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());
    const [editingSong, setEditingSong] = useState<Partial<CloudSong> & { file?: File | null }>({});
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const [activeTab, setActiveTab] = useState<'platform' | 'personal'>('platform');

    useEffect(() => {
        if (isOpen) refreshSongs();
    }, [isOpen]);

    const handleEditSave = async (song: CloudSong) => {
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
                bpm: editingSong.bpm ?? song.bpm,
                key: editingSong.key ?? song.key,
                cover_url: newCoverUrl
            };
            
            const ok = await updateSong(song.id, updates);
            if (ok) {
                // Sincroniza os dois snapshots que ficavam congelados de quando a
                // música foi baixada: (1) o índice do cache offline e (2) o item
                // já presente no repertório/ao vivo. Sem isto, a lista atualizava
                // mas a música baixada continuava com nome/tom/bpm antigos.
                await updateCachedSongMeta(song.id, updates);
                const prevName = song.artist ? `${song.artist} - ${song.name}` : song.name;
                const newName = updates.artist ? `${updates.artist} - ${updates.name}` : updates.name;
                onSongEdited?.({
                    songId: song.id,
                    prevName,
                    prevBpm: song.bpm,
                    prevOriginalKey: song.key ?? null,
                    name: newName,
                    artist: updates.artist ?? undefined,
                    originalKey: updates.key ?? null,
                    bpm: updates.bpm,
                    coverImage: newCoverUrl ?? undefined,
                });
                await refreshSongs();
                setEditingSong({});
            } else {
                alert("Erro ao salvar alterações na música.");
            }
        } catch (e) {
            console.error(e);
            alert("Erro ao editar.");
        } finally {
            setIsSavingEdit(false);
        }
    };


    if (!isOpen) return null;

    const handleDownload = async (songId: string, songName: string) => {
        const result = await downloadSong(songId);
        // files vazio + cachedSourceId = música no cache: o engine carrega lendo do
        // cache 1 stem por vez (sem segurar todos os blobs na memória = OOM mobile).
        if (result && (result.files.length > 0 || result.cachedSourceId)) {
            onDownload(result.files, songName, result.coverUrl, result.markers || undefined, result.originalKey, result.artist, result.bpm, { lyrics: result.lyrics, lyricsSynced: result.lyricsSynced, chords: result.chords }, songId);
            setDownloadedIds(prev => new Set(prev).add(songId));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6">
            <div className="daw-panel w-full max-w-3xl h-full max-h-[85vh] rounded-lg flex flex-col overflow-hidden">

                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                        <Cloud size={16} className="text-secondary" />
                        <h2 className="text-white font-black text-sm uppercase tracking-wider">Biblioteca na Nuvem</h2>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={refreshSongs} className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-all active:scale-90 cursor-pointer">
                            <RefreshCcw size={14} />
                        </button>
                        <button onClick={onClose} className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-all active:scale-90 cursor-pointer">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Search Bar & Tabs */}
                <div className="flex flex-col border-b border-border shrink-0 bg-[#0a0a0c]">
                    <div className="px-3 py-2">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                            <input
                                type="text"
                                placeholder="Pesquisar por nome, artista ou tom..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full daw-input text-white text-xs pl-9 pr-4 py-2 rounded-md placeholder:text-text-muted/30 font-mono"
                            />
                            {searchQuery && (
                                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white transition-all active:scale-90 cursor-pointer p-1">
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="flex px-3 gap-4">
                        <button 
                            onClick={() => setActiveTab('platform')}
                            className={`pb-2 text-[10px] font-black uppercase tracking-wider transition-colors border-b-2 cursor-pointer ${activeTab === 'platform' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-white'}`}>
                            Plataforma
                        </button>
                        <button 
                            onClick={() => setActiveTab('personal')}
                            className={`pb-2 text-[10px] font-black uppercase tracking-wider transition-colors border-b-2 cursor-pointer ${activeTab === 'personal' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-white'}`}>
                            Minhas Músicas
                        </button>
                    </div>
                </div>

                {/* Song List */}
                <div className="flex-1 overflow-y-auto p-3 bg-[#0e0e10]">
                    {isLoadingList ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
                            <Loader2 size={24} className="animate-spin text-secondary" />
                            <span className="text-[10px] font-mono uppercase tracking-wider">Carregando a biblioteca...</span>
                        </div>
                    ) : (
                        (() => {
                            const filteredSongs = songs.filter((s: CloudSong) => {
                                if (activeTab === 'platform') return s.is_global === true;
                                return s.is_global !== true && s.user_id === user?.id;
                            });

                            if (filteredSongs.length === 0) {
                                return (
                                    <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
                                        <Cloud size={40} className="opacity-15" />
                                        <span className="text-[10px] font-mono">
                                            {searchQuery ? 'Nenhuma música encontrada.' : (activeTab === 'platform' ? 'Plataforma vazia.' : 'Nenhuma música pessoal encontrada.')}
                                        </span>
                                    </div>
                                );
                            }

                            return (
                                <div className="grid gap-2">
                                    {filteredSongs.map((song: CloudSong) => {
                                        const isDownloading = downloadingSongId === song.id;
                                        const isDownloaded = downloadedIds.has(song.id);
                                        const isEditing = editingSong.id === song.id;

                                if (isEditing) {
                                    return (
                                        <div key={song.id} className="flex flex-col gap-3 p-3 rounded-md border border-secondary/20 bg-surface">
                                            <div className="flex justify-between items-center mb-1">
                                                <h3 className="font-black text-white text-xs uppercase tracking-wider">Editar Música</h3>
                                                <button onClick={() => setEditingSong({})} className="text-text-muted hover:text-white"><X size={14}/></button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[9px] text-text-muted uppercase font-bold font-mono tracking-wider">Nome</label>
                                                    <input value={editingSong.name ?? song.name} onChange={e => setEditingSong({...editingSong, name: e.target.value})} className="w-full daw-input rounded-md px-2 py-1.5 text-white text-xs font-mono" />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] text-text-muted uppercase font-bold font-mono tracking-wider">Artista</label>
                                                    <input value={(editingSong.artist ?? song.artist) || ''} onChange={e => setEditingSong({...editingSong, artist: e.target.value})} className="w-full daw-input rounded-md px-2 py-1.5 text-white text-xs font-mono" />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] text-text-muted uppercase font-bold font-mono tracking-wider">BPM</label>
                                                    <input type="number" value={editingSong.bpm ?? song.bpm} onChange={e => setEditingSong({...editingSong, bpm: Number(e.target.value)})} className="w-full daw-input rounded-md px-2 py-1.5 text-white text-xs font-mono" />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] text-text-muted uppercase font-bold font-mono tracking-wider">Tom</label>
                                                    <input value={(editingSong.key ?? song.key) || ''} onChange={e => setEditingSong({...editingSong, key: e.target.value})} className="w-full daw-input rounded-md px-2 py-1.5 text-white text-xs font-mono" />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="text-[9px] text-text-muted uppercase font-bold font-mono tracking-wider">Nova Capa (Opcional)</label>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <label className="flex flex-1 items-center gap-2 daw-input px-2 py-1.5 rounded-md cursor-pointer text-xs text-text-muted font-mono">
                                                            <UploadCloud size={12} />
                                                            <span className="truncate">{editingSong.file ? editingSong.file.name : 'Escolher imagem...'}</span>
                                                            <input type="file" accept="image/*" className="hidden" onChange={e => setEditingSong({...editingSong, file: e.target.files?.[0]})} />
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end mt-1">
                                                <button onClick={() => handleEditSave(song)} disabled={isSavingEdit} className="bg-secondary text-black font-black px-3 py-1.5 rounded-md text-[10px] flex items-center gap-1.5 uppercase tracking-wider disabled:opacity-50">
                                                    {isSavingEdit ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} SALVAR
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }

                                return (
                                    <div key={song.id}
                                        className={`flex flex-wrap items-center gap-2 sm:gap-3 p-2.5 rounded-md border transition-all ${isDownloaded
                                            ? 'bg-primary/5 border-primary/15'
                                            : 'bg-surface border-border hover:border-white/15 hover:bg-white/3'
                                            }`}>

                                        {/* Cover */}
                                        <div className="w-12 h-12 rounded-md bg-black/40 flex-shrink-0 overflow-hidden border border-border flex items-center justify-center">
                                            {song.cover_url ? (
                                                <img src={song.cover_url} className="w-full h-full object-cover" alt={song.name} loading="lazy" />
                                            ) : (
                                                <Music size={16} className="opacity-15" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0 basis-0">
                                            <div className="font-bold text-xs text-white truncate uppercase tracking-wider">{song.name}</div>
                                            <div className="text-[10px] text-text-muted truncate font-mono">{song.artist || 'Artista Desconhecido'}</div>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                {song.key && (
                                                    <span className="text-[9px] font-bold bg-secondary/10 text-secondary px-1.5 py-0.5 rounded font-mono">
                                                        TOM: {song.key}
                                                    </span>
                                                )}
                                                {song.bpm > 0 && (
                                                    <span className="text-[9px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">
                                                        {song.bpm} BPM
                                                    </span>
                                                )}
                                                {cachedSongIds.has(song.id) && (
                                                    <span className="text-[9px] font-bold bg-[#5b6b47]/20 text-[#8b9b6e] px-1.5 py-0.5 rounded font-mono flex items-center gap-1">
                                                        <span className="w-1 h-1 rounded-full bg-[#8b9b6e]" />
                                                        OFFLINE
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Download and Delete Buttons — quebra para próxima linha em mobile estreito */}
                                        <div className="flex items-center gap-2 ml-auto basis-full sm:basis-auto sm:ml-0 justify-end sm:justify-start pt-2 sm:pt-0 border-t sm:border-t-0 border-white/5 -mx-0.5 sm:mx-0 px-0.5 sm:px-0">
                                            {(cachedSongIds.has(song.id) || (isOnline && (isAdmin || song.user_id === user?.id))) && (
                                                <div className="flex items-center gap-1">
                                                    {isOnline && (isAdmin || song.user_id === user?.id) && (
                                                        <button
                                                            onClick={() => setEditingSong({ id: song.id })}
                                                            className="p-1.5 rounded-md text-xs flex items-center justify-center transition-all cursor-pointer bg-blue-500/10 text-blue-400 hover:bg-blue-500 hover:text-white border border-blue-500/15 active:scale-95"
                                                            title="Editar metadados"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={async () => {
                                                            const msg = isOnline
                                                                ? `Excluir "${song.name}" da Nuvem e do Cache Local? Isso removerá permanentemente para todos os usuários.`
                                                                : `Remover "${song.name}" do Cache Offline local?`;
                                                            if (window.confirm(msg)) {
                                                                await removeSong(song.id);
                                                            }
                                                        }}
                                                        disabled={deletingSongId === song.id}
                                                        className={`p-1.5 rounded-md text-xs flex items-center justify-center transition-all cursor-pointer ${deletingSongId === song.id
                                                            ? 'bg-accent-red/10 text-accent-red/50 cursor-not-allowed'
                                                            : 'bg-accent-red/10 text-accent-red hover:bg-accent-red hover:text-white border border-accent-red/15 active:scale-95'
                                                            }`}
                                                        title={isOnline ? "Excluir da Nuvem" : "Remover do Cache Local"}
                                                    >
                                                        {deletingSongId === song.id ? (
                                                            <Loader2 size={16} className="animate-spin" />
                                                        ) : (
                                                            <Trash2 size={16} />
                                                        )}
                                                    </button>
                                                </div>
                                            )}
                                            {isDownloading ? (
                                                <div className="flex flex-col items-center gap-1 min-w-[70px]">
                                                    <Loader2 size={16} className="animate-spin text-secondary" />
                                                    <span className="text-[8px] text-secondary font-bold text-center font-mono uppercase tracking-wider leading-tight max-w-[80px]">{downloadProgress}</span>
                                                    <button
                                                        onClick={() => cancelDownload(song.id)}
                                                        className="text-[8px] text-accent-red font-bold underline uppercase cursor-pointer hover:text-white mt-0.5 active:scale-95 px-1 rounded hover:bg-white/5 transition-all"
                                                        title="Cancelar download"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            ) : isDownloaded ? (
                                                <div className="flex items-center gap-1 text-primary text-[10px] font-bold px-2 py-1.5 rounded-md bg-primary/10 font-mono uppercase">
                                                    <span>✓</span> ADICIONADA
                                                </div>
                                            ) : (!isOnline && !cachedSongIds.has(song.id)) ? (
                                                <div className="flex items-center gap-1 text-text-muted text-[10px] font-bold px-2.5 py-1.5 rounded-md bg-white/5 border border-white/10 font-mono uppercase cursor-not-allowed" title="Conecte-se à internet para baixar esta música">
                                                    <span>OFFLINE</span>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleDownload(song.id, song.name)}
                                                    disabled={!!downloadingSongId}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px] uppercase tracking-wider font-mono ${cachedSongIds.has(song.id) ? 'bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20' : 'bg-secondary/10 hover:bg-secondary/20 text-secondary border border-secondary/10'}`}
                                                    title={cachedSongIds.has(song.id) ? "Carregar do cache local offline" : "Baixar e importar da Nuvem"}
                                                >
                                                    {cachedSongIds.has(song.id) ? <Cloud size={14} /> : <Download size={14} />}
                                                    <span className="hidden sm:inline">{cachedSongIds.has(song.id) ? 'ABRIR' : 'IMPORTAR'}</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                                    })}
                                </div>
                            );
                        })()
                    )}
                </div>

                {/* Footer */}
                <div className="px-3 py-2 border-t border-border text-center shrink-0">
                    <span className="text-[9px] text-text-muted/30 font-mono uppercase tracking-wider">
                        {songs.filter((s: CloudSong) => activeTab === 'platform' ? s.is_global : !s.is_global && s.user_id === user?.id).length} música(s) exibida(s)
                    </span>
                </div>
            </div>
        </div>
    );
}
