import { useState, useRef } from 'react';
import { X, Upload, Music, Image as ImageIcon, Loader2, AlertCircle, CheckCircle2, ChevronRight, Hash, Activity, Layers, Disc, Repeat } from 'lucide-react';
import { useAdminUpload, type UploadMetadata } from '../hooks/useAdminUpload';
import { supabase } from '../lib/supabase';

interface AdminModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const REQUIRED_NOTES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function AdminModal({ isOpen, onClose }: AdminModalProps) {
    const { isUploading, progress, status, error, uploadProject, uploadSystemPads, resetState } = useAdminUpload();

    const [activeTab, setActiveTab] = useState<'music' | 'pads' | 'samples' | 'loops'>('music');

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
    const [padSetName, setPadSetName] = useState('');
    const [padSetDescription, setPadSetDescription] = useState('');

    const [isSuccess, setIsSuccess] = useState(false);

    const coverInputRef = useRef<HTMLInputElement>(null);
    const stemsInputRef = useRef<HTMLInputElement>(null);
    const padsInputRef = useRef<HTMLInputElement>(null);

    // Samples/Loops State
    const [sampleFiles, setSampleFiles] = useState<File[]>([]);
    const [sampleName, setSampleName] = useState('');
    const [sampleCategory, setSampleCategory] = useState('');

    if (!isOpen) return null;

    const handleHandleUpload = async (e: React.FormEvent) => {
        e.preventDefault();

        if (activeTab === 'music') {
            if (!metadata.name || stemFiles.length === 0) return;
            const success = await uploadProject(metadata, coverFile, stemFiles);
            if (success) setIsSuccess(true);
        } else if (activeTab === 'pads') {
            if (padFiles.size !== 12) return;
            const success = await uploadSystemPads(padFiles, padSetName, padSetDescription);
            if (success) setIsSuccess(true);
        } else {
            // Samples or Loops
            if (sampleFiles.length === 0 || !sampleName.trim()) return;
            const bucket = activeTab; // 'samples' or 'loops'
            setIsUploading(true);
            setProgress(0);
            setStatus(`Iniciando upload para ${bucket}...`);
            setError(null);
            try {
                for (let i = 0; i < sampleFiles.length; i++) {
                    const file = sampleFiles[i];
                    const filePath = `${sampleName.trim().toLowerCase().replace(/\s+/g, '_')}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
                    setStatus(`Subindo ${i + 1} de ${sampleFiles.length}: ${file.name}`);
                    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file, { contentType: file.type || 'audio/mpeg' });
                    if (uploadError) throw new Error(`Erro: ${uploadError.message}`);
                    setProgress(Math.floor(((i + 1) / sampleFiles.length) * 100));
                }
                setIsSuccess(true);
            } catch (e: any) {
                setError(e.message || 'Erro no upload');
            } finally {
                setIsUploading(false);
            }
            return;
        }
    };

    const handleClose = () => {
        if (isUploading) return;
        setIsSuccess(false);
        setMetadata({ name: '', artist: '', key: '', bpm: 0 });
        setCoverFile(null);
        setStemFiles([]);
        setPadFiles(new Map());
        setPadSetName('');
        setPadSetDescription('');
        setSampleFiles([]);
        setSampleName('');
        setSampleCategory('');
        resetState();
        onClose();
    };

    const handlePadsSelection = (files: FileList | null) => {
        if (!files) return;

        const newMap = new Map<string, File>();

        Array.from(files).forEach(file => {
            let upperName = file.name.replace(/\.[^/.]+$/, "").toUpperCase();
            
            // Normalize sharp to flat
            upperName = upperName.replace(/C#/g, "DB")
                                 .replace(/D#/g, "EB")
                                 .replace(/F#/g, "GB")
                                 .replace(/G#/g, "AB")
                                 .replace(/A#/g, "BB");

            // Match isolated notes. Order matters for regex OR (|) so place 2-char notes first
            const noteRegex = /(^|[^A-Z])(DB|EB|GB|AB|BB|C|D|E|F|G|A|B)([^A-Z]|$)/;
            const match = upperName.match(noteRegex);

            if (match && match[2]) {
                const matchedNote = REQUIRED_NOTES.find(n => n.toUpperCase() === match[2]);
                if (matchedNote) {
                    newMap.set(matchedNote, file);
                }
            } else {
                // Fallback: If stripping all spaces/symbols matches perfectly
                let rawNormalized = upperName.replace(/[-_]/g, "").replace(/\s+/g, "");
                const matchedNote = REQUIRED_NOTES.find(n => n.toUpperCase() === rawNormalized);
                if (matchedNote) {
                    newMap.set(matchedNote, file);
                }
            }
        });
        
        setPadFiles(newMap);
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
            <div className="daw-panel w-full max-w-2xl rounded-lg flex flex-col my-auto">

                {/* Header */}
                <div className="flex items-center justify-between p-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-secondary/10 rounded-md border border-secondary/15">
                            <Upload size={16} className="text-secondary" />
                        </div>
                        <div>
                            <h2 className="text-white font-black text-sm uppercase tracking-wider">Admin: Armazenamento em Nuvem</h2>
                            <p className="text-[9px] text-text-muted font-mono">Gerenciar biblioteca online global</p>
                        </div>
                    </div>
                    <button onClick={handleClose} disabled={isUploading} className="p-1.5 text-text-muted hover:text-white hover:bg-white/5 rounded-md transition-all active:scale-90 cursor-pointer disabled:opacity-20">
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                {!isSuccess && !isUploading && (
                    <div className="flex px-3 pt-3 border-b border-border gap-3">
                        <button onClick={() => setActiveTab('music')}
                            className={`pb-2.5 text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 uppercase tracking-wider font-mono ${activeTab === 'music' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted hover:text-white'}`}>
                            <Music size={14} /> STEMS
                        </button>
                        <button onClick={() => setActiveTab('pads')}
                            className={`pb-2.5 text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 uppercase tracking-wider font-mono ${activeTab === 'pads' ? 'text-secondary border-b-2 border-secondary' : 'text-text-muted hover:text-white'}`}>
                            <Layers size={14} /> PADS DO SISTEMA
                        </button>
                        <button onClick={() => setActiveTab('samples')}
                            className={`pb-2.5 text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 uppercase tracking-wider font-mono ${activeTab === 'samples' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-text-muted hover:text-white'}`}>
                            <Disc size={14} /> SAMPLES
                        </button>
                        <button onClick={() => setActiveTab('loops')}
                            className={`pb-2.5 text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 uppercase tracking-wider font-mono ${activeTab === 'loops' ? 'text-cyan-400 border-b-2 border-cyan-400' : 'text-text-muted hover:text-white'}`}>
                            <Repeat size={14} /> LOOPS
                        </button>
                    </div>
                )}

                {isSuccess ? (
                    <div className="p-8 flex flex-col items-center justify-center text-center gap-3">
                        <div className="w-16 h-16 bg-primary/10 rounded-lg border border-primary/20 flex items-center justify-center mb-2">
                            <CheckCircle2 size={36} className="text-primary" />
                        </div>
                        <h3 className="text-lg font-black text-white uppercase tracking-wider">Upload Concluído</h3>
                        <p className="text-text-muted text-[10px] font-mono max-w-xs">Arquivos armazenados com sucesso na nuvem.</p>
                        <button onClick={handleClose} className="mt-4 px-6 py-2.5 bg-primary text-black font-black rounded-md uppercase tracking-wider text-xs active:scale-95 transition-all cursor-pointer">
                            Fechar Painel
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleHandleUpload} className="p-4 space-y-5 bg-[#0e0e10]">

                        {activeTab === 'music' ? (
                            <>
                                {/* Music Metadata Grid */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Nome da Música *</label>
                                        <div className="relative">
                                            <Music size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="text"
                                                required
                                                value={metadata.name}
                                                onChange={e => setMetadata({ ...metadata, name: e.target.value })}
                                                placeholder="e.g. Great is the Lord"
                                                className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-md font-mono"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Artista</label>
                                        <input
                                            type="text"
                                            value={metadata.artist}
                                            onChange={e => setMetadata({ ...metadata, artist: e.target.value })}
                                            placeholder="e.g. Hillsong"
                                            className="w-full daw-input text-white text-xs px-3 py-2.5 rounded-md font-mono"
                                        />
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Tom Musical</label>
                                        <div className="relative">
                                            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="text"
                                                value={metadata.key}
                                                onChange={e => setMetadata({ ...metadata, key: e.target.value })}
                                                placeholder="e.g. G, Dbm, F#"
                                                className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-md font-mono"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">BPM</label>
                                        <div className="relative">
                                            <Activity size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                            <input
                                                type="number"
                                                value={metadata.bpm || ''}
                                                onChange={e => setMetadata({ ...metadata, bpm: parseInt(e.target.value) || 0 })}
                                                placeholder="e.g. 72"
                                                className="w-full daw-input text-white text-xs pl-9 pr-3 py-2.5 rounded-md font-mono"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Music File Pickers */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div
                                        onClick={() => coverInputRef.current?.click()}
                                        className={`relative h-28 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] overflow-hidden ${coverFile ? 'border-primary/40 bg-primary/5' : 'border-border bg-black/20 hover:border-white/15 hover:bg-white/3'
                                            }`}>
                                        {coverFile ? (
                                            <>
                                                <img src={URL.createObjectURL(coverFile)} className="absolute inset-0 w-full h-full object-cover opacity-20" alt="" />
                                                <CheckCircle2 size={20} className="text-primary z-10" />
                                                <span className="text-[10px] text-white font-bold z-10 uppercase tracking-wider">Capa Selecionada</span>
                                                <span className="text-[9px] text-text-muted z-10 truncate max-w-[130px] font-mono">{coverFile.name}</span>
                                            </>
                                        ) : (
                                            <>
                                                <ImageIcon size={20} className="text-text-muted" />
                                                <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Enviar Capa</span>
                                                <span className="text-[9px] text-text-muted/30 font-mono">JPG / PNG</span>
                                            </>
                                        )}
                                        <input type="file" ref={coverInputRef} accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                                    </div>

                                    <div
                                        onClick={() => stemsInputRef.current?.click()}
                                        className={`h-28 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] ${stemFiles.length > 0 ? 'border-secondary/40 bg-secondary/5' : 'border-border bg-black/20 hover:border-white/15 hover:bg-white/3'
                                            }`}>
                                        {stemFiles.length > 0 ? (
                                            <>
                                                <Music size={20} className="text-secondary" />
                                                <span className="text-[10px] text-white font-bold uppercase tracking-wider">{stemFiles.length} Stems Selecionados</span>
                                                <div className="flex gap-1 h-1 w-16 bg-white/5 rounded-full overflow-hidden">
                                                    <div className="h-full bg-secondary w-full"></div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <Music size={20} className="text-text-muted" />
                                                <span className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Enviar Áudio *</span>
                                                <span className="text-[9px] text-text-muted/30 font-mono">Selecionar todos os stems</span>
                                            </>
                                        )}
                                        <input type="file" ref={stemsInputRef} multiple accept="audio/*" className="hidden" onChange={e => setStemFiles(Array.from(e.target.files || []))} />
                                    </div>
                                </div>
                            </>
                        ) : activeTab === 'pads' ? (
                            // Pads Upload View
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Nome do Banco de Pads *</label>
                                        <input
                                            type="text"
                                            required={activeTab === 'pads'}
                                            value={padSetName}
                                            onChange={e => setPadSetName(e.target.value)}
                                            placeholder="ex: Pads Worship Vol. 1"
                                            className="w-full daw-input text-white text-xs px-3 py-2.5 rounded-md font-mono"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Descrição</label>
                                        <input
                                            type="text"
                                            value={padSetDescription}
                                            onChange={e => setPadSetDescription(e.target.value)}
                                            placeholder="ex: Pads atmosféricos, 440Hz"
                                            className="w-full daw-input text-white text-xs px-3 py-2.5 rounded-md font-mono"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-text-muted font-mono">Envie 12 arquivos de áudio, um por nota. O nome do arquivo <strong className="text-white">DEVE</strong> ser o nome da nota (ex: <code className="lcd-display px-1 rounded text-primary">C.mp3</code>, <code className="lcd-display px-1 rounded text-primary">Db.wav</code>).</p>

                                <div
                                    onClick={() => padsInputRef.current?.click()}
                                    className={`h-28 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] ${padFiles.size === 12 ? 'border-primary/40 bg-primary/5' : 'border-border bg-black/20 hover:border-white/15 hover:bg-white/3'
                                        }`}>
                                    <Layers size={20} className={padFiles.size === 12 ? 'text-primary' : 'text-text-muted'} />
                                    <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                                        {padFiles.size === 12 ? '12 PADS PRONTOS' : `${padFiles.size}/12 PADS DETECTADOS`}
                                    </span>
                                    {padFiles.size > 0 && padFiles.size !== 12 && (
                                        <span className="text-[9px] text-yellow-500 font-bold font-mono">Necessário exatamente 12 arquivos válidos!</span>
                                    )}
                                    <input type="file" ref={padsInputRef} multiple accept="audio/*" className="hidden" onChange={e => handlePadsSelection(e.target.files)} />
                                </div>

                                {padFiles.size > 0 && (
                                    <div className="lcd-display rounded-md p-3 border border-border">
                                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                                            {REQUIRED_NOTES.map(note => (
                                                <div key={note} className={`text-center py-1.5 rounded-md border text-[10px] font-bold font-mono ${padFiles.has(note) ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-white/3 border-border text-text-muted/20'}`}>
                                                    {note}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (activeTab === 'samples' || activeTab === 'loops') ? (
                            // Samples / Loops Upload View
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Nome da Coleção *</label>
                                        <input
                                            type="text"
                                            required
                                            value={sampleName}
                                            onChange={e => setSampleName(e.target.value)}
                                            placeholder={activeTab === 'samples' ? 'ex: Worship Hits Vol. 1' : 'ex: Gospel Grooves 80bpm'}
                                            className="w-full daw-input text-white text-xs px-3 py-2.5 rounded-md font-mono"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] uppercase font-bold text-text-muted tracking-wider ml-1 font-mono">Categoria</label>
                                        <input
                                            type="text"
                                            value={sampleCategory}
                                            onChange={e => setSampleCategory(e.target.value)}
                                            placeholder={activeTab === 'samples' ? 'ex: Piano, Strings, FX' : 'ex: Drum, Bass, Ambient'}
                                            className="w-full daw-input text-white text-xs px-3 py-2.5 rounded-md font-mono"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-text-muted font-mono">
                                    Envie arquivos de áudio <strong className="text-white">WAV ou MP3</strong> para o bucket <code className={`lcd-display px-1 rounded ${activeTab === 'samples' ? 'text-purple-400' : 'text-cyan-400'}`}>{activeTab}</code> do Supabase.
                                </p>

                                <div
                                    onClick={() => document.getElementById(`${activeTab}-file-input`)?.click()}
                                    className={`h-28 rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-[0.98] ${
                                        sampleFiles.length > 0
                                            ? activeTab === 'samples' ? 'border-purple-500/40 bg-purple-500/5' : 'border-cyan-500/40 bg-cyan-500/5'
                                            : 'border-border bg-black/20 hover:border-white/15 hover:bg-white/3'
                                    }`}>
                                    {activeTab === 'samples' ? <Disc size={20} className={sampleFiles.length > 0 ? 'text-purple-400' : 'text-text-muted'} /> : <Repeat size={20} className={sampleFiles.length > 0 ? 'text-cyan-400' : 'text-text-muted'} />}
                                    <span className="text-[10px] text-white font-bold uppercase tracking-wider">
                                        {sampleFiles.length > 0 ? `${sampleFiles.length} ARQUIVO(S) SELECIONADO(S)` : `SELECIONAR ${activeTab.toUpperCase()}`}
                                    </span>
                                    {sampleFiles.length > 0 && (
                                        <span className="text-[9px] text-text-muted font-mono">
                                            {(sampleFiles.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)).toFixed(1)} MB total
                                        </span>
                                    )}
                                    <input id={`${activeTab}-file-input`} type="file" multiple accept="audio/*" className="hidden" onChange={e => setSampleFiles(Array.from(e.target.files || []))} />
                                </div>

                                {sampleFiles.length > 0 && (
                                    <div className="lcd-display rounded-md p-3 border border-border max-h-32 overflow-y-auto">
                                        <div className="space-y-1">
                                            {sampleFiles.map((f, i) => (
                                                <div key={i} className="flex items-center justify-between text-[9px] font-mono">
                                                    <span className={activeTab === 'samples' ? 'text-purple-300' : 'text-cyan-300'}>{f.name}</span>
                                                    <span className="text-text-muted">{(f.size / 1024).toFixed(0)} KB</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div className="p-2.5 bg-accent-red/5 border border-accent-red/15 rounded-md flex items-center gap-2 text-accent-red text-[10px] font-mono">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Progress Bar */}
                        {isUploading && (
                            <div className="space-y-2 p-3 lcd-display rounded-md">
                                <div className="flex items-center justify-between text-[10px] font-bold font-mono uppercase tracking-wider">
                                    <span className="text-secondary flex items-center gap-1.5">
                                        <Loader2 size={12} className="animate-spin" />
                                        {status}
                                    </span>
                                    <span className="text-primary">{progress}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-secondary transition-all duration-300 ease-out"
                                        style={{ width: `${progress}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isUploading || (activeTab === 'music' ? (!metadata.name || stemFiles.length === 0) : activeTab === 'pads' ? (padFiles.size !== 12) : (sampleFiles.length === 0 || !sampleName.trim()))}
                            className={`w-full py-3 rounded-md font-black flex items-center justify-center gap-2 transition-all active:scale-[0.98] uppercase tracking-wider text-xs ${(isUploading || (activeTab === 'music' ? (!metadata.name || stemFiles.length === 0) : activeTab === 'pads' ? (padFiles.size !== 12) : (sampleFiles.length === 0 || !sampleName.trim())))
                                ? 'bg-white/5 text-text-muted cursor-not-allowed'
                                : activeTab === 'samples' ? 'bg-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.15)] cursor-pointer' : activeTab === 'loops' ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.15)] cursor-pointer' : 'bg-secondary text-black shadow-[0_0_15px_rgba(6,182,212,0.15)] cursor-pointer'
                                }`}>
                            {isUploading ? (
                                <>PROCESSANDO...</>
                            ) : (
                                <>
                                    PUBLICAR NA NUVEM
                                    <ChevronRight size={16} />
                                </>
                            )}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
