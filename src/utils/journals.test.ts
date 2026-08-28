import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  findJournalEntry,
  journalDateFromEntry,
  journalDateKey,
  journalRelativePath,
  shiftJournalDate,
  sortJournalsNewestFirst,
} from './journals'

const entry = (date: string, overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: `/vault/journals/${date}.md`,
  filename: `${date}.md`,
  title: date,
  isA: 'Journal',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: null,
  createdAt: null,
  fileSize: 0,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: true,
  ...overrides,
})

describe('journals', () => {
  it('uses local calendar dates for stable journal paths', () => {
    const date = new Date(2026, 7, 28, 23, 45)

    expect(journalDateKey(date)).toBe('2026-08-28')
    expect(journalRelativePath(date)).toBe('journals/2026-08-28.md')
  })

  it('parses only valid ISO-dated Journal entries', () => {
    expect(journalDateFromEntry(entry('2026-02-28'))).toEqual(new Date(2026, 1, 28))
    expect(journalDateFromEntry(entry('2026-02-30'))).toBeNull()
    expect(journalDateFromEntry(entry('2026-02-28', { isA: 'Note' }))).toBeNull()
  })

  it('finds a journal by date and optional workspace', () => {
    const personal = entry('2026-08-28', { workspace: { path: '/personal', label: 'Personal' } })
    const work = entry('2026-08-28', { path: '/work/journals/2026-08-28.md', workspace: { path: '/work', label: 'Work' } })

    expect(findJournalEntry([personal, work], new Date(2026, 7, 28), '/work')).toBe(work)
    expect(findJournalEntry([personal], new Date(2026, 7, 28))).toBe(personal)
  })

  it('moves across month boundaries without UTC drift', () => {
    expect(journalDateKey(shiftJournalDate(new Date(2026, 7, 31), 1))).toBe('2026-09-01')
    expect(journalDateKey(shiftJournalDate(new Date(2026, 8, 1), -1))).toBe('2026-08-31')
  })

  it('sorts journals by calendar date newest first', () => {
    expect(sortJournalsNewestFirst([
      entry('2026-08-27'),
      entry('2026-08-29'),
      entry('2026-08-28'),
    ]).map((item) => item.title)).toEqual(['2026-08-29', '2026-08-28', '2026-08-27'])
  })
})
