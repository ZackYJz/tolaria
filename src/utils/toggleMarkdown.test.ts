import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { schema } from '../components/editorSchema'
import { installBlockNoteDirectMarkdown } from './blockNoteDirectMarkdown'
import { serializeRichEditorBlocksToMarkdown } from './richEditorMarkdown'
import {
  injectToggleMarkdownBlocks,
  preProcessToggleMarkdown,
  serializeToggleMarkdownBlocks,
} from './toggleMarkdown'

function parsedToggleFixture(markdown: string) {
  const [marker] = markdown.split('\n')
  const token = marker?.replace(/^- /u, '') ?? ''
  return injectToggleMarkdownBlocks([{
    type: 'bulletListItem',
    content: [{ type: 'text', text: `${token}\nHidden detail`, styles: {} }],
    children: [],
  }])
}

describe('toggle Markdown compatibility', () => {
  it('imports a Markdown details element as an editable toggle block', () => {
    const preprocessed = preProcessToggleMarkdown([
      '<details>',
      '<summary>Release notes &amp; follow-ups</summary>',
      '',
      'Hidden detail',
      '</details>',
    ].join('\n'))

    const [block] = parsedToggleFixture(preprocessed) as Array<{
      type: string
      content: Array<{ text: string }>
      children: Array<{ type: string }>
    }>

    expect(preprocessed).toMatch(/^- TOLARIA-TOGGLE-START:/u)
    expect(block.type).toBe('toggleListItem')
    expect(block.content).toEqual([{ type: 'text', text: 'Release notes & follow-ups', styles: {} }])
    expect(block.children).toEqual([expect.objectContaining({ type: 'paragraph' })])
  })

  it('exports toggle children as portable details Markdown', () => {
    const serializeOrdinaryBlocks = vi.fn((blocks: unknown[]) => {
      const [block] = blocks as Array<{ content: Array<{ text: string }> }>
      return block?.content.map(item => item.text).join('') ?? ''
    })
    const markdown = serializeToggleMarkdownBlocks({
      blocks: [{
        type: 'toggleListItem',
        content: [{ type: 'text', text: 'Release notes & follow-ups', styles: {} }],
        children: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hidden detail', styles: {} }],
          children: [],
        }],
      }],
      serializeBlocks: blocks => serializeToggleMarkdownBlocks({
        blocks,
        serializeBlocks: () => '',
        serializeOrdinaryBlocks,
      }),
      serializeOrdinaryBlocks,
    })

    expect(markdown).toBe([
      '<details>',
      '<summary>Release notes &amp; follow-ups</summary>',
      '',
      'Hidden detail',
      '</details>',
    ].join('\n'))
  })

  it('leaves details examples inside fenced code unchanged', () => {
    const markdown = [
      '```html',
      '<details>',
      '<summary>Example</summary>',
      '</details>',
      '```',
    ].join('\n')

    expect(preProcessToggleMarkdown(markdown)).toBe(markdown)
  })

  it('round-trips a details block through the real BlockNote parser', async () => {
    const markdown = [
      '<details>',
      '<summary>Project context</summary>',
      '',
      'A paragraph with **bold** text.',
      '',
      '- First item',
      '- Second item',
      '</details>',
    ].join('\n')
    const editor = BlockNoteEditor.create({ schema })
    installBlockNoteDirectMarkdown(editor)
    const parsed = await editor.tryParseMarkdownToBlocks(preProcessToggleMarkdown(markdown))
    const injected = injectToggleMarkdownBlocks(parsed)
    editor.replaceBlocks(editor.document, injected as Parameters<typeof editor.replaceBlocks>[1])

    expect(editor.document.at(0)).toMatchObject({
      type: 'toggleListItem',
      children: [
        expect.objectContaining({ type: 'paragraph' }),
        expect.objectContaining({ type: 'bulletListItem' }),
        expect.objectContaining({ type: 'bulletListItem' }),
      ],
    })
    expect(serializeRichEditorBlocksToMarkdown({
      blocks: editor.document,
      editor,
    })).toBe(`${markdown}\n`)
  })

  it('keeps a toggle nested beneath an ordinary list item', async () => {
    const markdown = [
      '- Parent item',
      '',
      '  <details>',
      '  <summary>Nested context</summary>',
      '',
      '  Hidden child',
      '  </details>',
    ].join('\n')
    const editor = BlockNoteEditor.create({ schema })
    installBlockNoteDirectMarkdown(editor)
    const parsed = await editor.tryParseMarkdownToBlocks(preProcessToggleMarkdown(markdown))
    const injected = injectToggleMarkdownBlocks(parsed)
    editor.replaceBlocks(editor.document, injected as Parameters<typeof editor.replaceBlocks>[1])

    expect(editor.document.at(0)?.children.at(0)).toMatchObject({ type: 'toggleListItem' })
    expect(serializeRichEditorBlocksToMarkdown({
      blocks: editor.document,
      editor,
    })).toContain('<summary>Nested context</summary>')
  })
})
