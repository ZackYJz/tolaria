import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../../hooks/appCommandDispatcher'
import { trackEvent } from '../../lib/telemetry'
import { NoteListHeader } from './NoteListHeader'

vi.mock('../../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

const baseProps = {
  title: 'Inbox',
  typeDocument: null,
  isEntityView: false,
  listSort: 'modified' as const,
  listDirection: 'desc' as const,
  customProperties: [],
  searchVisible: false,
  search: '',
  isSearching: false,
  searchInputRef: { current: null },
  onSortChange: vi.fn(),
  onCreateNote: vi.fn(),
  onOpenType: vi.fn(),
  onToggleSearch: vi.fn(),
  onSearchChange: vi.fn(),
  onSearchKeyDown: vi.fn(),
}

function renderHeader(overrides: Partial<Parameters<typeof NoteListHeader>[0]> = {}) {
  return render(<NoteListHeader {...baseProps} {...overrides} />)
}

describe('NoteListHeader expand sidebar button', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('keeps the expand-sidebar button hidden when the sidebar is open', () => {
    renderHeader({ sidebarCollapsed: false })

    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument()
  })

  it('dispatches the full-layout app command from the collapsed note-list header', () => {
    const commandListener = vi.fn()
    window.addEventListener(APP_COMMAND_EVENT_NAME, commandListener)

    try {
      renderHeader({ sidebarCollapsed: true })

      fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))

      expect(commandListener).toHaveBeenCalledTimes(1)
      expect((commandListener.mock.calls[0]?.[0] as CustomEvent<string>).detail).toBe(APP_COMMAND_IDS.viewAll)
      expect(trackEvent).toHaveBeenCalledWith('sidebar_expanded_from_note_list_header')
    } finally {
      window.removeEventListener(APP_COMMAND_EVENT_NAME, commandListener)
    }
  })

  it('offers document, outline, and sheet creation from the new-note menu', async () => {
    const onCreateNote = vi.fn()
    renderHeader({ onCreateNote })

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Create new note' }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Outline' }))

    expect(onCreateNote).toHaveBeenCalledWith({ creationPath: 'note_list_plus', format: 'outline' })
  })
})
