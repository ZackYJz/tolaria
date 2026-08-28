import { createExtension } from '@blocknote/core'
import type { useCreateBlockNote } from '@blocknote/react'
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

type OutlineBlock = {
  children?: OutlineBlock[]
  id: string
  type: string
  [key: string]: unknown
}

type OutlineEditor = {
  document: OutlineBlock[]
  updateBlock: (block: string, update: { type: 'bulletListItem' }) => unknown
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

export function normalizeOutlineEditorDocument(editor: OutlineEditor): boolean {
  const ids = paragraphIds(editor.document)
  for (const id of ids) {
    editor.updateBlock(id, { type: 'bulletListItem' })
  }
  return ids.length > 0
}

export function setOutlineEditorMode(editor: object, enabled: boolean): void {
  if (enabled) {
    outlineEditors.add(editor)
    return
  }
  outlineEditors.delete(editor)
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

function handleOutlineKeyDown(event: KeyboardEvent, editor: RuntimeOutlineEditor, view?: RichEditorView): void {
  if (!outlineEditors.has(editor) || editor.isEditable === false || !view) return
  if (event.key !== 'Backspace' || isComposingKeyboardEvent(event, view)) return
  if (!isProtectedListStart(view)) return

  consumeKeyboardEvent(event)
  removeEmptyListItem(editor)
}

export const createOutlineEditorModeExtension = createExtension(({ editor }) => {
  const outlineEditor = editor as RuntimeOutlineEditor

  return {
    key: 'outlineEditorMode',
    mount: createCaptureKeydownMount(outlineEditor, (event, view) => {
      handleOutlineKeyDown(event, outlineEditor, view)
    }),
  } as const
})
