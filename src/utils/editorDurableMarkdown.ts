import {
  hasDurableMarkdownBlocks,
  injectDurableMarkdownBlocks,
  preProcessDurableMarkdownBlocks,
  serializeDurableMarkdownBlocks,
  type MarkdownSerializer,
} from './durableMarkdownBlocks'
import {
  hasFileAttachmentBlocks,
  injectFileAttachmentBlocks,
  preProcessFileAttachmentMarkdown,
  serializeFileAttachmentBlocks,
} from './fileAttachmentMarkdown'
import { restoreMarkdownHighlightsInBlocks } from './markdownHighlightMarkdown'
import { restoreMathInBlocks, serializeMathAwareBlocks } from './mathMarkdown'
import {
  hasCalloutBlocks,
  isCalloutBlock,
  serializeCalloutBlock,
} from './calloutMarkdown'
import { htmlBlockMarkdownCodec } from './htmlBlockMarkdown'
import { mermaidMarkdownCodec } from './mermaidMarkdown'
import { tldrawMarkdownCodec } from './tldrawMarkdown'
import {
  hasToggleMarkdownBlocks,
  injectToggleMarkdownBlocks,
  preProcessToggleMarkdown,
  serializeToggleMarkdownBlocks,
} from './toggleMarkdown'

const EDITOR_DURABLE_MARKDOWN_CODECS = [
  htmlBlockMarkdownCodec,
  mermaidMarkdownCodec,
  tldrawMarkdownCodec,
] as const

export function preProcessDurableEditorMarkdown({ markdown }: { markdown: string }): string {
  const withDurableBlocks = preProcessDurableMarkdownBlocks({
    markdown,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
  const withFileAttachments = preProcessFileAttachmentMarkdown({ markdown: withDurableBlocks })
  return preProcessToggleMarkdown(withFileAttachments)
}

export function injectDurableEditorMarkdownBlocks(blocks: unknown[]): unknown[] {
  const withDurableBlocks = injectDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
  const withFileAttachments = injectFileAttachmentBlocks(withDurableBlocks)
  return injectToggleMarkdownBlocks(withFileAttachments)
}

function serializeCalloutAndMathAwareBlocks(editor: MarkdownSerializer, blocks: unknown[]): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    const restored = restoreMarkdownHighlightsInBlocks(pending)
    const markdown = serializeMathAwareBlocks(editor, restored).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks) {
    if (isCalloutBlock(block as Parameters<typeof isCalloutBlock>[0])) {
      flushPending()
      const [restoredCallout] = restoreMathInBlocks(
        restoreMarkdownHighlightsInBlocks([block]),
      )
      chunks.push(serializeCalloutBlock(
        editor,
        restoredCallout as Parameters<typeof serializeCalloutBlock>[1],
      ))
    } else {
      pending.push(block)
    }
  }
  flushPending()
  return chunks.join('\n\n')
}

export function serializeDurableEditorBlocks(
  editor: MarkdownSerializer,
  blocks: unknown[],
  vaultPath?: string,
): string {
  const serializeBlocks = (pendingBlocks: unknown[]): string => serializeToggleMarkdownBlocks({
    blocks: pendingBlocks,
    serializeBlocks,
    serializeOrdinaryBlocks: ordinaryBlocks => serializeFileAttachmentBlocks({
      blocks: ordinaryBlocks,
      vaultPath,
      serializeOrdinaryBlocks: fileOrdinaryBlocks => serializeDurableMarkdownBlocks({
        blocks: fileOrdinaryBlocks,
        codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
        serializeOrdinaryBlocks: durableOrdinaryBlocks => serializeCalloutAndMathAwareBlocks(
          editor,
          durableOrdinaryBlocks,
        ),
      }),
    }),
  })

  return serializeBlocks(blocks)
}

export function hasDurableEditorBlocks(blocks: unknown[]): boolean {
  return hasToggleMarkdownBlocks(blocks) || hasCalloutBlocks(blocks) || hasFileAttachmentBlocks(blocks) || hasDurableMarkdownBlocks({
    blocks,
    codecs: EDITOR_DURABLE_MARKDOWN_CODECS,
  })
}
