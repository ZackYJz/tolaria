import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  collectDoingJournalTasks,
  nextJournalTaskStatus,
  parseJournalTasks,
  updateJournalTaskStatus,
} from './journalTasks'

function journalEntry(date: string): VaultEntry {
  return {
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
  }
}

describe('journal tasks', () => {
  it('parses Logseq-style task markers from Markdown list blocks only', () => {
    const entry = journalEntry('2026-08-29')
    const content = `---
type: Journal
---

# 2026-08-29

- TODO Plan launch
  - DOING Ship parser
1. DONE Verify release

\`\`\`md
- DOING This is an example
\`\`\`

Paragraph DOING is not a task.
`

    expect(parseJournalTasks(entry, content)).toEqual([
      expect.objectContaining({ lineNumber: 7, status: 'TODO', text: 'Plan launch' }),
      expect.objectContaining({ lineNumber: 8, status: 'DOING', text: 'Ship parser' }),
      expect.objectContaining({ lineNumber: 9, status: 'DONE', text: 'Verify release' }),
    ])
  })

  it('collects every DOING task without moving it from its source journal', () => {
    const older = journalEntry('2026-08-27')
    const latest = journalEntry('2026-08-29')

    const tasks = collectDoingJournalTasks([
      { entry: older, content: '# 2026-08-27\n\n- DOING Long-running work\n- TODO Backlog\n' },
      { entry: latest, content: '# 2026-08-29\n\n- DOING Today work\n' },
    ])

    expect(tasks.map(({ sourcePath, status, text }) => ({ sourcePath, status, text }))).toEqual([
      { sourcePath: latest.path, status: 'DOING', text: 'Today work' },
      { sourcePath: older.path, status: 'DOING', text: 'Long-running work' },
    ])
  })

  it('updates only the exact source task and rejects a stale projection', () => {
    const entry = journalEntry('2026-08-28')
    const content = '# 2026-08-28\n\n- DOING First task\n- DOING Second task\n'
    const [firstTask] = parseJournalTasks(entry, content)

    expect(updateJournalTaskStatus(content, firstTask, 'DONE')).toBe(
      '# 2026-08-28\n\n- DONE First task\n- DOING Second task\n',
    )
    expect(() => updateJournalTaskStatus(content.replace('First', 'Changed'), firstTask, 'DONE'))
      .toThrow('Journal task changed at its source')
  })

  it('preserves CRLF line endings when updating a source task', () => {
    const entry = journalEntry('2026-08-28')
    const content = '# 2026-08-28\r\n\r\n- DOING Windows task\r\n'
    const [task] = parseJournalTasks(entry, content)

    expect(updateJournalTaskStatus(content, task, 'DONE')).toBe(
      '# 2026-08-28\r\n\r\n- DONE Windows task\r\n',
    )
  })

  it('cycles task markers through TODO, DOING, and DONE', () => {
    expect(nextJournalTaskStatus(null)).toBe('TODO')
    expect(nextJournalTaskStatus('TODO')).toBe('DOING')
    expect(nextJournalTaskStatus('DOING')).toBe('DONE')
    expect(nextJournalTaskStatus('DONE')).toBe('TODO')
  })
})
