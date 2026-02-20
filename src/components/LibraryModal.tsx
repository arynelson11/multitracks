import { useState } from 'react';
import { Search, X, Download, Cloud, Loader2, Music, RefreshCcw } from 'lucide-react';
import { useCloudLibrary } from '../hooks/useCloudLibrary';

interface LibraryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onDownload: (files: File[], songName: string, coverUrl: string | null) => void;
}

export function LibraryModal({ isOpen, onClose, onDownload }: LibraryModalProps) {
    const {
        songs,
        searchQuery,
        setSearchQuery,
        isLoadingList,
        downloadingSongId,
        downloadProgress,
        downloadSong,
        refreshSongs
    } = useCloudLibrary();

    const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set());

    if (!isOpen) return null;

    const handleDownload = async (songId: string, songName: string) => {
        const result = await downloadSong(songId);
        if (result && result.files.length > 0) {
            onDownload(result.files, songName, result.coverUrl);
            setDownloadedIds(prev => new Set(prev).add(songId));
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6">
            <div className="bg-[#1c1c1e] w-full max-w-3xl h-full max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-white/10 animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        <Cloud size={20} className="text-secondary" />
                        <h2 className="text-white font-bold text-base sm:text-lg">Biblioteca na Nuvem</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={refreshSongs} className="p-2 text-text-muted hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
                            <RefreshCcw size={16} />
                        </button>
                        <button onClick={onClose} className="p-2 text-text-muted hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="px-4 py-3 border-b border-white/5 shrink-0">
                    <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                        <input
                            type="text"
                            placeholder="Buscar por nome, artista ou tom..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-black/40 text-white text-sm pl-10 pr-4 py-2.5 rounded-xl border border-white/10 outline-none focus:border-secondary/50 transition-colors placeholder:text-text-muted/50"
                        />
                        {searchQuery && (
                            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-white cursor-pointer">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Song List */}
                <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                    {isLoadingList ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
                            <Loader2 size={28} className="animate-spin text-secondary" />
                            <span className="text-sm">Carregando biblioteca...</span>
                        </div>
                    ) : songs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
                            <Cloud size={48} className="opacity-20" />
                            <span className="text-sm">
                                {searchQuery ? 'Nenhuma música encontrada.' : 'Biblioteca vazia. Configure o Supabase e adicione músicas.'}
                            </span>
                        </div>
                    ) : (
                        <div className="grid gap-2 sm:gap-3">
                            {songs.map(song => {
                                const isDownloading = downloadingSongId === song.id;
                                const isDownloaded = downloadedIds.has(song.id);

                                return (
                                    <div key={song.id}
                                        className={`flex items-center gap-3 sm:gap-4 p-3 rounded-xl border transition-all ${isDownloaded
                                                ? 'bg-primary/5 border-primary/20'
                                                : 'bg-black/20 border-white/5 hover:border-white/15 hover:bg-white/5'
                                            }`}>

                                        {/* Cover */}
                                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-black/40 flex-shrink-0 overflow-hidden border border-white/5 flex items-center justify-center">
                                            {song.cover_url ? (
                                                <img src={song.cover_url} className="w-full h-full object-cover" alt={song.name} loading="lazy" />
                                            ) : (
                                                <Music size={20} className="opacity-20" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="font-semibold text-sm sm:text-base text-white truncate">{song.name}</div>
                                            <div className="text-xs text-text-muted truncate">{song.artist || 'Artista desconhecido'}</div>
                                            <div className="flex items-center gap-3 mt-1">
                                                {song.key && (
                                                    <span className="text-[10px] sm:text-xs font-bold bg-secondary/15 text-secondary px-2 py-0.5 rounded-full">
                                                        Tom: {song.key}
                                                    </span>
                                                )}
                                                {song.bpm > 0 && (
                                                    <span className="text-[10px] sm:text-xs font-bold bg-primary/15 text-primary px-2 py-0.5 rounded-full">
                                                        {song.bpm} BPM
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Download Button */}
                                        <div className="flex-shrink-0">
                                            {isDownloading ? (
                                                <div className="flex flex-col items-center gap-1 min-w-[80px]">
                                                    <Loader2 size={20} className="animate-spin text-secondary" />
                                                    <span className="text-[9px] sm:text-[10px] text-secondary font-medium text-center leading-tight max-w-[100px]">{downloadProgress}</span>
                                                </div>
                                            ) : isDownloaded ? (
                                                <div className="flex items-center gap-1.5 text-primary text-xs font-medium px-3 py-2 rounded-lg bg-primary/10">
                                                    <span>✓</span> Adicionada
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => handleDownload(song.id, song.name)}
                                                    disabled={!!downloadingSongId}
                                                    className="flex items-center gap-1.5 bg-secondary/15 hover:bg-secondary/25 text-secondary px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]">
                                                    <Download size={16} />
                                                    <span className="hidden sm:inline">Baixar</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-white/5 text-center shrink-0">
                    <span className="text-[10px] sm:text-xs text-text-muted/50">
                        {songs.length} música{songs.length !== 1 ? 's' : ''} na biblioteca
                    </span>
                </div>
            </div>
        </div>
    );
}
