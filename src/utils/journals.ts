import type { VaultEntry } from '../types'

export const JOURNAL_TYPE = 'Journal'
export const JOURNALS_FOLDER = 'journals'
export type JournalOpenSource = 'sidebar' | 'previous' | 'next' | 'today' | 'task_query'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

export function journalDateKey(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
}

export function journalRelativePath(date: Date): string {
  return `${JOURNALS_FOLDER}/${journalDateKey(date)}.md`
}

export function isJournalEntry(entry: VaultEntry): boolean {
  return entry.isA === JOURNAL_TYPE && !entry.archived
}

export function journalDateFromEntry(entry: VaultEntry): Date | null {
  if (!isJournalEntry(entry)) return null
  const stem = entry.filename.replace(/\.md$/i, '')
  const match = ISO_DATE_PATTERN.exec(stem)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  return journalDateKey(date) === stem ? date : null
}

export function findJournalEntry(
  entries: readonly VaultEntry[],
  date: Date,
  workspacePath?: string | null,
): VaultEntry | undefined {
  const key = journalDateKey(date)
  return entries.find((entry) => {
    if (workspacePath) {
      const belongsToWorkspace = entry.workspace?.path === workspacePath
        || entry.path.startsWith(`${workspacePath.replace(/[\\/]$/u, '')}/`)
      if (!belongsToWorkspace) return false
    }
    return isJournalEntry(entry) && entry.filename.replace(/\.md$/i, '') === key
  })
}

export function shiftJournalDate(date: Date, dayDelta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayDelta)
}

export function sortJournalsNewestFirst(entries: readonly VaultEntry[]): VaultEntry[] {
  return [...entries].sort((left, right) => {
    const leftKey = journalDateFromEntry(left)?.getTime() ?? 0
    const rightKey = journalDateFromEntry(right)?.getTime() ?? 0
    return rightKey - leftKey
  })
}
