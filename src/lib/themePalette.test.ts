import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyStoredThemePalette,
  applyThemePaletteToDocument,
  normalizeThemePalette,
  readStoredThemePalette,
  THEME_PALETTES,
  THEME_PALETTE_STORAGE_KEY,
  writeStoredThemePalette,
} from './themePalette'

afterEach(() => {
  document.documentElement.removeAttribute('data-theme-palette')
  document.documentElement.removeAttribute('data-theme')
})

describe('theme palettes', () => {
  it('accepts supported presets and defaults invalid or missing settings', () => {
    for (const palette of THEME_PALETTES) expect(normalizeThemePalette(palette)).toBe(palette)
    for (const value of [null, undefined, '', 'forest', {}, 4]) {
      expect(normalizeThemePalette(value)).toBe('default')
    }
  })

  it('mirrors the selected palette for startup before settings load', () => {
    const values = new Map<string, string>()
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    writeStoredThemePalette(localStorage, 'wolai')
    expect(localStorage.getItem(THEME_PALETTE_STORAGE_KEY)).toBe('wolai')
    expect(readStoredThemePalette(localStorage)).toBe('wolai')
    expect(applyStoredThemePalette(document, localStorage)).toBe('wolai')
    expect(document.documentElement).toHaveAttribute('data-theme-palette', 'wolai')
  })

  it('changes the palette without changing light or dark mode', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    applyThemePaletteToDocument(document, 'yuque')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme-palette', 'yuque')
    applyThemePaletteToDocument(document, 'default')
    expect(document.documentElement).toHaveAttribute('data-theme-palette', 'default')
  })

  it('remains usable when browser storage is restricted', () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('storage unavailable') }),
      setItem: vi.fn(() => { throw new Error('storage unavailable') }),
    }
    expect(readStoredThemePalette(storage)).toBe('default')
    expect(() => writeStoredThemePalette(storage, 'notion')).not.toThrow()
  })
})

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('palette readability', () => {
  const paletteCss = readFileSync(join(process.cwd(), 'src/theme-palettes.css'), 'utf8')
  for (const palette of THEME_PALETTES.filter(value => value !== 'default')) {
    for (const mode of ['light', 'dark']) {
      it(`${palette} ${mode} keeps accent text and filled controls readable`, () => {
        const selector = mode === 'dark'
          ? `:root[data-theme='dark'][data-theme-palette='${palette}']`
          : `:root[data-theme-palette='${palette}']`
        const block = paletteCss.split(selector + ' {')[1]?.split('}')[0] ?? ''
        const accent = block.match(/--accent-blue: (#[0-9A-F]{6})/)?.[1]
        expect(accent).toBeDefined()
        if (!accent) return
        const surfaces = mode === 'dark' ? ['#1F1E1B', '#292823'] : ['#FFFFFF', '#F7F6F3']
        for (const surface of surfaces) expect(contrast(accent, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(accent, mode === 'dark' ? '#151411' : '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
