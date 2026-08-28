import { parseFrontmatter } from './frontmatter'
import { canonicalFrontmatterKey } from './systemMetadata'

export const NOTE_DISPLAY_FRONTMATTER_KEY = '_display'
export const LEGACY_NOTE_FORMAT_FRONTMATTER_KEY = '_format'
export const NOTE_DISPLAY_TEXT = 'text'
export const NOTE_DISPLAY_SHEET = 'sheet'
export const NOTE_DISPLAY_OUTLINE = 'outline'

export const NOTE_FORMAT_FRONTMATTER_KEY = NOTE_DISPLAY_FRONTMATTER_KEY
export const NOTE_FORMAT_TEXT = NOTE_DISPLAY_TEXT
export const NOTE_FORMAT_SHEET = NOTE_DISPLAY_SHEET
export const NOTE_FORMAT_OUTLINE = NOTE_DISPLAY_OUTLINE

export type NoteFormat = typeof NOTE_DISPLAY_TEXT | typeof NOTE_DISPLAY_SHEET | typeof NOTE_DISPLAY_OUTLINE

export function normalizeNoteFormat(value: unknown): NoteFormat {
  if (typeof value !== 'string') return NOTE_DISPLAY_TEXT
  const normalized = value.trim().toLowerCase()
  if (normalized === NOTE_DISPLAY_SHEET) return NOTE_DISPLAY_SHEET
  if (normalized === NOTE_DISPLAY_OUTLINE) return NOTE_DISPLAY_OUTLINE
  return NOTE_DISPLAY_TEXT
}

export function noteFormatFromFrontmatter(frontmatter: Record<string, unknown>): NoteFormat {
  let legacyValue: unknown
  for (const [key, value] of Object.entries(frontmatter)) {
    const canonicalKey = canonicalFrontmatterKey(key)
    if (canonicalKey === NOTE_DISPLAY_FRONTMATTER_KEY) {
      return normalizeNoteFormat(value)
    }
    if (canonicalKey === LEGACY_NOTE_FORMAT_FRONTMATTER_KEY) legacyValue = value
  }
  return legacyValue === undefined ? NOTE_DISPLAY_TEXT : normalizeNoteFormat(legacyValue)
}

export function noteFormatFromContent(content: string | null | undefined): NoteFormat {
  return noteFormatFromFrontmatter(parseFrontmatter(content ?? null))
}

export function contentHasDisplayMetadata(content: string | null | undefined): boolean {
  const frontmatter = parseFrontmatter(content ?? null)
  return Object.keys(frontmatter).some((key) => {
    const canonicalKey = canonicalFrontmatterKey(key)
    return canonicalKey === NOTE_DISPLAY_FRONTMATTER_KEY || canonicalKey === LEGACY_NOTE_FORMAT_FRONTMATTER_KEY
  })
}

export function contentHasSheetFormat(content: string | null | undefined): boolean {
  return noteFormatFromContent(content) === NOTE_FORMAT_SHEET
}

export function noteDisplaysAsSheet(input: {
  content?: string | null
  display?: unknown
  fileKind?: string | null
}): boolean {
  return noteDisplayMode(input) === NOTE_DISPLAY_SHEET
}

export function noteDisplaysAsOutline(input: {
  content?: string | null
  display?: unknown
  fileKind?: string | null
}): boolean {
  return noteDisplayMode(input) === NOTE_DISPLAY_OUTLINE
}

function noteDisplayMode(input: {
  content?: string | null
  display?: unknown
  fileKind?: string | null
}): NoteFormat | null {
  if (input.fileKind === 'binary') return null
  if (contentHasDisplayMetadata(input.content)) return noteFormatFromContent(input.content)
  return normalizeNoteFormat(input.display)
}
