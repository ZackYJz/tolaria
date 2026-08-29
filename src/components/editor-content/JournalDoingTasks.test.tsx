import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { JournalDoingTasks } from './JournalDoingTasks'

vi.mock('../../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

import { mockInvoke } from '../../mock-tauri'

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

describe('JournalDoingTasks', () => {
  it('shows all DOING tasks only below the latest journal and completes them at the source', async () => {
    const older = journalEntry('2026-08-28')
    const latest = journalEntry('2026-08-29')
    const entries = [older, latest]
    const onOpenDate = vi.fn()
    const onUpdateStatus = vi.fn().mockResolvedValue(undefined)
    vi.mocked(mockInvoke).mockImplementation(async (_command, args) => {
      const path = (args as { path: string }).path
      return (path === older.path
        ? '# 2026-08-28\n\n- DOING Long-running work\n- TODO Later work\n'
        : '# 2026-08-29\n\n- DOING Today work\n') as never
    })

    const { rerender } = render(
      <JournalDoingTasks
        activeEntry={latest}
        entries={entries}
        openTabs={[]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )

    expect(await screen.findByRole('region', { name: 'DOING' })).toBeVisible()
    expect(screen.getByText('Long-running work')).toBeVisible()
    expect(screen.getByText('Today work')).toBeVisible()
    expect(screen.queryByText('Later work')).not.toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledTimes(2)

    rerender(
      <JournalDoingTasks
        activeEntry={latest}
        entries={entries}
        openTabs={[{ entry: latest, content: '# 2026-08-29\n\n- DONE Today work\n' }]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )
    expect(screen.queryByText('Today work')).not.toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledTimes(2)

    rerender(
      <JournalDoingTasks
        activeEntry={latest}
        entries={entries}
        openTabs={[]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )

    const olderTask = screen.getByTestId('journal-doing-task-2026-08-28-3')
    fireEvent.click(within(olderTask).getByRole('button', { name: 'Long-running work: Done' }))

    await waitFor(() => expect(onUpdateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: older.path, status: 'DOING', text: 'Long-running work' }),
      'DONE',
    ))
    await waitFor(() => expect(screen.queryByText('Long-running work')).not.toBeInTheDocument())

    rerender(
      <JournalDoingTasks
        activeEntry={latest}
        entries={entries}
        openTabs={[{ entry: older, content: '# 2026-08-28\n\n- DONE Long-running work\n' }]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )
    await waitFor(() => expect(screen.queryByText('Long-running work')).not.toBeInTheDocument())

    rerender(
      <JournalDoingTasks
        activeEntry={latest}
        entries={entries}
        openTabs={[]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )
    expect(await screen.findByText('Long-running work')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Today work · 2026-08-29' }))
    expect(onOpenDate).toHaveBeenCalledWith(new Date(2026, 7, 29))

    rerender(
      <JournalDoingTasks
        activeEntry={older}
        entries={entries}
        openTabs={[]}
        vaultPath="/vault"
        onOpenDate={onOpenDate}
        onUpdateStatus={onUpdateStatus}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'DOING' })).not.toBeInTheDocument()
    })
  })
})
