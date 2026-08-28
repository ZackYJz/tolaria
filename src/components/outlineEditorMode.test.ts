import { describe, expect, it } from 'vitest'
import { outlineBlocksWithListItems } from './outlineEditorMode'

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
