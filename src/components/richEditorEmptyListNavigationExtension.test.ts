import { describe, expect, it, vi } from 'vitest'
import { createRichEditorEmptyListNavigationExtension } from './richEditorEmptyListNavigationExtension'

type KeyListener = (event: KeyboardEvent) => void
type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'Backspace'

function keyboardEvent(key: NavigationKey, options: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key,
    keyCode: key === 'ArrowDown' ? 40 : key === 'ArrowUp' ? 38 : 8,
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function createFixture({
  atVisualEdge = true,
  editable = true,
  nextContent = [],
  nextType = 'bulletListItem',
  previousContent = [],
  previousType = 'bulletListItem',
  selectionEmpty = true,
} = {}) {
  let keydownListener: KeyListener | null = null
  const nextBlock = { content: nextContent, id: 'next', type: nextType }
  const prevBlock = { content: previousContent, id: 'previous', type: previousType }
  const view = {
    composing: false,
    endOfTextblock: vi.fn(() => atVisualEdge),
    state: { selection: { empty: selectionEmpty } },
  }
  const editor = {
    _tiptapEditor: { view },
    getTextCursorPosition: vi.fn(() => ({
      block: { content: [{ text: 'Current', type: 'text' }], id: 'current', type: 'paragraph' },
      nextBlock,
      prevBlock,
    })),
    isEditable: editable,
    prosemirrorView: view,
    setTextCursorPosition: vi.fn(),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: KeyListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createRichEditorEmptyListNavigationExtension()({ editor: editor as never })
  extension.mount?.({
    dom: dom as never,
    root: document,
    signal: new AbortController().signal,
  })

  return {
    editor,
    fire(key: NavigationKey, options: Partial<KeyboardEvent> = {}) {
      if (!keydownListener) throw new Error('Empty-list navigation listener was not registered')
      const event = keyboardEvent(key, options)
      keydownListener(event)
      return event
    },
    nextBlock,
    prevBlock,
    view,
  }
}

describe('createRichEditorEmptyListNavigationExtension', () => {
  it('moves through an adjacent empty list item at the visual block edge', () => {
    const down = createFixture()
    const downEvent = down.fire('ArrowDown')
    expect(down.view.endOfTextblock).toHaveBeenCalledWith('down')
    expect(down.editor.setTextCursorPosition).toHaveBeenCalledWith(down.nextBlock, 'start')
    expect(downEvent.preventDefault).toHaveBeenCalled()
    expect(downEvent.stopImmediatePropagation).toHaveBeenCalled()

    const up = createFixture()
    const upEvent = up.fire('ArrowUp')
    expect(up.view.endOfTextblock).toHaveBeenCalledWith('up')
    expect(up.editor.setTextCursorPosition).toHaveBeenCalledWith(up.prevBlock, 'end')
    expect(upEvent.preventDefault).toHaveBeenCalled()
  })

  it('leaves wrapped lines, non-empty neighbors, and ranges alone', () => {
    expect(createFixture({ atVisualEdge: false }).fire('ArrowDown').preventDefault).not.toHaveBeenCalled()
    expect(createFixture({ nextContent: [{ text: 'Next', type: 'text' }] })
      .fire('ArrowDown').preventDefault).not.toHaveBeenCalled()
    expect(createFixture({ selectionEmpty: false }).fire('ArrowDown').preventDefault).not.toHaveBeenCalled()
  })

  it('ignores modified, composing, and read-only arrow keys', () => {
    expect(createFixture().fire('ArrowDown', { shiftKey: true }).preventDefault).not.toHaveBeenCalled()
    expect(createFixture().fire('ArrowDown', { isComposing: true }).preventDefault).not.toHaveBeenCalled()
    expect(createFixture({ editable: false }).fire('ArrowDown').preventDefault).not.toHaveBeenCalled()
  })

  it('promotes linked children when deleting an empty paragraph nested under a list', () => {
    let keydownListener: KeyListener | null = null
    const linkedChild = {
      children: [],
      content: [{
        content: [{ styles: {}, text: 'Tolaria', type: 'text' }],
        href: 'https://tolaria.app',
        type: 'link',
      }],
      id: 'linked-child',
      type: 'bulletListItem',
    }
    const emptyParagraph = {
      children: [linkedChild],
      content: [],
      id: 'empty-parent',
      type: 'paragraph',
    }
    const listParent = {
      children: [emptyParagraph],
      content: [{ styles: {}, text: 'Parent', type: 'text' }],
      id: 'list-parent',
      type: 'bulletListItem',
    }
    const view = {
      composing: false,
      endOfTextblock: vi.fn(() => true),
      state: { selection: { empty: true } },
    }
    const editor = {
      _tiptapEditor: { view },
      document: [listParent],
      getTextCursorPosition: vi.fn(() => ({ block: emptyParagraph })),
      isEditable: true,
      prosemirrorView: view,
      replaceBlocks: vi.fn(),
      setTextCursorPosition: vi.fn(),
    }
    const extension = createRichEditorEmptyListNavigationExtension()({ editor: editor as never })
    extension.mount?.({
      dom: {
        addEventListener: vi.fn((type: string, listener: KeyListener) => {
          if (type === 'keydown') keydownListener = listener
        }),
      } as never,
      root: document,
      signal: new AbortController().signal,
    })

    const event = keyboardEvent('Backspace')
    if (!keydownListener) throw new Error('Empty-list navigation listener was not registered')
    keydownListener(event)

    expect(editor.replaceBlocks).toHaveBeenCalledWith([emptyParagraph], [linkedChild])
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith(linkedChild, 'start')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
  })
})
