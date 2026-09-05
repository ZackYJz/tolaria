import { BlockNoteEditor } from '@blocknote/core'
import { schema } from '../components/editorSchema'
import { injectRichEditorMarkdownBlocks, preProcessRichEditorMarkdown, serializeRichEditorBodyToMarkdown } from './richEditorMarkdown'
import { describe, expect, it } from 'vitest'
import { BOOKMARK_BLOCK_TYPE, normalizeBookmarkUrl } from './bookmarkMarkdown'
import { injectDurableEditorMarkdownBlocks, preProcessDurableEditorMarkdown, serializeDurableEditorBlocks } from './editorDurableMarkdown'

const props = { url: 'https://example.com/', title: '网页书签', description: 'A description', image: 'https://example.com/cover.png', favicon: 'https://example.com/icon.png' }
const editor = { blocksToMarkdownLossy: () => '' }
function restore(markdown: string) {
  return injectDurableEditorMarkdownBlocks([{ type: 'paragraph', content: [{ type: 'text', text: preProcessDurableEditorMarkdown({ markdown }) }], children: [] }])
}

describe('bookmark URLs', () => {
  it('normalizes web addresses', () => {
    expect(normalizeBookmarkUrl(' example.com/path ')).toBe('https://example.com/path')
    expect(normalizeBookmarkUrl('http://example.com')).toBe('http://example.com/')
  })
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/x', 'https://user:secret@example.com', '', 'not a url', 'https://example.com/\npath'])('rejects unsafe or invalid URL %s', value => {
    expect(normalizeBookmarkUrl(value)).toBe('')
  })
})

describe('durable bookmarks', () => {
  it('round-trips a real editable BlockNote bookmark through the app save and reload pipeline', async () => {
    const realEditor = BlockNoteEditor.create({ schema, initialContent: [{ type: 'webBookmark', props }] })
    const markdown = serializeRichEditorBodyToMarkdown(realEditor)
    const parsed = await realEditor.tryParseMarkdownToBlocks(preProcessRichEditorMarkdown(markdown))
    const restored = injectRichEditorMarkdownBlocks(parsed)
    expect(restored).toMatchObject([{ type: BOOKMARK_BLOCK_TYPE, props }])
    const reloaded = BlockNoteEditor.create({ schema, initialContent: restored as typeof realEditor.document })
    expect(reloaded.document[0]).toMatchObject({ type: BOOKMARK_BLOCK_TYPE, props })
    expect(serializeRichEditorBodyToMarkdown(reloaded)).toBe(markdown)
  })
  it('preserves all metadata through registered editor codecs', () => {
    const markdown = serializeDurableEditorBlocks(editor, [{ type: BOOKMARK_BLOCK_TYPE, props }])
    expect(markdown).toContain('```bookmark\n')
    expect(restore(markdown)).toMatchObject([{ type: BOOKMARK_BLOCK_TYPE, props }])
  })
  it('round-trips blank bookmarks and multiline metadata with backticks', () => {
    const special = { ...props, title: '```bookmark\n{"url":"https://other.com"}\n```', description: 'a\nb' }
    expect(restore(serializeDurableEditorBlocks(editor, [{ type: BOOKMARK_BLOCK_TYPE, props: special }]))).toMatchObject([{ props: special }])
    expect(restore(serializeDurableEditorBlocks(editor, [{ type: BOOKMARK_BLOCK_TYPE, props: {} }]))).toMatchObject([{ type: BOOKMARK_BLOCK_TYPE, props: { url: '', title: '', description: '', image: '', favicon: '' } }])
  })
  it('sanitizes imported link and image URLs', () => {
    const unsafe = { ...props, url: 'javascript:alert(1)', image: 'data:image/svg+xml,test', favicon: 'https://user:password@example.com' }
    expect(restore('```bookmark\n' + JSON.stringify(unsafe) + '\n```')).toMatchObject([{ props: { url: '', image: '', favicon: '' } }])
  })
  it('leaves malformed bookmark source readable', () => {
    const markdown = '```bookmark\nnot json\n```'
    expect(preProcessDurableEditorMarkdown({ markdown })).toBe(markdown)
  })
  it('does not interpret bookmark examples inside outer code fences', () => {
    const markdown = '````markdown\n```bookmark\n' + JSON.stringify(props) + '\n```\n````'
    expect(preProcessDurableEditorMarkdown({ markdown })).toBe(markdown)
  })
})
