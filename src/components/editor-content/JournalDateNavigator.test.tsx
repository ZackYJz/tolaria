import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../../types'
import { JournalDateNavigator } from './JournalDateNavigator'

const journalEntry = {
  path: '/vault/journals/2026-08-28.md',
  filename: '2026-08-28.md',
  title: '2026-08-28',
  isA: 'Journal',
  archived: false,
} as VaultEntry

describe('JournalDateNavigator', () => {
  it('opens previous, today, and next journal dates', () => {
    const onOpenDate = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 30, 12))

    render(<JournalDateNavigator entry={journalEntry} onOpenDate={onOpenDate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))

    expect(onOpenDate.mock.calls.map(([date, source]) => [
      date.getFullYear(),
      date.getMonth() + 1,
      date.getDate(),
      source,
    ])).toEqual([
      [2026, 8, 27, 'previous'],
      [2026, 8, 30, 'today'],
      [2026, 8, 29, 'next'],
    ])
    vi.useRealTimers()
  })

  it('does not render for a regular note', () => {
    const { container } = render(
      <JournalDateNavigator entry={{ ...journalEntry, isA: 'Note' }} onOpenDate={() => {}} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
