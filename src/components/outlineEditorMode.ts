import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import {
  consumeKeyboardEvent,
  createCaptureKeydownMount,
  isComposingKeyboardEvent,
  type RichEditorView,
} from './richEditorKeyboard'

const OUTLINE_LIST_BLOCK_TYPES = new Set([
  'bulletListItem',
  'checkListItem',
  'numberedListItem',
  'toggleListItem',
])
const outlineEditors = new WeakSet<object>()
const outlineEditorsAwaitingInitialCleanup = new WeakSet<object>()
const outlineAwareTrailingBlockPluginKey = new PluginKey<boolean>('tolariaOutlineAwareTrailingBlock')

type OutlineBlock = {
  children?: OutlineBlock[]
  id: string
  type: string
  [key: string]: unknown
}

type OutlineEditor = {
  document: OutlineBlock[]
  removeBlocks: (blocks: OutlineBlock[]) => unknown
  updateBlock: (block: string, update: { type: 'bulletListItem' }) => unknown
}

type MutableOutlineEditor = {
  document: OutlineBlock[]
  removeBlocks: (blocks: OutlineBlock[]) => unknown
}

type RuntimeOutlineEditor = ReturnType<typeof useCreateBlockNote> & { isEditable?: boolean }
type RuntimeOutlineBlock = ReturnType<RuntimeOutlineEditor['getTextCursorPosition']>['block']

export type OutlineNormalization = {
  blocks: OutlineBlock[]
  changed: boolean
}

function normalizeBlock(block: OutlineBlock): { block: OutlineBlock; changed: boolean } {
  const normalizedChildren = outlineBlocksWithListItems(block.children ?? [])
  const nextType = block.type === 'paragraph' ? 'bulletListItem' : block.type
  const changed = nextType !== block.type || normalizedChildren.changed
  if (!changed) return { block, changed: false }

  return {
    block: {
      ...block,
      type: nextType,
      children: normalizedChildren.blocks,
    },
    changed: true,
  }
}

export function outlineBlocksWithListItems(blocks: OutlineBlock[]): OutlineNormalization {
  let changed = false
  const normalized = blocks.map((block) => {
    const result = normalizeBlock(block)
    changed ||= result.changed
    return result.block
  })

  return { blocks: changed ? normalized : blocks, changed }
}

function paragraphIds(blocks: OutlineBlock[]): string[] {
  return blocks.flatMap((block) => [
    ...(block.type === 'paragraph' ? [block.id] : []),
    ...paragraphIds(block.children ?? []),
  ])
}

function isUninitializedEditorDocument(blocks: OutlineBlock[]): boolean {
  if (blocks.length !== 1) return false
  const [block] = blocks
  return block.type === 'paragraph'
    && Array.isArray(block.content)
    && block.content.length === 0
    && (block.children?.length ?? 0) === 0
}

export function normalizeOutlineEditorDocument(editor: OutlineEditor): boolean {
  if (outlineEditorsAwaitingInitialCleanup.has(editor) && isUninitializedEditorDocument(editor.document)) {
    return false
  }

  const removedInitialItem = outlineEditorsAwaitingInitialCleanup.has(editor)
    && removeTrailingEmptyOutlineItem(editor)
  outlineEditorsAwaitingInitialCleanup.delete(editor)
  const ids = paragraphIds(editor.document)
  for (const id of ids) {
    editor.updateBlock(id, { type: 'bulletListItem' })
  }
  return removedInitialItem || ids.length > 0
}

function isEmptyLeafOutlineListItem(block: OutlineBlock): boolean {
  return OUTLINE_LIST_BLOCK_TYPES.has(block.type)
    && Array.isArray(block.content)
    && block.content.length === 0
    && (block.children?.length ?? 0) === 0
}

export function removeTrailingEmptyOutlineItem(editor: MutableOutlineEditor): boolean {
  if (editor.document.length < 2) return false

  const trailingBlock = editor.document.at(-1)
  if (!trailingBlock || !isEmptyLeafOutlineListItem(trailingBlock)) return false

  editor.removeBlocks([trailingBlock])
  return true
}

export function setOutlineEditorMode(editor: object, enabled: boolean): void {
  if (enabled) {
    outlineEditors.add(editor)
    outlineEditorsAwaitingInitialCleanup.add(editor)
    return
  }
  outlineEditors.delete(editor)
  outlineEditorsAwaitingInitialCleanup.delete(editor)
}

function isProtectedListStart(view: RichEditorView): boolean {
  if (!view.state.selection.empty) return false

  const selection = view.dom.ownerDocument.getSelection()
  if (!selection?.isCollapsed || !selection.anchorNode) return false
  const anchorElement = selection.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection.anchorNode.parentElement
  const blockElement = anchorElement?.closest<HTMLElement>('[data-content-type]')
  if (!blockElement || !OUTLINE_LIST_BLOCK_TYPES.has(blockElement.dataset.contentType ?? '')) return false

  const inlineContent = blockElement.querySelector<HTMLElement>('.bn-inline-content') ?? blockElement
  if (!inlineContent.contains(selection.anchorNode)) return false

  const contentBeforeCursor = view.dom.ownerDocument.createRange()
  contentBeforeCursor.selectNodeContents(inlineContent)
  contentBeforeCursor.setEnd(selection.anchorNode, selection.anchorOffset)
  return contentBeforeCursor.toString().length === 0
}

function isEmptyLeafListItem(block: RuntimeOutlineBlock): boolean {
  return Array.isArray(block.content)
    && block.content.length === 0
    && block.children.length === 0
}

function removeEmptyListItem(editor: RuntimeOutlineEditor): boolean {
  const { block, nextBlock, prevBlock } = editor.getTextCursorPosition()
  if (!isEmptyLeafListItem(block)) return false

  const cursorTarget = prevBlock ?? nextBlock
  if (!cursorTarget) return false

  editor.transact(() => {
    editor.removeBlocks([block])
    editor.setTextCursorPosition(cursorTarget, prevBlock ? 'end' : 'start')
  })
  return true
}

function removeAutomaticTrailingItemBeforeEnter(editor: RuntimeOutlineEditor): void {
  const trailingBlock = editor.document.at(-1)
  if (!trailingBlock) return
  if (editor.getTextCursorPosition().block.id === trailingBlock.id) return
  removeTrailingEmptyOutlineItem(editor as unknown as MutableOutlineEditor)
}

function handleOutlineKeyDown(event: KeyboardEvent, editor: RuntimeOutlineEditor, view?: RichEditorView): void {
  if (!outlineEditors.has(editor) || editor.isEditable === false || !view) return
  if (isComposingKeyboardEvent(event, view)) return
  if (event.key === 'Enter') {
    removeAutomaticTrailingItemBeforeEnter(editor)
    return
  }
  if (event.key !== 'Backspace') return
  if (!isProtectedListStart(view)) return

  consumeKeyboardEvent(event)
  removeEmptyListItem(editor)
}

function createOutlineAwareTrailingBlockPlugin(editor: RuntimeOutlineEditor): Plugin<boolean> {
  return new Plugin({
    key: outlineAwareTrailingBlockPluginKey,
    appendTransaction: (_, __, state) => {
      if (outlineEditors.has(editor) || !outlineAwareTrailingBlockPluginKey.getState(state)) return

      const endPosition = state.doc.content.size - 2
      const blockContainer = state.schema.nodes.blockContainer
      const paragraph = state.schema.nodes.paragraph
      if (!blockContainer || !paragraph) return

      return state.tr.insert(endPosition, blockContainer.create(undefined, paragraph.create()))
    },
    state: {
      init: () => false,
      apply: (transaction, previousValue) => {
        if (!transaction.docChanged) return previousValue

        const blockGroup = transaction.doc.lastChild
        const blockContainer = blockGroup?.type.name === 'blockGroup' ? blockGroup.lastChild : undefined
        if (!blockContainer || blockContainer.type.name !== 'blockContainer') return true

        const blockContent = blockContainer.firstChild
        if (!blockContent) return true
        return blockContainer.nodeSize > 4 || blockContent.type.spec.content !== 'inline*'
      },
    },
  })
}

export const createOutlineEditorModeExtension = createExtension(({ editor }) => {
  const outlineEditor = editor as RuntimeOutlineEditor

  return {
    key: 'outlineEditorMode',
    prosemirrorPlugins: [createOutlineAwareTrailingBlockPlugin(outlineEditor)],
    mount: createCaptureKeydownMount(outlineEditor, (event, view) => {
      handleOutlineKeyDown(event, outlineEditor, view)
    }),
  } as const
})
