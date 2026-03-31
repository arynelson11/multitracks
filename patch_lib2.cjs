const fs = require('fs');
const content = fs.readFileSync('src/components/LibraryModal.tsx', 'utf8');

// Strip \r to make it uniform
let lines = content.replace(/\r/g, '').split('\n');

// 1. Inject isEditing block
const returnIndex = lines.findIndex((l, i) => l.includes('return (') && lines[i-1] && lines[i-1].includes('isDownloaded'));

if (returnIndex !== -1) {
    const editForm = `                                const isEditing = editingSong.id === song.id;

                                if (isEditing) {
                                    return (
                                        <div key={song.id} className="flex flex-col gap-3 p-4 rounded-xl border border-secondary/30 bg-black/40">
                                            <div className="flex justify-between items-center mb-2">
                                                <h3 className="font-bold text-white">Editando Música</h3>
                                                <button onClick={() => setEditingSong({})} className="text-gray-400 hover:text-white"><X size={16}/></button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase">Nome</label>
                                                    <input value={editingSong.name ?? song.name} onChange={e => setEditingSong({...editingSong, name: e.target.value})} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase">Artista</label>
                                                    <input value={editingSong.artist ?? song.artist || ''} onChange={e => setEditingSong({...editingSong, artist: e.target.value})} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase">BPM</label>
                                                    <input type="number" value={editingSong.bpm ?? song.bpm} onChange={e => setEditingSong({...editingSong, bpm: Number(e.target.value)})} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-gray-500 uppercase">Tom</label>
                                                    <input value={editingSong.key ?? song.key || ''} onChange={e => setEditingSong({...editingSong, key: e.target.value})} className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
                                                </div>
                                                <div className="col-span-2">
                                                    <label className="text-[10px] text-gray-500 uppercase">Nova Capa (Opcional)</label>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <label className="flex flex-1 items-center gap-2 bg-black/60 border border-white/10 px-3 py-2 rounded-lg cursor-pointer hover:border-white/30 text-sm text-gray-400">
                                                            <UploadCloud size={14} />
                                                            <span className="truncate">{editingSong.file ? editingSong.file.name : 'Escolher nova imagem...'}</span>
                                                            <input type="file" accept="image/*" className="hidden" onChange={e => setEditingSong({...editingSong, file: e.target.files?.[0]})} />
                                                        </label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex justify-end mt-2">
                                                <button onClick={() => handleEditSave(song)} disabled={isSavingEdit} className="bg-secondary text-black font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-secondary/80 disabled:opacity-50">
                                                    {isSavingEdit ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar
                                                </button>
                                            </div>
                                        </div>
                                    );
                                }`;
    lines.splice(returnIndex, 0, editForm);
}

// 2. Inject Edit button inside isAdmin block
const adminIndex = lines.findIndex(l => l.includes('{isAdmin && ('));

if (adminIndex !== -1) {
    const editBtn = `                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setEditingSong({ id: song.id })}
                                                        className="p-2 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center transition-all cursor-pointer bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white border border-blue-500/20 active:scale-95"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>`;
    
    // remove the '{isAdmin && (' line and the <button beneath it (but wait, it spans multiple lines. Let's just do a string replace on the joined code).
}

// The array approach is safer.
// Let's actually output a new joined string and run `.replace` carefully since we have no \r.
let newContent = lines.join('\n');

const btnTarget = `{isAdmin && (
                                                <button`;
const btnReplace = `{isAdmin && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setEditingSong({ id: song.id })}
                                                        className="p-2 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium flex items-center justify-center transition-all cursor-pointer bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white border border-blue-500/20 active:scale-95"
                                                    >
                                                        <Edit2 size={16} />
                                                    </button>
                                                    <button`;

const btnEndTarget = `                                                    )}
                                                </button>
                                            )}`;
const btnEndReplace = `                                                    )}
                                                </button>
                                                </div>
                                            )}`;

newContent = newContent.replace(btnTarget, btnReplace);
newContent = newContent.replace(btnEndTarget, btnEndReplace);

fs.writeFileSync('src/components/LibraryModal.tsx', newContent);
console.log('LibraryModal robust target fixed!');
