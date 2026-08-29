import { createExtension } from '@blocknote/core'
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
  type: string
}

type JournalTaskEditor = object & {
  _tiptapEditor?: { view?: { composing?: boolean; state?: object } }
  getBlock: (id: string) => JournalTaskBlock | undefined
  getTextCursorPosition: () => { block: JournalTaskBlock }
  isEditable?: boolean
  prosemirrorView?: { composing?: boolean; state?: object }
  setTextCursorPosition: (id: string, placement: 'end') => unknown
  updateBlock: (id: string, update: { content: InlineContent; type?: string }) => unknown
}

const JOURNAL_TASK_BLOCK_TYPES = new Set(['bulletListItem', 'numberedListItem', 'checkListItem'])
const TASK_PREFIX_PATTERN = /^(TODO|DOING|DONE)\b/u
const journalTaskEditors = new WeakSet<object>()

export function setJournalTaskEditorMode(editor: object, enabled: boolean): void {
  if (enabled) journalTaskEditors.add(editor)
  else journalTaskEditors.delete(editor)
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
): InlineContent {
  const items: InlineContent = Array.isArray(content) ? [...content] : []
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

export function setCurrentJournalTaskStatus(
  editor: Pick<JournalTaskEditor, 'getBlock' | 'getTextCursorPosition' | 'setTextCursorPosition' | 'updateBlock'>,
  status: JournalTaskStatus,
): void {
  const cursorBlock = editor.getTextCursorPosition().block
  const block = editor.getBlock(cursorBlock.id) ?? cursorBlock
  editor.updateBlock(block.id, {
    content: contentWithTaskStatus(block.content, status),
    type: 'bulletListItem',
  })
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
  if (!JOURNAL_TASK_BLOCK_TYPES.has(block.type)) return null

  const update = contentWithNextTaskStatus(block.content)
  editor.updateBlock(block.id, { content: update.content })
  return update.status
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

  return {
    key: 'journalTaskShortcut',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, { capture: true, signal })
    },
  } as const
})
