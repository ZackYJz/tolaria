import { createExtension } from '@blocknote/core'
import type { Node as ProsemirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { trackEvent } from '../lib/telemetry'
import { nextJournalTaskStatus, type JournalTaskStatus } from '../utils/journalTasks'
import { isMac } from '../utils/platform'
import { richEditorBlockSelectionPluginKey } from './richEditorBlockSelectionExtension'

type InlineText = {
  styles?: Record<string, unknown>
  text: string
  type: 'text'
}

type InlineContent = Array<InlineText | Record<string, unknown>>

type JournalTaskBlock = {
  content: InlineContent | string | undefined
  id: string
  props?: { checked?: boolean }
  type: string
}

type JournalTaskEditor = object & {
  _tiptapEditor?: { view?: JournalTaskEditorView }
  domElement?: HTMLElement
  getBlock: (id: string) => JournalTaskBlock | undefined
  getTextCursorPosition: () => { block: JournalTaskBlock }
  isEditable?: boolean
  prosemirrorView?: JournalTaskEditorView
  setTextCursorPosition: (id: string, placement: 'end') => unknown
  updateBlock: (id: string, update: {
    content: InlineContent
    props?: { checked: boolean }
    type?: string
  }) => unknown
}

type JournalTaskEditorView = {
  composing?: boolean
  dispatch?: (transaction: Transaction) => void
  state?: EditorState
}

const TASK_PREFIX_PATTERN = /^(TODO|DOING|DONE)\b/u
const journalTaskDecorationPluginKey = new PluginKey<DecorationSet>('tolariaJournalTaskDecoration')
const journalTaskEditors = new WeakSet<object>()
const journalTaskEditorRoots = new WeakMap<object, HTMLElement>()

export function setJournalTaskEditorMode(editor: object, enabled: boolean): void {
  if (enabled) journalTaskEditors.add(editor)
  else journalTaskEditors.delete(editor)
  const taskEditor = editor as { domElement?: HTMLElement }
  const root = taskEditor.domElement ?? journalTaskEditorRoots.get(editor)
  root?.toggleAttribute('data-journal-task-editor', enabled)
}

export function isJournalTaskEditorMode(editor: object): boolean {
  return journalTaskEditors.has(editor)
}

function isInlineText(item: InlineContent[number]): item is InlineText {
  return item.type === 'text' && typeof item.text === 'string'
}

function contentWithNextTaskStatus(content: JournalTaskBlock['content']): {
  content: InlineContent
  status: JournalTaskStatus
} {
  const items: InlineContent = Array.isArray(content) ? [...content] : []
  const first = items[0]
  if (!first || !isInlineText(first)) {
    return {
      content: [{ type: 'text', text: 'TODO ', styles: {} }, ...items],
      status: 'TODO',
    }
  }

  const currentStatus = TASK_PREFIX_PATTERN.exec(first.text)?.[1] as JournalTaskStatus | undefined
  const status = nextJournalTaskStatus(currentStatus ?? null)
  const nextText = currentStatus
    ? `${status}${first.text.slice(currentStatus.length)}`
    : `${status} ${first.text}`
  items[0] = { ...first, text: nextText }
  return { content: items, status }
}

function contentWithTaskStatus(
  content: JournalTaskBlock['content'],
  status: JournalTaskStatus,
  consumeSlashCommand = false,
): InlineContent {
  const items: InlineContent = Array.isArray(content) ? [...content] : []
  if (
    consumeSlashCommand
    && items.length === 1
    && isInlineText(items[0])
    && /^\/(?:todo|doing|done)\s*$/iu.test(items[0].text)
  ) {
    items.length = 0
  }
  const first = items[0]
  if (!first || !isInlineText(first)) {
    return [{ type: 'text', text: `${status} `, styles: {} }, ...items]
  }

  const currentStatus = TASK_PREFIX_PATTERN.exec(first.text)?.[1]
  if (currentStatus) {
    items[0] = {
      ...first,
      text: `${status}${first.text.slice(currentStatus.length)}`,
    }
    return items
  }

  return [{ type: 'text', text: `${status} `, styles: {} }, ...items]
}

function taskStatusFromContent(content: JournalTaskBlock['content']): JournalTaskStatus | null {
  if (!Array.isArray(content)) return null
  const first = content[0]
  if (!first || !isInlineText(first)) return null
  return (TASK_PREFIX_PATTERN.exec(first.text)?.[1] as JournalTaskStatus | undefined) ?? null
}

function taskBlockUpdate(
  block: JournalTaskBlock,
  status: JournalTaskStatus,
  consumeSlashCommand = false,
): { content: InlineContent; props: { checked: boolean }; type: 'checkListItem' } {
  return {
    content: contentWithTaskStatus(block.content, status, consumeSlashCommand),
    props: { checked: status === 'DONE' },
    type: 'checkListItem',
  }
}

export function setCurrentJournalTaskStatus(
  editor: Pick<JournalTaskEditor, 'getBlock' | 'getTextCursorPosition' | 'setTextCursorPosition' | 'updateBlock'>,
  status: JournalTaskStatus,
  options: { consumeSlashCommand?: boolean } = {},
): void {
  const cursorBlock = editor.getTextCursorPosition().block
  const block = editor.getBlock(cursorBlock.id) ?? cursorBlock
  editor.updateBlock(block.id, taskBlockUpdate(block, status, options.consumeSlashCommand))
  editor.setTextCursorPosition(block.id, 'end')
}

function isJournalTaskShortcut(event: KeyboardEvent): boolean {
  const commandModifier = isMac()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
  return commandModifier
    && event.key === 'Enter'
    && !event.altKey
    && !event.shiftKey
}

function isComposing(event: KeyboardEvent, editor: JournalTaskEditor): boolean {
  const view = editor._tiptapEditor?.view ?? editor.prosemirrorView
  return event.isComposing || event.keyCode === 229 || view?.composing === true
}

function hasBlockSelection(editor: JournalTaskEditor): boolean {
  const state = (editor._tiptapEditor?.view ?? editor.prosemirrorView)?.state
  return !!state && richEditorBlockSelectionPluginKey.getState(state as never) != null
}

function cycleCurrentJournalTask(editor: JournalTaskEditor): JournalTaskStatus | null {
  const cursorBlock = editor.getTextCursorPosition().block
  const block = editor.getBlock(cursorBlock.id) ?? cursorBlock
  if (block.type !== 'checkListItem') return null

  const update = contentWithNextTaskStatus(block.content)
  editor.updateBlock(block.id, {
    content: update.content,
    props: { checked: update.status === 'DONE' },
    type: 'checkListItem',
  })
  return update.status
}

function journalTaskDecorations(doc: ProsemirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, position) => {
    if (node.type.name !== 'blockContainer') return true
    const blockContent = node.firstChild
    if (blockContent?.type.name !== 'checkListItem') return false

    const match = TASK_PREFIX_PATTERN.exec(blockContent.textContent)
    const blockId = typeof node.attrs.id === 'string' ? node.attrs.id : null
    if (!match || !blockId) return false

    const status = match[1]
    const statusStart = position + 2
    decorations.push(Decoration.inline(statusStart, statusStart + status.length, {
      'class': 'journal-task-status',
      'data-journal-task-block-id': blockId,
      'data-journal-task-status': status,
    }))
    return false
  })
  return DecorationSet.create(doc, decorations)
}

function createJournalTaskDecorationPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: journalTaskDecorationPluginKey,
    props: {
      decorations: (state) => journalTaskDecorationPluginKey.getState(state) ?? DecorationSet.empty,
    },
    state: {
      init: (_, state) => journalTaskDecorations(state.doc),
      apply: (transaction, decorations) => (
        transaction.docChanged
          ? journalTaskDecorations(transaction.doc)
          : decorations.map(transaction.mapping, transaction.doc)
      ),
    },
  })
}

function updateTaskFromControl(
  editor: JournalTaskEditor,
  blockId: string,
  source: 'checkbox' | 'status_badge',
): boolean {
  const block = editor.getBlock(blockId)
  if (!block || block.type !== 'checkListItem') return false
  const currentStatus = taskStatusFromContent(block.content)
  if (!currentStatus) return false

  const status = source === 'checkbox'
    ? (currentStatus === 'DONE' ? 'TODO' : 'DONE')
    : nextJournalTaskStatus(currentStatus)
  editor.updateBlock(block.id, taskBlockUpdate(block, status))
  trackEvent('journal_task_status_changed', {
    source,
    status: status.toLowerCase(),
  })
  return true
}

function taskControlFromTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-journal-task-status]')
    : null
}

function checklistBlockId(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return null
  if (!target.closest('[data-content-type="checkListItem"]')) return null
  return target.closest<HTMLElement>('.bn-block[data-id]')?.dataset.id ?? null
}

export const createJournalTaskShortcutExtension = createExtension(({ editor }) => {
  const taskEditor = editor as JournalTaskEditor
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!journalTaskEditors.has(taskEditor) || taskEditor.isEditable === false) return
    if (!isJournalTaskShortcut(event) || isComposing(event, taskEditor)) return
    if (hasBlockSelection(taskEditor)) return

    const status = cycleCurrentJournalTask(taskEditor)
    if (!status) return
    event.preventDefault()
    event.stopPropagation()
    trackEvent('journal_task_status_changed', {
      source: 'keyboard_shortcut',
      status: status.toLowerCase(),
    })
  }
  const handleClick = (event: MouseEvent) => {
    if (!journalTaskEditors.has(taskEditor) || taskEditor.isEditable === false) return
    const statusControl = taskControlFromTarget(event.target)
    const blockId = statusControl?.dataset.journalTaskBlockId ?? checklistBlockId(event.target)
    if (!blockId) return
    const source = statusControl ? 'status_badge' : 'checkbox'
    if (!updateTaskFromControl(taskEditor, blockId, source)) return
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    key: 'journalTaskShortcut',
    prosemirrorPlugins: [createJournalTaskDecorationPlugin()],
    mount: ({ dom, signal }) => {
      const root = taskEditor.domElement ?? dom
      journalTaskEditorRoots.set(taskEditor, root)
      root.toggleAttribute('data-journal-task-editor', journalTaskEditors.has(taskEditor))
      dom.addEventListener('keydown', handleKeyDown, { capture: true, signal })
      dom.addEventListener('click', handleClick, { capture: true, signal })
      signal.addEventListener('abort', () => journalTaskEditorRoots.delete(taskEditor), { once: true })
    },
  } as const
})
