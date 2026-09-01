import { describe, expect, it, vi } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, Plugin, TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import {
  createImeCompositionCompatibilityExtension,
  createMacosTauriImmediateEnterPlugin,
  createSafariImeDomPreserverPlugin,
} from './imeCompositionKeyGuardExtension'

function createEditorSchema() {
  return new Schema({
    nodes: {
      doc: { content: 'blockContainer+' },
      blockContainer: {
        attrs: { id: { default: null } },
        content: 'paragraph',
        toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      },
      paragraph: { content: 'text*', toDOM: () => ['p', 0] },
      text: {},
    },
  })
}

function createImmediateEnterFixture(enabled = true) {
  const schema = createEditorSchema()
  const enterHandler = vi.fn(() => true)
  const state = EditorState.create({
    doc: schema.node('doc', null, [
      schema.node('blockContainer', { id: 'current-block' }, [
        schema.node('paragraph', null, schema.text('中文输入')),
      ]),
      schema.node('blockContainer', { id: 'next-block' }, [
        schema.node('paragraph'),
      ]),
    ]),
    plugins: [
      createMacosTauriImmediateEnterPlugin(enabled),
      new Plugin({ props: { handleKeyDown: enterHandler } }),
    ],
    schema,
  })
  const container = document.createElement('div')
  const view = new EditorView(container, { state })

  return { enterHandler, view }
}

function dispatchComposingEnter(view: EditorView) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'Enter',
    key: 'Enter',
  })
  Object.defineProperty(event, 'isComposing', { value: true })
  view.dom.dispatchEvent(event)
}

describe('createMacosTauriImmediateEnterPlugin', () => {
  it('routes Enter to editor commands immediately after compositionend', () => {
    const fixture = createImmediateEnterFixture()

    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中文输入',
    }))
    fixture.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
    }))

    expect(fixture.enterHandler).toHaveBeenCalledTimes(1)
    fixture.view.destroy()
  })

  it('routes a composing Enter after composition reconciliation', () => {
    vi.useFakeTimers()
    const fixture = createImmediateEnterFixture()

    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    dispatchComposingEnter(fixture.view)
    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中文输入',
    }))
    vi.runAllTimers()

    expect(fixture.enterHandler).toHaveBeenCalledTimes(1)
    fixture.view.destroy()
    vi.useRealTimers()
  })

  it('leaves composition handling entirely upstream outside macOS Tauri', () => {
    vi.useFakeTimers()
    const fixture = createImmediateEnterFixture(false)

    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    dispatchComposingEnter(fixture.view)
    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    vi.runAllTimers()

    expect(fixture.enterHandler).not.toHaveBeenCalled()
    fixture.view.destroy()
    vi.useRealTimers()
  })

  it('does not create a second block when WebKit already moved the caret', () => {
    vi.useFakeTimers()
    const fixture = createImmediateEnterFixture()

    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    dispatchComposingEnter(fixture.view)
    fixture.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    fixture.view.dispatch(fixture.view.state.tr.setSelection(
      TextSelection.atEnd(fixture.view.state.doc),
    ))
    vi.runAllTimers()

    expect(fixture.enterHandler).not.toHaveBeenCalled()
    fixture.view.destroy()
    vi.useRealTimers()
  })
})

describe('createImeCompositionCompatibilityExtension', () => {
  it('recovers a slash command through ProseMirror composition events without DOM capture guards', () => {
    vi.useFakeTimers()
    const transaction = {
      delete: vi.fn(),
      insertText: vi.fn(),
    }
    transaction.delete.mockReturnValue(transaction)
    transaction.insertText.mockReturnValue(transaction)
    const view = {
      dispatch: vi.fn(),
      state: {
        doc: { textBetween: vi.fn(() => '/table') },
        selection: { empty: true, from: 7, to: 7 },
        tr: transaction,
      },
    }
    const suggestionMenu = {
      openSuggestionMenu: vi.fn(),
      shown: vi.fn(() => false),
    }
    const editor = {
      _tiptapEditor: { view },
      getExtension: vi.fn(() => suggestionMenu),
      prosemirrorView: view,
    }
    const extension = createImeCompositionCompatibilityExtension()({ editor: editor as never })
    const recoveryPlugin = extension.prosemirrorPlugins?.find((plugin) => (
      plugin.key.startsWith('tolariaComposedSlashCommandRecovery')
    ))

    expect(extension.mount).toBeUndefined()
    expect(recoveryPlugin).toBeDefined()
    recoveryPlugin?.props.handleDOMEvents?.compositionend?.(
      view as never,
      { data: '/table' } as CompositionEvent,
    )
    vi.runAllTimers()

    expect(transaction.delete).toHaveBeenCalledWith(1, 7)
    expect(suggestionMenu.openSuggestionMenu).toHaveBeenCalledWith('/', {
      deleteTriggerCharacter: true,
    })
    expect(transaction.insertText).toHaveBeenCalledWith('table')
    expect(view.dispatch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('createSafariImeDomPreserverPlugin', () => {
  it('keeps an out-of-model sentinel beside composing text until WebKit finishes the commit', () => {
    const schema = new Schema({
      nodes: {
        doc: { content: 'paragraph+' },
        paragraph: { content: 'text*', toDOM: () => ['p', 0] },
        text: {},
      },
    })
    const plugin = createSafariImeDomPreserverPlugin(true)
    const state = EditorState.create({ schema, plugins: [plugin] })
    const container = document.createElement('div')
    const view = new EditorView(container, { state })

    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    view.dispatch(view.state.tr.insertText("ce'shi"))

    const sentinel = container.querySelector('[data-tolaria-ime-dom-preserver]')
    expect(sentinel).not.toBeNull()
    expect(sentinel?.textContent).toBe('\u200B')
    expect(view.state.doc.textContent).toBe("ce'shi")

    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '测试' }))
    view.dispatch(view.state.tr.setMeta('ime-test-refresh', true))

    expect(container.querySelector('[data-tolaria-ime-dom-preserver]')).toBeNull()
    expect(view.state.doc.textContent).toBe("ce'shi")
    view.destroy()
  })
})
