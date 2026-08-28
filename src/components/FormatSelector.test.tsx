import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormatSelector } from './FormatSelector'
import {
  LEGACY_NOTE_FORMAT_FRONTMATTER_KEY,
  NOTE_FORMAT_FRONTMATTER_KEY,
  NOTE_FORMAT_OUTLINE,
  NOTE_FORMAT_SHEET,
  NOTE_FORMAT_TEXT,
} from '../utils/noteFormat'

function renderFormatSelector(overrides: Partial<ComponentProps<typeof FormatSelector>> = {}) {
  const onDeleteProperty = vi.fn()
  const onUpdateProperty = vi.fn()

  render(
    <FormatSelector
      format={NOTE_FORMAT_TEXT}
      onDeleteProperty={onDeleteProperty}
      onUpdateProperty={onUpdateProperty}
      {...overrides}
    />,
  )

  return { onDeleteProperty, onUpdateProperty }
}

function openFormatCombobox() {
  fireEvent.click(screen.getByRole('combobox', { name: 'Display as' }))
}

describe('FormatSelector', () => {
  it('updates the note display mode when the user selects Sheet', async () => {
    const { onDeleteProperty, onUpdateProperty } = renderFormatSelector()

    openFormatCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'Sheet' }))

    expect(onUpdateProperty).toHaveBeenCalledWith(NOTE_FORMAT_FRONTMATTER_KEY, NOTE_FORMAT_SHEET)
    await waitFor(() => {
      expect(onDeleteProperty).toHaveBeenCalledWith(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
    })
  })

  it('updates the note display mode when the user selects Outline', async () => {
    const { onDeleteProperty, onUpdateProperty } = renderFormatSelector()

    openFormatCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'Outline' }))

    expect(onUpdateProperty).toHaveBeenCalledWith(NOTE_FORMAT_FRONTMATTER_KEY, NOTE_FORMAT_OUTLINE)
    await waitFor(() => {
      expect(onDeleteProperty).toHaveBeenCalledWith(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
    })
  })

  it('waits for the display update before deleting the legacy format key', async () => {
    let finishUpdate: (() => void) | undefined
    const onUpdateProperty = vi.fn(() => new Promise<void>((resolve) => {
      finishUpdate = resolve
    }))
    const onDeleteProperty = vi.fn()
    renderFormatSelector({ onDeleteProperty, onUpdateProperty })

    openFormatCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'Outline' }))

    expect(onUpdateProperty).toHaveBeenCalledWith(NOTE_FORMAT_FRONTMATTER_KEY, NOTE_FORMAT_OUTLINE)
    expect(onDeleteProperty).not.toHaveBeenCalled()

    finishUpdate?.()
    await waitFor(() => {
      expect(onDeleteProperty).toHaveBeenCalledWith(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
    })
  })

  it('keeps the display mode dropdown open after clicking the trigger', () => {
    renderFormatSelector({ format: NOTE_FORMAT_SHEET })

    fireEvent.click(screen.getByRole('combobox', { name: 'Display as' }))

    expect(screen.getByRole('option', { name: 'Sheet' })).toBeInTheDocument()
  })

  it('removes the explicit display mode when the user selects Text', async () => {
    const { onDeleteProperty, onUpdateProperty } = renderFormatSelector({ format: NOTE_FORMAT_SHEET })

    openFormatCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'Text' }))

    expect(onDeleteProperty).toHaveBeenCalledWith(NOTE_FORMAT_FRONTMATTER_KEY)
    await waitFor(() => {
      expect(onDeleteProperty).toHaveBeenCalledWith(LEGACY_NOTE_FORMAT_FRONTMATTER_KEY)
    })
    expect(onUpdateProperty).not.toHaveBeenCalled()
  })

  it('selects the highlighted display mode from the keyboard', () => {
    const { onUpdateProperty } = renderFormatSelector()
    const trigger = screen.getByRole('combobox', { name: 'Display as' })

    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })

    expect(onUpdateProperty).toHaveBeenCalledWith(NOTE_FORMAT_FRONTMATTER_KEY, NOTE_FORMAT_OUTLINE)
  })
})
