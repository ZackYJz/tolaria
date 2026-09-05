import './WebBookmarkBlock.css'
import { createReactBlockSpec } from '@blocknote/react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { isTauri, mockInvoke } from '../mock-tauri'
import { useAppLocale } from '../hooks/useAppPreferences'
import { translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { BOOKMARK_BLOCK_TYPE, normalizeBookmarkUrl } from '../utils/bookmarkMarkdown'
import { openExternalUrl } from '../utils/url'
import { dispatchRichEditorExternalChange } from './editorExternalChangeEvents'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface BookmarkValue {
  url: string
  title: string
  description: string
  image: string
  favicon: string
}

function BookmarkImage({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false)
  const safeUrl = normalizeBookmarkUrl(src)
  if (!safeUrl || failed) return null
  return <img src={safeUrl} alt="" className={className} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

interface BookmarkViewProps {
  value: BookmarkValue
  onSave: (value: BookmarkValue) => void
}

export function WebBookmarkView(props: BookmarkViewProps) {
  return <BookmarkEditorView key={JSON.stringify(props.value)} {...props} />
}

function BookmarkEditorView({ value, onSave }: BookmarkViewProps) {
  const locale = useAppLocale()
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  const [editing, setEditing] = useState(!value.url)
  const [draft, setDraft] = useState(value.url)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!editing) return
    // BlockNote restores editor selection after inserting a slash-menu block.
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing])
  const request = useRef(0)
  useEffect(() => () => { request.current += 1 }, [])
  const url = normalizeBookmarkUrl(value.url)

  function cancelEdit() {
    request.current += 1
    setBusy(false)
    setEditing(false)
    setError('')
  }

  async function createBookmark() {
    const nextUrl = normalizeBookmarkUrl(draft)
    if (!nextUrl) { setError(t('editor.bookmark.invalidUrl')); return }
    const currentRequest = ++request.current
    setBusy(true)
    setError('')
    try {
      const metadata = await (isTauri() ? invoke : mockInvoke)<BookmarkValue>('get_bookmark_metadata', { url: nextUrl })
      if (request.current !== currentRequest) return
      if (!metadata || !['title', 'description', 'image', 'favicon'].every(key => typeof Reflect.get(metadata, key) === 'string')) throw new Error('Invalid bookmark metadata')
      onSave({ url: nextUrl, title: metadata.title, description: metadata.description || '', image: normalizeBookmarkUrl(metadata.image || ''), favicon: normalizeBookmarkUrl(metadata.favicon || '') })
      setEditing(false)
      trackEvent('editor_web_bookmark_created')
    } catch {
      if (request.current === currentRequest) setError(t('editor.bookmark.fetchFailed'))
    } finally {
      if (request.current === currentRequest) setBusy(false)
    }
  }

  return <div className="tolaria-bookmark" contentEditable={false}>
    {editing ? <form className="tolaria-bookmark__form" onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (value.url) { event.preventDefault(); cancelEdit() }
    }} onSubmit={event => { event.preventDefault(); void createBookmark() }}>
      <label className="tolaria-bookmark__label">
        {t('editor.slash.bookmark')}
        <Input ref={input} autoFocus value={draft} placeholder="https://…" aria-label={t('editor.bookmark.url')} disabled={busy} onChange={event => setDraft(event.target.value)} />
      </label>
      <div className="tolaria-bookmark__actions">
        <Button type="submit" size="sm" disabled={busy}>{t(busy ? 'editor.bookmark.loading' : 'editor.bookmark.create')}</Button>
        {value.url && <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>{t('editor.bookmark.cancel')}</Button>}
        {error && normalizeBookmarkUrl(draft) && <Button type="button" size="sm" variant="outline" onClick={() => {
          onSave({ url: normalizeBookmarkUrl(draft), title: '', description: '', image: '', favicon: '' })
          setEditing(false)
          setError('')
          trackEvent('editor_web_bookmark_created', { preview: 'unavailable' })
        }}>{t('editor.bookmark.saveLink')}</Button>}
      </div>
      {error && <p role="alert" className="tolaria-bookmark__error">{error}</p>}
    </form> : <>
      <a className="tolaria-bookmark__card" href={url || undefined} target="_blank" rel="noopener noreferrer" onClick={event => {
        event.preventDefault()
        if (url) void openExternalUrl(url).catch(() => setError(t('editor.bookmark.openFailed')))
      }}>
        <div className="tolaria-bookmark__content">
          <div className="tolaria-bookmark__title">{value.title || url}</div>
          {value.description && <div className="tolaria-bookmark__description">{value.description}</div>}
          <div className="tolaria-bookmark__address">
            <BookmarkImage key={value.favicon} src={value.favicon} className="tolaria-bookmark__favicon" />
            <span>{url}</span>
          </div>
        </div>
        <BookmarkImage key={value.image} src={value.image} className="tolaria-bookmark__image" />
      </a>
      <Button className="tolaria-bookmark__edit" type="button" size="sm" variant="secondary" onClick={() => { setDraft(value.url); setEditing(true) }}>{t('editor.bookmark.edit')}</Button>
      {error && <p role="alert">{error}</p>}
    </>}
  </div>
}

export const WebBookmarkBlockSpec = createReactBlockSpec({
  type: BOOKMARK_BLOCK_TYPE,
  propSchema: { url: { default: '' }, title: { default: '' }, description: { default: '' }, image: { default: '' }, favicon: { default: '' } },
  content: 'none',
}, {
  meta: { selectable: false },
  render: ({ block, editor }) => <WebBookmarkView value={block.props} onSave={props => {
    if (!editor.getBlock(block.id)) return
    editor.updateBlock(block, { props })
    dispatchRichEditorExternalChange(editor)
  }} />,
})
