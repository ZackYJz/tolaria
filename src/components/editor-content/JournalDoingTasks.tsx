import { useEffect, useMemo, useState } from 'react'
import { CircleNotch } from '@phosphor-icons/react'
import { invoke } from '@tauri-apps/api/core'
import { translate, type AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import { isTauri, mockInvoke } from '../../mock-tauri'
import type { VaultEntry } from '../../types'
import { notePathsMatch } from '../../utils/notePathIdentity'
import {
  collectDoingJournalTasks,
  type JournalTask,
  type JournalTaskStatus,
} from '../../utils/journalTasks'
import { isJournalEntry, sortJournalsNewestFirst } from '../../utils/journals'
import { vaultPathForEntry } from '../../utils/workspaces'
import { Button } from '../ui/button'
import './JournalDoingTasks.css'

interface OpenTab {
  entry: VaultEntry
  content: string
}

export interface JournalDoingTasksProps {
  activeEntry: VaultEntry
  entries: readonly VaultEntry[]
  locale?: AppLocale
  openTabs: readonly OpenTab[]
  vaultPath: string
  onOpenDate: (date: Date) => void
  onUpdateStatus: (task: JournalTask, status: JournalTaskStatus) => Promise<void>
}

const CONTENT_BATCH_SIZE = 8

function journalsInActiveWorkspace(
  entries: readonly VaultEntry[],
  activeEntry: VaultEntry,
  fallbackVaultPath: string,
): VaultEntry[] {
  const workspacePath = vaultPathForEntry(activeEntry, fallbackVaultPath)
  return sortJournalsNewestFirst(entries.filter((entry) => (
    isJournalEntry(entry)
    && vaultPathForEntry(entry, fallbackVaultPath) === workspacePath
  )))
}

function openTabContent(openTabs: readonly OpenTab[], path: string): string | null {
  return openTabs.find((tab) => notePathsMatch(tab.entry.path, path))?.content ?? null
}

function getJournalContent(entry: VaultEntry, fallbackVaultPath: string): Promise<string> {
  const args = {
    path: entry.path,
    vaultPath: vaultPathForEntry(entry, fallbackVaultPath),
  }
  return isTauri()
    ? invoke<string>('get_note_content', args)
    : mockInvoke<string>('get_note_content', args)
}

async function loadJournalContents(
  entries: readonly VaultEntry[],
  fallbackVaultPath: string,
): Promise<Array<{ entry: VaultEntry; content: string }>> {
  const contents: Array<{ entry: VaultEntry; content: string }> = []
  for (let offset = 0; offset < entries.length; offset += CONTENT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + CONTENT_BATCH_SIZE)
    const loaded = await Promise.all(batch.map(async (entry) => ({
      entry,
      content: await getJournalContent(entry, fallbackVaultPath),
    })))
    contents.push(...loaded)
  }
  return contents
}

function localDateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function JournalDoingTasks({
  activeEntry,
  entries,
  locale = 'en',
  openTabs,
  vaultPath,
  onOpenDate,
  onUpdateStatus,
}: JournalDoingTasksProps) {
  const journals = useMemo(
    () => journalsInActiveWorkspace(entries, activeEntry, vaultPath),
    [activeEntry, entries, vaultPath],
  )
  const latestJournal = journals[0]
  const isLatestJournal = !!latestJournal && notePathsMatch(latestJournal.path, activeEntry.path)
  const [journalContents, setJournalContents] = useState<Array<{ entry: VaultEntry; content: string }> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>([])

  useEffect(() => {
    if (!isLatestJournal) {
      setJournalContents(null)
      setLoadError(false)
      return
    }

    const lifecycle = new AbortController()
    setJournalContents(null)
    setLoadError(false)
    void loadJournalContents(journals, vaultPath)
      .then((contents) => {
        if (!lifecycle.signal.aborted) setJournalContents(contents)
      })
      .catch((error) => {
        if (lifecycle.signal.aborted) return
        console.error('Failed to load journal tasks:', error)
        setLoadError(true)
      })
    return () => lifecycle.abort()
  }, [isLatestJournal, journals, vaultPath])

  const tasks = useMemo(() => {
    if (!journalContents) return []
    const currentContents = journalContents.map(({ entry, content }) => ({
      entry,
      content: openTabContent(openTabs, entry.path) ?? content,
    }))
    return collectDoingJournalTasks(currentContents)
  }, [journalContents, openTabs])
  const visibleTasks = tasks.filter((task) => !completedTaskIds.includes(task.id))

  useEffect(() => {
    setCompletedTaskIds((current) => {
      const activeIds = new Set(tasks.map((task) => task.id))
      const retained = current.filter((id) => activeIds.has(id))
      return retained.length === current.length ? current : retained
    })
  }, [completedTaskIds, tasks])

  if (!isLatestJournal || (!loadError && visibleTasks.length === 0)) return null

  const completeTask = async (task: JournalTask) => {
    setPendingTaskId(task.id)
    try {
      await onUpdateStatus(task, 'DONE')
      setCompletedTaskIds((current) => [...current, task.id])
      trackEvent('journal_task_status_changed', { source: 'doing_query', status: 'done' })
    } catch {
      // The persistence owner reports the localized error; keep the task visible for retry.
    } finally {
      setPendingTaskId(null)
    }
  }

  return (
    <section className="journal-doing-tasks" aria-label="DOING">
      <div className="journal-doing-tasks__header">
        <span className="journal-doing-tasks__status-dot" aria-hidden="true" />
        <h2>DOING</h2>
        {!loadError ? <span className="journal-doing-tasks__count">{visibleTasks.length}</span> : null}
      </div>
      {loadError ? (
        <p className="journal-doing-tasks__error">{translate(locale, 'status.sync.error')}</p>
      ) : (
        <div className="journal-doing-tasks__list">
          {visibleTasks.map((task) => {
            const pending = pendingTaskId === task.id
            return (
              <div
                className="journal-doing-tasks__item"
                data-testid={`journal-doing-task-${task.sourceDate}-${task.lineNumber}`}
                key={task.id}
              >
                <Button
                  aria-label={`${task.text}: ${translate(locale, 'customize.done')}`}
                  className="journal-doing-tasks__marker"
                  disabled={pending}
                  onClick={() => { void completeTask(task) }}
                  size="xs"
                  variant="outline"
                >
                  {pending ? <CircleNotch className="animate-spin" aria-hidden="true" /> : null}
                  DOING
                </Button>
                <Button
                  aria-label={`${task.text} · ${task.sourceDate}`}
                  className="journal-doing-tasks__text"
                  onClick={() => onOpenDate(localDateFromKey(task.sourceDate))}
                  variant="ghost"
                >
                  {task.text}
                </Button>
                <span className="journal-doing-tasks__date">{task.sourceDate}</span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
