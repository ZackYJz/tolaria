import type { VaultEntry } from '../types'
import { journalDateFromEntry, journalDateKey } from './journals'

export const JOURNAL_TASK_STATUSES = ['TODO', 'DOING', 'DONE'] as const
export type JournalTaskStatus = (typeof JOURNAL_TASK_STATUSES)[number]

export interface JournalTask {
  id: string
  lineNumber: number
  sourceDate: string
  sourceLine: string
  sourcePath: string
  status: JournalTaskStatus
  statusEnd: number
  statusStart: number
  text: string
}

interface JournalContent {
  entry: VaultEntry
  content: string
}

const TASK_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+)(TODO|DOING|DONE)\b(?:[ \t]+(.*))?$/u
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/u

function fenceDelimiter(line: string): string | null {
  return FENCE_PATTERN.exec(line)?.[1] ?? null
}

function matchingFence(line: string, openFence: string): boolean {
  const candidate = fenceDelimiter(line)
  return candidate !== null
    && candidate[0] === openFence[0]
    && candidate.length >= openFence.length
}

function journalSourceDate(entry: VaultEntry): string {
  const date = journalDateFromEntry(entry)
  return date ? journalDateKey(date) : entry.title
}

export function parseJournalTasks(entry: VaultEntry, content: string): JournalTask[] {
  const tasks: JournalTask[] = []
  const lines = content.split(/\r?\n/u)
  const sourceDate = journalSourceDate(entry)
  let lineStart = 0
  let openFence: string | null = null

  lines.forEach((line, index) => {
    const lineBreakStart = lineStart + line.length
    const lineEndingLength = content.startsWith('\r\n', lineBreakStart)
      ? 2
      : Number(content.startsWith('\n', lineBreakStart))
    const nextLineStart = lineBreakStart + lineEndingLength
    const delimiter = fenceDelimiter(line)
    if (openFence) {
      if (matchingFence(line, openFence)) openFence = null
      lineStart = nextLineStart
      return
    }
    if (delimiter) {
      openFence = delimiter
      lineStart = nextLineStart
      return
    }

    const match = TASK_LINE_PATTERN.exec(line)
    if (match) {
      const prefix = match[1]
      const status = match[2] as JournalTaskStatus
      const lineNumber = index + 1
      tasks.push({
        id: `${entry.path}:${lineNumber}:${line}`,
        lineNumber,
        sourceDate,
        sourceLine: line,
        sourcePath: entry.path,
        status,
        statusStart: lineStart + prefix.length,
        statusEnd: lineStart + prefix.length + status.length,
        text: match[3]?.trimEnd() ?? '',
      })
    }
    lineStart = nextLineStart
  })

  return tasks
}

export function collectDoingJournalTasks(journals: readonly JournalContent[]): JournalTask[] {
  return journals
    .flatMap(({ entry, content }) => parseJournalTasks(entry, content))
    .filter((task) => task.status === 'DOING')
    .sort((left, right) => (
      right.sourceDate.localeCompare(left.sourceDate)
      || left.lineNumber - right.lineNumber
      || left.sourcePath.localeCompare(right.sourcePath)
    ))
}

export function updateJournalTaskStatus(
  content: string,
  task: JournalTask,
  status: JournalTaskStatus,
): string {
  const currentLineStart = content.lastIndexOf('\n', Math.max(0, task.statusStart - 1)) + 1
  const currentLineEndCandidate = content.indexOf('\n', task.statusEnd)
  const currentLineEnd = currentLineEndCandidate === -1 ? content.length : currentLineEndCandidate
  if (content.slice(currentLineStart, currentLineEnd).replace(/\r$/u, '') !== task.sourceLine) {
    throw new Error('Journal task changed at its source')
  }
  if (content.slice(task.statusStart, task.statusEnd) !== task.status) {
    throw new Error('Journal task changed at its source')
  }

  return `${content.slice(0, task.statusStart)}${status}${content.slice(task.statusEnd)}`
}

export function nextJournalTaskStatus(status: JournalTaskStatus | null): JournalTaskStatus {
  if (status === null || status === 'DONE') return 'TODO'
  return status === 'TODO' ? 'DOING' : 'DONE'
}
