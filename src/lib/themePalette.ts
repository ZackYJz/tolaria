export const THEME_PALETTES = ['default', 'notion', 'wolai', 'flowus', 'yuque'] as const
export type ThemePalette = typeof THEME_PALETTES[number]
export const THEME_PALETTE_STORAGE_KEY = 'tolaria:theme-palette'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>
type ThemeDocument = Pick<Document, 'documentElement'>

export function normalizeThemePalette(value: unknown): ThemePalette {
  return THEME_PALETTES.find(palette => palette === value) ?? 'default'
}

export function readStoredThemePalette(storage: ThemeStorage): ThemePalette {
  try {
    return normalizeThemePalette(storage.getItem(THEME_PALETTE_STORAGE_KEY))
  } catch {
    return 'default'
  }
}

export function writeStoredThemePalette(storage: ThemeStorage, palette: ThemePalette): void {
  try {
    storage.setItem(THEME_PALETTE_STORAGE_KEY, palette)
  } catch {
    // This startup mirror is optional; persisted app settings remain authoritative.
  }
}

export function applyThemePaletteToDocument(documentObject: ThemeDocument, palette: ThemePalette): void {
  documentObject.documentElement.setAttribute('data-theme-palette', palette)
}

export function applyStoredThemePalette(documentObject: ThemeDocument, storage: ThemeStorage): ThemePalette {
  const palette = readStoredThemePalette(storage)
  applyThemePaletteToDocument(documentObject, palette)
  return palette
}
