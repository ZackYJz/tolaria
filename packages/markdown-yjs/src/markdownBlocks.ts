import { BlockNoteEditor } from '@blocknote/core'
import { repairMalformedEditorBlocks } from '../../../src/hooks/editorBlockRepair'
import { parseMarkdownBlocksWithFallback } from '../../../src/hooks/editorMarkdownParseFallback'
import { inferCodeBlockLanguages } from '../../../src/utils/codeBlockLanguage'
import type { DirectMarkdownCapableSerializer } from '../../../src/utils/blockNoteDirectMarkdown'
import {
  injectRichEditorMarkdownBlocks,
  installRichEditorMarkdownSerializer,
  preProcessRichEditorMarkdown,
  serializeRichEditorBlocksToMarkdown,
} from '../../../src/utils/richEditorMarkdown'
import { installHeadlessDom } from './headlessDom.ts'
import { headlessSchema } from './schema.ts'

/**
 * Markdown body to BlockNote blocks and back, through the same steps the Tolaria editor runs
 * when it opens and saves a note (`src/hooks/editorBlockResolution.ts`,
 * `src/utils/richEditorMarkdown.ts`), on an editor that is never mounted.
 */

export type HeadlessEditor = ReturnType<typeof createHeadlessEditor>
export type NoteBlock = HeadlessEditor['document'][number]

const EMPTY_CHECKLIST_FILLER = '​'

interface LooseBlock {
  type?: string
  content?: unknown
  children?: unknown
}

export function createHeadlessEditor() {
  installHeadlessDom()
  const editor = BlockNoteEditor.create({ schema: headlessSchema })
  installRichEditorMarkdownSerializer(editor)
  return editor
}

function isFillerContent(content: unknown): boolean {
  if (!Array.isArray(content) || content.length !== 1) return false
  const [item] = content as { type?: unknown; text?: unknown }[]
  return item.type === 'text' && item.text === EMPTY_CHECKLIST_FILLER
}

/** The preprocessor gives an empty checklist item a filler so the parser keeps it. */
function withoutChecklistFillers(blocks: unknown[]): unknown[] {
  for (const block of blocks as LooseBlock[]) {
    if (block.type === 'checkListItem' && isFillerContent(block.content)) block.content = []
    if (Array.isArray(block.children)) withoutChecklistFillers(block.children)
  }
  return blocks
}

function editorBlocks(parsed: unknown[]): unknown[] {
  const safe = withoutChecklistFillers(repairMalformedEditorBlocks(parsed))
  return inferCodeBlockLanguages(repairMalformedEditorBlocks(injectRichEditorMarkdownBlocks(safe)))
}

/** The body of a note (no frontmatter) as the blocks the editor would show. */
export async function markdownToBlocks(editor: HeadlessEditor, body: string): Promise<NoteBlock[]> {
  const source = body.trimStart()
  const parsed = await parseMarkdownBlocksWithFallback({
    parseMarkdownBlocks: (markdown) => editor.tryParseMarkdownToBlocks(markdown),
    preprocessed: preProcessRichEditorMarkdown(source),
    sourceMarkdown: source,
    context: 'note',
  })
  const blocks = parsed.usedSourceFallback ? parsed.blocks : editorBlocks(parsed.blocks)
  return blocks as NoteBlock[]
}

/** Blocks as the markdown body the editor would save. */
export function blocksToMarkdown(editor: HeadlessEditor, blocks: readonly NoteBlock[]): string {
  // The app's serializer takes blocks untyped; the editor is the same object either way.
  const serializer = editor as unknown as DirectMarkdownCapableSerializer
  return serializeRichEditorBlocksToMarkdown({ blocks: [...blocks], editor: serializer })
}
