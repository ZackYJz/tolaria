import { describe, expect, it, vi } from 'vitest'
import {
  normalizeOutlineEditorDocument,
  outlineBlocksWithListItems,
  removeTrailingEmptyOutlineItem,
  setOutlineEditorMode,
} from './outlineEditorMode'

describe('outlineBlocksWithListItems', () => {
  it('converts every paragraph into a bullet item without changing semantic blocks', () => {
    const blocks = [
      { id: 'title', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Title' }], children: [] },
      { id: 'plain', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Plain' }], children: [] },
      {
        id: 'ordered',
        type: 'numberedListItem',
        props: {},
        content: [{ type: 'text', text: 'Ordered' }],
        children: [
          { id: 'nested-plain', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Nested' }], children: [] },
          { id: 'code', type: 'codeBlock', props: { language: 'typescript' }, content: [{ type: 'text', text: 'const x = 1' }], children: [] },
        ],
      },
    ]

    const result = outlineBlocksWithListItems(blocks)

    expect(result.changed).toBe(true)
    expect(result.blocks).toEqual([
      blocks[0],
      { ...blocks[1], type: 'bulletListItem' },
      {
        ...blocks[2],
        children: [
          { ...blocks[2].children[0], type: 'bulletListItem' },
          blocks[2].children[1],
        ],
      },
    ])
    expect(blocks[1].type).toBe('paragraph')
  })

  it('returns the original blocks when the outline already contains no paragraphs', () => {
    const blocks = [
      { id: 'title', type: 'heading', children: [] },
      { id: 'item', type: 'bulletListItem', children: [] },
    ]

    expect(outlineBlocksWithListItems(blocks)).toEqual({ blocks, changed: false })
  })
})

describe('removeTrailingEmptyOutlineItem', () => {
  it('removes the trailing empty bullet supplied by the initial outline scaffold', () => {
    const heading = { id: 'title', type: 'heading', content: [{ type: 'text', text: 'Title' }], children: [] }
    const emptyBullet = { id: 'empty', type: 'bulletListItem', content: [], children: [] }
    const editor = {
      document: [heading, emptyBullet],
      removeBlocks: vi.fn(),
    }

    expect(removeTrailingEmptyOutlineItem(editor)).toBe(true)
    expect(editor.removeBlocks).toHaveBeenCalledWith([emptyBullet])
  })

  it('waits for swapped content before consuming the one-time cleanup', () => {
    const initialParagraph = { id: 'initial', type: 'paragraph', content: [], children: [] }
    const heading = { id: 'title', type: 'heading', content: [{ type: 'text', text: 'Title' }], children: [] }
    const emptyBullet = { id: 'empty', type: 'bulletListItem', content: [], children: [] }
    const editor = {
      document: [initialParagraph],
      removeBlocks: vi.fn(),
      updateBlock: vi.fn(),
    }

    setOutlineEditorMode(editor, true)
    expect(normalizeOutlineEditorDocument(editor)).toBe(false)

    editor.document = [heading, emptyBullet]
    expect(normalizeOutlineEditorDocument(editor)).toBe(true)
    expect(editor.removeBlocks).toHaveBeenCalledWith([emptyBullet])
  })

  it('preserves an empty bullet when it is the only editable block', () => {
    const emptyBullet = { id: 'empty', type: 'bulletListItem', content: [], children: [] }
    const editor = {
      document: [emptyBullet],
      removeBlocks: vi.fn(),
    }

    expect(removeTrailingEmptyOutlineItem(editor)).toBe(false)
    expect(editor.removeBlocks).not.toHaveBeenCalled()
  })
})
