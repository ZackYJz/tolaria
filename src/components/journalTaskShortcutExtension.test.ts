import { describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../lib/telemetry'
import {
  createJournalTaskShortcutExtension,
  setJournalTaskEditorMode,
} from './journalTaskShortcutExtension'
import { richEditorBlockSelectionPluginKey } from './richEditorBlockSelectionExtension'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))
vi.mock('../utils/platform', () => ({ isMac: () => true }))

function shortcutEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: 'Enter',
    keyCode: 13,
    metaKey: true,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent
}

function createFixture(text: string, journalMode = true, blockSelected = false) {
  let keydownListener: EventListener | null = null
  const block = {
    id: 'task-block',
    type: 'bulletListItem',
    content: [{ type: 'text', text, styles: {} }],
  }
  const selectionState = {
    [richEditorBlockSelectionPluginKey.key]: blockSelected ? { blockIds: ['task-block'] } : null,
  }
  const editor = {
    _tiptapEditor: { view: { composing: false, state: selectionState } },
    getBlock: vi.fn(() => block),
    getTextCursorPosition: vi.fn(() => ({ block })),
    isEditable: true,
    updateBlock: vi.fn(),
  }
  setJournalTaskEditorMode(editor, journalMode)
  const extension = createJournalTaskShortcutExtension()({ editor: editor as never })
  extension.mount?.({
    dom: {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        if (type === 'keydown') keydownListener = listener
      }),
    } as never,
    root: document,
    signal: new AbortController().signal,
  })

  return {
    editor,
    fire(event = shortcutEvent()) {
      if (!keydownListener) throw new Error('Journal task shortcut did not mount')
      keydownListener(event)
      return event
    },
  }
}

describe('createJournalTaskShortcutExtension', () => {
  it('adds TODO and cycles existing task statuses inside journals', () => {
    const plain = createFixture('Plan release')
    plain.fire()
    expect(plain.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'TODO Plan release', styles: {} }],
    })

    const todo = createFixture('TODO Plan release')
    todo.fire()
    expect(todo.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DOING Plan release', styles: {} }],
    })

    const doing = createFixture('DOING Plan release')
    doing.fire()
    expect(doing.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DONE Plan release', styles: {} }],
    })
    expect(trackEvent).toHaveBeenCalledWith('journal_task_status_changed', {
      source: 'keyboard_shortcut',
      status: 'done',
    })
  })

  it('does not handle the shortcut outside journals or during composition', () => {
    const ordinaryNote = createFixture('Plan release', false)
    ordinaryNote.fire()
    expect(ordinaryNote.editor.updateBlock).not.toHaveBeenCalled()

    const composing = createFixture('Plan release')
    composing.fire(shortcutEvent({ isComposing: true }))
    expect(composing.editor.updateBlock).not.toHaveBeenCalled()

    const selectedBlock = createFixture('Plan release', true, true)
    selectedBlock.fire()
    expect(selectedBlock.editor.updateBlock).not.toHaveBeenCalled()
  })
})
