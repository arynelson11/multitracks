import { useState, useRef } from 'react';
import { X, Upload, Music, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, ChevronRight, Hash, Activity, Layers } from 'lucide-react';
import { useAdminUpload, type UploadMetadata } from '../hooks/useAdminUpload';

interface AdminModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const REQUIRED_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
    const { isUploading, progress, status, error, uploadProject, uploadSystemPads, resetState } = useAdminUpload();

    const [activeTab, setActiveTab] = useState<'music' | 'pads'>('music');

    const [metadata, setMetadata] = useState<UploadMetadata>({
        name: '',
        artist: '',
        key: '',
        bpm: 0
    });

    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [stemFiles, setStemFiles] = useState<File[]>([]);

    // Pads State
    const [padFiles, setPadFiles] = useState<Map<string, File>>(new Map());

    const [isSuccess, setIsSuccess] = useState(false);

    const coverInputRef = useRef<HTMLInputElement>(null);
    const stemsInputRef = useRef<HTMLInputElement>(null);
    const padsInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleHandleUpload = async (e: React.FormEvent) => {
        e.preventDefault();

        if (activeTab === 'music') {
            if (!metadata.name || stemFiles.length === 0) return;
            const success = await uploadProject(metadata, coverFile, stemFiles);
            if (success) setIsSuccess(true);
        } else {
            if (padFiles.size !== 12) return;
            const success = await uploadSystemPads(padFiles);
            if (success) setIsSuccess(true);
        }
    };

    const handleClose = () => {
        if (isUploading) return;
        setIsSuccess(false);
        setMetadata({ name: '', artist: '', key: '', bpm: 0 });
        setCoverFile(null);
        setStemFiles([]);
        setPadFiles(new Map());
        resetState();
        onClose();
    };

    const handlePadsSelection = (files: FileList | null) => {
        if (!files) return;

        const sharpToFlat: Record<string, string> = {
            'C#': 'Db',
            'D#': 'Eb',
            'F#': 'Gb',
            'G#': 'Ab',
            'A#': 'Bb'
        };

        const newMap = new Map<string, File>();
        Array.from(files).forEach(file => {
            // Remove extension
            let nameWithoutExt = file.name.replace(/\.[^/.]+$/, "").toUpperCase();

            // Normalize sharp to flat if needed
            if (sharpToFlat[nameWithoutExt]) {
                nameWithoutExt = sharpToFlat[nameWithoutExt].toUpperCase();
            }

            // Find exact match
            const matchedNote = REQUIRED_NOTES.find(n => n.toUpperCase() === nameWithoutExt);
            if (matchedNote) {
                newMap.set(matchedNote, file);
            }
        });
        setPadFiles(newMap);
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
            <div className="bg-[#1c1c1e] w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col border border-white/10 my-auto animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-secondary/20 rounded-lg">
                            <Upload size={20} className="text-secondary" />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-lg">Painel Admin: Cloud Storage</h2>
                            <p className="text-xs text-text-muted">Gerencie a biblioteca online global</p>
                        </div>
                    </div>
                    <button onClick={handleClose} disabled={isUploading} className="p-2 text-text-muted hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer disabled:opacity-20">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                {!isSuccess && !isUploading && (
                    <div className="flex px-4 pt-4 border-b border-white/5 gap-4">
                        <button onClick={() => setActiveTab('music')}
                            className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === 'music' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted hover:text-white'}`}>
                            <Music size={16} /> Músicas (Stems)
                        </button>
                        <button onClick={() => setActiveTab('pads')}
                            className={`pb-3 text-sm font-semibold transition-colors flex items-center gap-2 ${activeTab === 'pads' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted hover:text-white'}`}>
                            <Layers size={16} /> Pads do Sistema
                        </button>
                    </div>
                )}

                {isSuccess ? (
                    <div className="p-8 flex flex-col items-center justify-center text-center gap-4 animate-in fade-in slide-in-from-bottom-4">
                        <div className="w-20 h-20 bg-primary/20 rounded-full flex items-center justify-center mb-2">
                            <CheckCircle2 size={48} className="text-primary" />
                        </div>
                        <h3 className="text-xl font-bold text-white">Upload Concluído!</h3>
                        <p className="text-text-muted max-w-xs">Arquivos armazenados no Supabase Storage com sucesso.</p>
                        <button onClick={handleClose} className="mt-4 px-8 py-3 bg-primary text-black font-bold rounded-xl hover:scale-105 active:scale-95 transition-all cursor-pointer">
                            Fechar Painel
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleHandleUpload} className="p-4 sm:p-6 space-y-6">

                        {activeTab === 'music' ? (
                            <>
                                {/* Music Metadata Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] uppercase font-bold text-text-muted tracking-wider ml-1">Nome da Música *</label>
                                        <div className="relative">
                                            <Music size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="text"
                                                required
                                                value={metadata.name}
                                                onChange={e => setMetadata({ ...metadata, name: e.target.value })}
                                                placeholder="Ex: Grande é o Senhor"
                                                className="w-full bg-black/40 text-white text-sm pl-10 pr-4 py-3 rounded-xl border border-white/10 outline-none focus:border-secondary/50 transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] uppercase font-bold text-text-muted tracking-wider ml-1">Artista / Banda</label>
                                        <input
                                            type="text"
                                            value={metadata.artist}
                                            onChange={e => setMetadata({ ...metadata, artist: e.target.value })}
                                            placeholder="Ex: Adhemar de Campos"
                                            className="w-full bg-black/40 text-white text-sm px-4 py-3 rounded-xl border border-white/10 outline-none focus:border-secondary/50 transition-colors"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] uppercase font-bold text-text-muted tracking-wider ml-1">Tom Musical</label>
                                        <div className="relative">
                                            <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="text"
                                                value={metadata.key}
                                                onChange={e => setMetadata({ ...metadata, key: e.target.value })}
                                                placeholder="Ex: G, Dbm, F#"
                                                className="w-full bg-black/40 text-white text-sm pl-10 pr-4 py-3 rounded-xl border border-white/10 outline-none focus:border-secondary/50 transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] uppercase font-bold text-text-muted tracking-wider ml-1">BPM</label>
                                        <div className="relative">
                                            <Activity size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="number"
                                                value={metadata.bpm || ''}
                                                onChange={e => setMetadata({ ...metadata, bpm: parseInt(e.target.value) || 0 })}
                                                placeholder="Ex: 72"
                                                className="w-full bg-black/40 text-white text-sm pl-10 pr-4 py-3 rounded-xl border border-white/10 outline-none focus:border-secondary/50 transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Music File Pickers */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div
                                        onClick={() => coverInputRef.current?.click()}
                                        className={`relative h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all overflow-hidden ${coverFile ? 'border-primary/50 bg-primary/5' : 'border-white/10 bg-black/20 hover:border-white/20'
                                            }`}>
                                        {coverFile ? (
                                            <>
                                                <img src={URL.createObjectURL(coverFile)} className="absolute inset-0 w-full h-full object-cover opacity-30" alt="" />
                                                <CheckCircle2 size={24} className="text-primary z-10" />
                                                <span className="text-xs text-white font-medium z-10">Capa Selecionada</span>
                                                <span className="text-[10px] text-text-muted z-10 truncate max-w-[150px]">{coverFile.name}</span>
                                            </>
                                        ) : (
                                            <>
                                                <ImageIcon size={24} className="text-text-muted" />
                                                <span className="text-xs text-text-muted font-medium">Upload da Capa</span>
                                                <span className="text-[10px] text-text-muted/50">JPG ou PNG</span>
                                            </>
                                        )}
                                        <input type="file" ref={coverInputRef} accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                                    </div>

                                    <div
                                        onClick={() => stemsInputRef.current?.click()}
                                        className={`h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${stemFiles.length > 0 ? 'border-secondary/50 bg-secondary/5' : 'border-white/10 bg-black/20 hover:border-white/20'
                                            }`}>
                                        {stemFiles.length > 0 ? (
                                            <>
                                                <Music size={24} className="text-secondary" />
                                                <span className="text-xs text-white font-medium">{stemFiles.length} Stems selecionados</span>
                                                <div className="flex gap-1 h-1 w-20 bg-white/10 rounded-full overflow-hidden">
                                                    <div className="h-full bg-secondary w-full"></div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <Music size={24} className="text-text-muted" />
                                                <span className="text-xs text-text-muted font-medium">Upload dos Áudios *</span>
                                                <span className="text-[10px] text-text-muted/50">Selecione todos os stems</span>
                                            </>
                                        )}
                                        <input type="file" ref={stemsInputRef} multiple accept="audio/*" className="hidden" onChange={e => setStemFiles(Array.from(e.target.files || []))} />
                                    </div>
                                </div>
                            </>
                        ) : (
                            // Pads Upload View
                            <div className="space-y-4">
                                <p className="text-sm text-text-muted">Faça o upload de 12 arquivos de áudio, um para cada nota musical. O nome do arquivo <strong className="text-white">DEVE</strong> ser o nome da nota (Ex: <code className="bg-black/40 px-1 rounded">C.mp3</code>, <code className="bg-black/40 px-1 rounded">Db.wav</code>, etc).</p>

                                <div
                                    onClick={() => padsInputRef.current?.click()}
                                    className={`h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${padFiles.size === 12 ? 'border-primary/50 bg-primary/5' : 'border-white/10 bg-black/20 hover:border-white/20'
                                        }`}>
                                    <Layers size={24} className={padFiles.size === 12 ? 'text-primary' : 'text-text-muted'} />
                                    <span className="text-xs text-white font-medium">
                                        {padFiles.size === 12 ? '12 Pads Selecionados Prontos!' : `${padFiles.size}/12 Pads Detectados`}
                                    </span>
                                    {padFiles.size > 0 && padFiles.size !== 12 && (
                                        <span className="text-[10px] text-yellow-500 font-bold">Atenção: Você precisa de exatos 12 arquivos válidos!</span>
                                    )}
                                    <input type="file" ref={padsInputRef} multiple accept="audio/*" className="hidden" onChange={e => handlePadsSelection(e.target.files)} />
                                </div>

                                {padFiles.size > 0 && (
                                    <div className="bg-black/40 rounded-xl p-4 border border-white/5">
                                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                                            {REQUIRED_NOTES.map(note => (
                                                <div key={note} className={`text-center py-2 rounded-lg border text-xs font-bold ${padFiles.has(note) ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-white/5 border-white/5 text-text-muted/30'}`}>
                                                    {note}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-500 text-xs animate-in shake duration-300">
                                <AlertCircle size={16} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Progress Bar */}
                        {isUploading && (
                            <div className="space-y-3 p-4 bg-black/40 rounded-xl border border-white/5 animate-in slide-in-from-top-2">
                                <div className="flex items-center justify-between text-xs font-medium">
                                    <span className="text-secondary flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin" />
                                        {status}
                                    </span>
                                    <span className="text-white">{progress}%</span>
                                </div>
                                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-secondary transition-all duration-300 ease-out"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={isUploading || (activeTab === 'music' ? (!metadata.name || stemFiles.length === 0) : (padFiles.size !== 12))}
                            className={`w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${(isUploading || (activeTab === 'music' ? (!metadata.name || stemFiles.length === 0) : (padFiles.size !== 12)))
                                ? 'bg-white/5 text-text-muted cursor-not-allowed'
                                : 'bg-secondary text-black hover:shadow-[0_0_20px_rgba(5,209,255,0.3)] cursor-pointer'
                                }`}>
                            {isUploading ? (
                                <>Processando...</>
                            ) : (
                                <>
                                    Publicar na Nuvem
                                    <ChevronRight size={18} />
                                </>
                            )}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
