import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { useCreateBlockNote } from '@blocknote/react'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'
import {
  BLOCK_CONTAINER_SELECTOR,
  type TolariaBlockNoteEditor,
} from './tolariaBlockNoteDom'
import { useCollapsedHeadingIds } from './tolariaCollapsedSections'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

type CodeBlockLanguageEditor = ReturnType<typeof useCreateBlockNote>

type CodeBlockLanguageTarget = {
  blockId: string
  editable: boolean
  height: number
  language: string
  left: number
  top: number
}

type LanguageSelectControl = Element & { value: string }

const NATIVE_LANGUAGE_CONTROL_SELECTOR =
  '.bn-block-content[data-content-type="codeBlock"] > div > select'
const ELEMENT_NODE = 1
const CLIPPING_OVERFLOW_VALUES = new Set(['auto', 'clip', 'hidden', 'scroll'])

const LANGUAGE_OPTIONS = Object.entries(
  createTolariaCodeBlockOptions().supportedLanguages ?? {},
).map(([id, language]) => ({ id, name: language.name }))

function liveCodeBlock(editor: CodeBlockLanguageEditor, blockId: string): boolean {
  try {
    return editor.getBlock(blockId)?.type === 'codeBlock'
  } catch {
    return false
  }
}

function languageControlTarget(
  editor: CodeBlockLanguageEditor,
  blockId: string,
  nativeControl: LanguageSelectControl,
): CodeBlockLanguageTarget | null {
  const rect = nativeControl.getBoundingClientRect()
  if (!languageControlIsVisible(nativeControl, rect)) return null

  return {
    blockId,
    editable: editor.isEditable
      && nativeControl.closest('.bn-editor')?.getAttribute('contenteditable') !== 'false',
    height: rect.height,
    language: nativeControl.value || 'text',
    left: rect.left,
    top: rect.top,
  }
}

function clipsAxis(overflow: string): boolean {
  return CLIPPING_OVERFLOW_VALUES.has(overflow)
}

function hasHiddenAncestor(element: Element): boolean {
  let current: Element | null = element
  while (current) {
    if (window.getComputedStyle(current).display === 'none') return true
    current = current.parentElement
  }
  return false
}

function languageControlIsVisible(
  nativeControl: LanguageSelectControl,
  rect: DOMRect,
): boolean {
  if (!nativeControl.isConnected || hasHiddenAncestor(nativeControl)) return false

  // JSDOM does not perform layout, so its connected fixture controls have an empty rect.
  if (rect.width === 0 && rect.height === 0) return true

  let clipBottom = window.innerHeight
  let clipLeft = 0
  let clipRight = window.innerWidth
  let clipTop = 0
  let ancestor = nativeControl.parentElement

  while (ancestor && ancestor !== document.body) {
    const style = window.getComputedStyle(ancestor)
    const ancestorRect = ancestor.getBoundingClientRect()
    if (clipsAxis(style.overflowX)) {
      clipLeft = Math.max(clipLeft, ancestorRect.left)
      clipRight = Math.min(clipRight, ancestorRect.right)
    }
    if (clipsAxis(style.overflowY)) {
      clipTop = Math.max(clipTop, ancestorRect.top)
      clipBottom = Math.min(clipBottom, ancestorRect.bottom)
    }
    ancestor = ancestor.parentElement
  }

  return rect.bottom > clipTop
    && rect.right > clipLeft
    && rect.top < clipBottom
    && rect.left < clipRight
}

function codeBlockLanguageTarget(
  editor: CodeBlockLanguageEditor,
  element: Element,
): CodeBlockLanguageTarget | null {
  if (element.tagName !== 'SELECT') return null
  const nativeControl = element as LanguageSelectControl
  const blockId = element.closest(BLOCK_CONTAINER_SELECTOR)?.getAttribute('data-id')
  if (!blockId) return null
  if (!liveCodeBlock(editor, blockId)) return null
  return languageControlTarget(editor, blockId, nativeControl)
}

function codeBlockLanguageTargets(editor: CodeBlockLanguageEditor): CodeBlockLanguageTarget[] {
  const editorElement = editor.domElement
  if (!(editorElement instanceof Element) || !editorElement.isConnected) return []

  return Array.from(editorElement.querySelectorAll(NATIVE_LANGUAGE_CONTROL_SELECTOR))
    .map((element) => codeBlockLanguageTarget(editor, element))
    .filter((target): target is CodeBlockLanguageTarget => target !== null)
}

function sameTargets(current: CodeBlockLanguageTarget[], next: CodeBlockLanguageTarget[]): boolean {
  return current.length === next.length && current.every((target, index) => {
    const nextTarget = next[index]
    return nextTarget !== undefined
      && target.blockId === nextTarget.blockId
      && target.editable === nextTarget.editable
      && target.height === nextTarget.height
      && target.language === nextTarget.language
      && target.left === nextTarget.left
      && target.top === nextTarget.top
  })
}

function nodeTouchesEditor(node: Node): boolean {
  if (node.nodeType !== ELEMENT_NODE) return false
  const element = node as Element
  return element.matches('.bn-editor') || element.querySelector('.bn-editor') !== null
}

function mutationTouchesEditor(mutation: MutationRecord): boolean {
  if (mutation.target.nodeType === ELEMENT_NODE
    && (mutation.target as Element).closest('.bn-editor')) return true
  return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeTouchesEditor)
}

function useCodeBlockLanguageTargets(
  editor: CodeBlockLanguageEditor,
  collapsedHeadingIds: ReadonlySet<string>,
) {
  const [targets, setTargets] = useState<CodeBlockLanguageTarget[]>([])

  useEffect(() => {
    let refreshFrame: number | null = null
    const refresh = () => {
      if (refreshFrame !== null) return
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = null
        const nextTargets = codeBlockLanguageTargets(editor)
        setTargets((current) => sameTargets(current, nextTargets) ? current : nextTargets)
      })
    }
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(mutationTouchesEditor)) refresh()
    })
    observer.observe(document.body, {
      attributeFilter: ['class', 'contenteditable', 'style'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    const unsubscribe = editor.onChange?.(refresh) ?? (() => {})
    window.addEventListener('resize', refresh)
    document.addEventListener('scroll', refresh, true)
    refresh()

    return () => {
      if (refreshFrame !== null) cancelAnimationFrame(refreshFrame)
      observer.disconnect()
      unsubscribe()
      window.removeEventListener('resize', refresh)
      document.removeEventListener('scroll', refresh, true)
    }
  }, [collapsedHeadingIds, editor])

  return targets
}

function updateCodeBlockLanguage(
  editor: CodeBlockLanguageEditor,
  blockId: string,
  language: string,
): void {
  if (!editor.isEditable) return

  try {
    const block = editor.getBlock(blockId)
    if (block?.type !== 'codeBlock') return
    editor.updateBlock(blockId, { props: { language } })
  } catch {
    // BlockNote can remove a block between the picker opening and selection.
  }
}

function CodeBlockLanguagePicker({
  blockId,
  editable,
  editor,
  language,
}: {
  blockId: string
  editable: boolean
  editor: CodeBlockLanguageEditor
  language: string
}) {
  return (
    <Select
      disabled={!editable}
      value={language}
      onValueChange={(nextLanguage) => updateCodeBlockLanguage(editor, blockId, nextLanguage)}
    >
      <SelectTrigger
        size="sm"
        className="editor__code-block-language-trigger h-7 max-w-72 border-transparent bg-transparent px-2 py-0 text-xs text-muted-foreground shadow-none hover:bg-accent/60 hover:text-accent-foreground focus-visible:ring-1"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {LANGUAGE_OPTIONS.map(({ id, name }) => (
          <SelectItem key={id} value={id}>{name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CodeBlockLanguageControls({ editor }: { editor: CodeBlockLanguageEditor }) {
  const collapsedHeadingIds = useCollapsedHeadingIds(
    editor as unknown as TolariaBlockNoteEditor,
  )
  const targets = useCodeBlockLanguageTargets(editor, collapsedHeadingIds)

  return targets.map((target) => createPortal(
    <div
      className="editor__code-block-language-overlay"
      data-code-block-id={target.blockId}
      style={{ left: target.left, minHeight: target.height, top: target.top }}
    >
      <CodeBlockLanguagePicker
        blockId={target.blockId}
        editable={target.editable}
        editor={editor}
        language={target.language}
      />
    </div>,
    document.body,
    target.blockId,
  ))
}
