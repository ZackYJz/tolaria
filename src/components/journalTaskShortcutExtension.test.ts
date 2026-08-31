import { describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../lib/telemetry'
import {
  createJournalTaskShortcutExtension,
  isJournalTaskEditorMode,
  setCurrentJournalTaskStatus,
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

function createFixture(
  text: string,
  journalMode = true,
  blockSelected = false,
  blockType = 'bulletListItem',
) {
  let clickListener: EventListener | null = null
  let keydownListener: EventListener | null = null
  const block = {
    id: 'task-block',
    type: blockType,
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
        if (type === 'click') clickListener = listener
      }),
      toggleAttribute: vi.fn(),
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
    click(target: Element) {
      if (!clickListener) throw new Error('Journal task controls did not mount')
      const event = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        target,
      } as unknown as MouseEvent
      clickListener(event)
      return event
    },
  }
}

describe('createJournalTaskShortcutExtension', () => {
  it('sets an explicit task status while converting the current block to a checklist item', () => {
    const block = {
      id: 'task-block',
      type: 'paragraph',
      content: [{ type: 'text' as const, text: 'Plan release', styles: { bold: true } }],
    }
    const editor = {
      getBlock: vi.fn(() => block),
      getTextCursorPosition: vi.fn(() => ({ block })),
      setTextCursorPosition: vi.fn(),
      updateBlock: vi.fn(),
    }

    setCurrentJournalTaskStatus(editor, 'DOING')

    expect(editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [
        { type: 'text', text: 'DOING ', styles: {} },
        { type: 'text', text: 'Plan release', styles: { bold: true } },
      ],
      props: { checked: false },
      type: 'checkListItem',
    })
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith('task-block', 'end')
  })

  it('exposes whether task commands should be available for an editor', () => {
    const editor = {}

    expect(isJournalTaskEditorMode(editor)).toBe(false)
    setJournalTaskEditorMode(editor, true)
    expect(isJournalTaskEditorMode(editor)).toBe(true)
    setJournalTaskEditorMode(editor, false)
    expect(isJournalTaskEditorMode(editor)).toBe(false)
  })

  it('adds TODO and cycles existing task statuses inside journals', () => {
    const plain = createFixture('Plan release')
    plain.fire()
    expect(plain.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'TODO Plan release', styles: {} }],
      props: { checked: false },
      type: 'checkListItem',
    })

    const todo = createFixture('TODO Plan release')
    todo.fire()
    expect(todo.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DOING Plan release', styles: {} }],
      props: { checked: false },
      type: 'checkListItem',
    })

    const doing = createFixture('DOING Plan release')
    doing.fire()
    expect(doing.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DONE Plan release', styles: {} }],
      props: { checked: true },
      type: 'checkListItem',
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

  it('cycles the persistent status control and completes through the checkbox', () => {
    const statusFixture = createFixture('TODO Plan release', true, false, 'checkListItem')
    const status = document.createElement('span')
    status.dataset.journalTaskBlockId = 'task-block'
    status.dataset.journalTaskStatus = 'TODO'
    statusFixture.click(status)
    expect(statusFixture.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DOING Plan release', styles: {} }],
      props: { checked: false },
      type: 'checkListItem',
    })

    const checkboxFixture = createFixture('DOING Plan release', true, false, 'checkListItem')
    const block = document.createElement('div')
    block.className = 'bn-block'
    block.dataset.id = 'task-block'
    const content = document.createElement('div')
    content.dataset.contentType = 'checkListItem'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    content.appendChild(checkbox)
    block.appendChild(content)
    checkboxFixture.click(checkbox)
    expect(checkboxFixture.editor.updateBlock).toHaveBeenCalledWith('task-block', {
      content: [{ type: 'text', text: 'DONE Plan release', styles: {} }],
      props: { checked: true },
      type: 'checkListItem',
    })
  })
})
