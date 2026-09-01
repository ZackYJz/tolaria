import { createExtension } from '@blocknote/core'
import { SuggestionMenu } from '@blocknote/core/extensions'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { isTauri } from '../mock-tauri'
import { isMac } from '../utils/platform'
import { activeRichEditorView } from './richEditorKeyboard'

const COMPOSITION_SETTLE_WINDOW_MS = 500
const SAFARI_IME_DOM_PRESERVER_ATTRIBUTE = 'data-tolaria-ime-dom-preserver'

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    || event.code === 'Enter'
    || event.code === 'NumpadEnter'
    || event.keyCode === 13
}

function isRecentCompositionEnd(event: KeyboardEvent, compositionEndedAt: number | null): boolean {
  if (compositionEndedAt === null) return false

  const elapsed = event.timeStamp - compositionEndedAt
  return elapsed >= 0 && elapsed < COMPOSITION_SETTLE_WINDOW_MS
}

function isMacosTauriRuntime(): boolean {
  return isTauri() && isMac()
}

function runEditorEnterCommand(view: EditorView, event: KeyboardEvent): boolean {
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event)) === true
  if (handled) event.preventDefault()
  return handled
}

function selectedBlockId(view: EditorView): string | null {
  const { $from } = view.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const id = $from.node(depth).attrs.id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return null
}

export function createMacosTauriImmediateEnterPlugin(
  enabled = isMacosTauriRuntime(),
): Plugin {
  const key = new PluginKey('tolariaMacosTauriImmediateImeEnter')
  if (!enabled) return new Plugin({ key })

  let compositionEndedAt: number | null = null
  let composingEnterBlockId: string | null = null
  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        compositionend: (view, event) => {
          compositionEndedAt = event.timeStamp
          const pendingBlockId = composingEnterBlockId
          composingEnterBlockId = null
          if (pendingBlockId !== null) {
            setTimeout(() => {
              if (view.isDestroyed || selectedBlockId(view) !== pendingBlockId) return
              runEditorEnterCommand(view, new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                code: 'Enter',
                key: 'Enter',
              }))
            }, 0)
          }
          return false
        },
        keydown: (view, event) => {
          if (isEnterKey(event) && (event.isComposing || view.composing)) {
            compositionEndedAt = null
            composingEnterBlockId = selectedBlockId(view)
            return false
          }

          if (!isRecentCompositionEnd(event, compositionEndedAt)) {
            compositionEndedAt = null
            return false
          }

          compositionEndedAt = null
          if (!isEnterKey(event) || event.isComposing || view.composing) return false
          return runEditorEnterCommand(view, event)
        },
      },
    },
  })
}

function composedSlashCommandRange(data: string, view: ReturnType<typeof activeRichEditorView>) {
  if (!view?.state.selection.empty) return null

  const slashIndex = data.lastIndexOf('/')
  if (slashIndex < 0) return null

  const command = data.slice(slashIndex)
  if (command.includes('\n')) return null

  const to = view.state.selection.from
  const from = to - command.length
  if (from < 1 || view.state.doc.textBetween(from, to) !== command) return null

  return { from, query: command.slice(1), to }
}

function isSafariRuntime(): boolean {
  return typeof navigator !== 'undefined' && /Apple Computer/.test(navigator.vendor)
}

function safariImeDomPreserverDecorations(
  state: EditorState,
  composing: boolean,
): DecorationSet | undefined {
  const { $from, $to, to } = state.selection
  if (!composing || !$from.sameParent($to)) return undefined

  const decoration = Decoration.widget(to, (view: EditorView) => {
    const sentinel = view.dom.ownerDocument.createElement('span')
    sentinel.className = 'ProseMirror-safari-ime-span'
    sentinel.setAttribute(SAFARI_IME_DOM_PRESERVER_ATTRIBUTE, '')
    sentinel.setAttribute('aria-hidden', 'true')
    sentinel.textContent = '\u200B'
    return sentinel
  }, {
    ignoreSelection: true,
    key: 'tolaria-safari-ime-dom-preserver',
  })

  return DecorationSet.create(state.doc, [decoration])
}

/**
 * Safari removes positioned ancestors when it commits a composition that
 * temporarily empties their only text node. Keep an out-of-model sentinel in
 * the active text block so nested list structure survives that native delete.
 */
export function createSafariImeDomPreserverPlugin(
  enabled = isSafariRuntime(),
): Plugin {
  const key = new PluginKey('tolariaSafariImeDomPreserver')
  if (!enabled) return new Plugin({ key })

  let composing = false
  return new Plugin({
    key,
    props: {
      decorations: (state) => safariImeDomPreserverDecorations(state, composing),
      handleDOMEvents: {
        compositionstart: () => {
          composing = true
          return false
        },
        compositionend: () => {
          composing = false
          return false
        },
      },
    },
  })
}

function createComposedSlashCommandRecoveryPlugin(
  recover: (data: string) => void,
): Plugin {
  return new Plugin({
    key: new PluginKey('tolariaComposedSlashCommandRecovery'),
    props: {
      handleDOMEvents: {
        compositionend: (_view, event) => {
          if (event.data) setTimeout(() => recover(event.data), 0)
          return false
        },
      },
    },
  })
}

export const createImeCompositionCompatibilityExtension = createExtension(({ editor }) => {
  const readView = () => activeRichEditorView(editor)

  const reopenComposedSlashCommand = (data: string) => {
    const suggestionMenu = editor.getExtension(SuggestionMenu)
    if (!suggestionMenu || suggestionMenu.shown()) return

    const view = readView()
    const command = composedSlashCommandRange(data, view)
    if (!view || !command) return

    view.dispatch(view.state.tr.delete(command.from, command.to))
    suggestionMenu.openSuggestionMenu('/', { deleteTriggerCharacter: true })

    const updatedView = readView()
    if (command.query && updatedView) {
      updatedView.dispatch(updatedView.state.tr.insertText(command.query))
    }
  }

  return {
    key: 'imeCompositionCompatibility',
    prosemirrorPlugins: [
      createSafariImeDomPreserverPlugin(),
      createMacosTauriImmediateEnterPlugin(),
      createComposedSlashCommandRecoveryPlugin(reopenComposedSlashCommand),
    ],
  } as const
})
