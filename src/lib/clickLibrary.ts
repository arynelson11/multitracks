export type ClickTrackType = 'Blip' | 'Classic' | 'Cowbell' | 'Gentle' | 'Percussive' | 'Saw' | 'Woodblock';
export type ClickSubdivision = 'accents' | 'quarter' | 'eighth' | 'sixteenth';

export interface ClickLibrarySelection {
  type: ClickTrackType;
  subdivision: ClickSubdivision;
}

export const CLICK_TYPES: { id: ClickTrackType; label: string }[] = [
  { id: 'Classic',    label: 'Classic'    },
  { id: 'Blip',       label: 'Blip'       },
  { id: 'Woodblock',  label: 'Woodblock'  },
  { id: 'Cowbell',    label: 'Cowbell'    },
  { id: 'Percussive', label: 'Percussive' },
  { id: 'Gentle',     label: 'Gentle'     },
  { id: 'Saw',        label: 'Saw'        },
];

export const CLICK_SUBDIVISIONS: { id: ClickSubdivision; label: string; subBeats: number }[] = [
  { id: 'accents',   label: 'Acentos',    subBeats: 1 },
  { id: 'quarter',   label: '1/4',        subBeats: 1 },
  { id: 'eighth',    label: '1/8',        subBeats: 2 },
  { id: 'sixteenth', label: '1/16',       subBeats: 4 },
];

const STORAGE_KEY = 'clickLibrarySelection';

export const DEFAULT_CLICK: ClickLibrarySelection = { type: 'Classic', subdivision: 'quarter' };

export function loadClickSelection(): ClickLibrarySelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ClickLibrarySelection;
  } catch { /* ignore */ }
  return DEFAULT_CLICK;
}

export function saveClickSelection(sel: ClickLibrarySelection): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
}

export function getClickSampleUrl(type: ClickTrackType, subdivision: ClickSubdivision): string {
  const filename = `New Click -  ${type}-${subdivision}.wav`;
  // BASE_URL = '/' na web, './' no desktop (file://). Caminho absoluto quebra no Electron.
  return `${import.meta.env.BASE_URL}Click Tracks/${encodeURIComponent(filename)}`;
}
