import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import { invoke } from '@tauri-apps/api/core'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import { trackPageReferenceOpened } from '../lib/productAnalytics'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { normalizeNotePathForIdentity } from '../utils/notePathIdentity'
import { buildRelationshipGroups } from '../utils/noteListHelpers'
import {
  extractPageReferenceContexts,
  type PageReferenceContext,
  type PageReferenceContextLine,
} from '../utils/pageReferenceContext'
import { vaultPathForEntry } from '../utils/workspaces'
import { Button } from './ui/button'
import { NoteTitleIcon } from './NoteTitleIcon'

type ReferenceKind = 'linked' | 'mention'
type SearchState = 'idle' | 'loading' | 'loaded'

interface SearchResultData {
  path: string
  snippet: string
}

interface SearchResponseData {
  results: SearchResultData[]
}

interface ReferenceItem {
  contexts: PageReferenceContext[]
  entry: VaultEntry
}

interface MentionSearchResult {
  contextsByPath: Map<string, PageReferenceContext[]>
  mentions: ReferenceItem[]
}

interface MentionCandidate {
  context: string
  entry: VaultEntry
}

interface PageReferencesProps {
  entries: VaultEntry[]
  locale?: AppLocale
  onNavigate: (target: string) => void
  sourceEntry: VaultEntry
  vaultPath: string
}

const BACKLINK_GROUP_LABEL = 'Backlinks'
const REFERENCE_SEARCH_MINIMUM_LIMIT = 50
const REFERENCE_CONTENT_BATCH_SIZE = 8
const REFERENCE_CONTEXT_INDENT_PX = 18
const REFERENCE_VIEWPORT_MARGIN = '600px 0px'
const MARKDOWN_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu

function referenceTargets(entry: VaultEntry): string[] {
  return [...new Set([entry.title, ...entry.aliases].map((target) => target.trim()).filter(Boolean))]
}

function referenceVaultPaths(entries: VaultEntry[], fallbackVaultPath: string): string[] {
  return [...new Set([
    fallbackVaultPath,
    ...entries.map((entry) => entry.workspace?.path ?? ''),
  ].map((path) => path.trim()).filter(Boolean))]
}

function normalizeContext(context: string): string {
  return context
    .replace(MARKDOWN_LINK_PATTERN, (_match, target: string, label: string | undefined) => label ?? target)
    .trim()
}

function snippetContainsTarget(snippet: string, targets: string[]): boolean {
  const normalizedSnippet = snippet.toLocaleLowerCase()
  return targets.some((target) => normalizedSnippet.includes(target.toLocaleLowerCase()))
}

function snippetIsEntryTitle(snippet: string, entry: VaultEntry): boolean {
  const withoutHeadingMarker = snippet.replace(/^#{1,6}\s+/u, '').trim()
  return withoutHeadingMarker.localeCompare(entry.title, undefined, { sensitivity: 'accent' }) === 0
}

function searchVault(vaultPath: string, query: string, limit: number): Promise<SearchResponseData> {
  const args = {
    vaultPath,
    query,
    mode: 'keyword',
    limit,
    excludeFrontmatter: true,
  }
  return isTauri()
    ? invoke<SearchResponseData>('search_vault', args)
    : mockInvoke<SearchResponseData>('search_vault', args)
}

function getNoteContent(entry: VaultEntry, fallbackVaultPath: string): Promise<string> {
  const args = {
    path: entry.path,
    vaultPath: vaultPathForEntry(entry, fallbackVaultPath),
  }
  return isTauri()
    ? invoke<string>('get_note_content', args)
    : mockInvoke<string>('get_note_content', args)
}

function fallbackContexts(context: string): PageReferenceContext[] {
  const text = normalizeContext(context)
  return text
    ? [{ lines: [{ depth: 0, marker: null, matched: true, text }] }]
    : []
}

async function loadReferenceContexts(options: {
  entries: VaultEntry[]
  kind: ReferenceKind
  targets: string[]
  vaultPath: string
}): Promise<Map<string, PageReferenceContext[]>> {
  const { entries, kind, targets, vaultPath } = options
  const contexts = new Map<string, PageReferenceContext[]>()

  for (let offset = 0; offset < entries.length; offset += REFERENCE_CONTENT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + REFERENCE_CONTENT_BATCH_SIZE)
    const results = await Promise.all(batch.map(async (entry) => {
      try {
        const content = await getNoteContent(entry, vaultPath)
        return {
          contexts: extractPageReferenceContexts({
            content,
            kind,
            outline: entry.display === 'outline',
            targets,
          }),
          entry,
        }
      } catch (error) {
        console.error(`Failed to load reference context for ${entry.path}:`, error)
        return { contexts: [], entry }
      }
    }))

    for (const result of results) {
      if (result.contexts.length > 0) {
        contexts.set(normalizeNotePathForIdentity(result.entry.path), result.contexts)
      }
    }
  }
  return contexts
}

function searchResultsByPath(responses: SearchResponseData[]): Map<string, SearchResultData> {
  const results = new Map<string, SearchResultData>()
  for (const result of responses.flatMap((response) => response.results)) {
    const path = normalizeNotePathForIdentity(result.path)
    const existing = results.get(path)
    if (!existing || (!existing.snippet && result.snippet)) results.set(path, result)
  }
  return results
}

async function findMentions(options: {
  entries: VaultEntry[]
  linkedEntries: VaultEntry[]
  linkedPaths: Set<string>
  sourceEntry: VaultEntry
  vaultPath: string
}): Promise<MentionSearchResult> {
  const { entries, linkedEntries, linkedPaths, sourceEntry, vaultPath } = options
  const targets = referenceTargets(sourceEntry)
  const vaultPaths = referenceVaultPaths(entries, vaultPath)
  const limit = Math.max(entries.length * 2, REFERENCE_SEARCH_MINIMUM_LIMIT)
  let responses: SearchResponseData[] = []
  try {
    responses = await Promise.all(
      vaultPaths.flatMap((path) => targets.map((target) => searchVault(path, target, limit))),
    )
  } catch (error) {
    console.error('Failed to search unlinked mentions:', error)
  }
  const resultsByPath = searchResultsByPath(responses)
  const sourcePath = normalizeNotePathForIdentity(sourceEntry.path)
  const searchContextsByPath = new Map<string, string>()
  const mentionCandidates: MentionCandidate[] = []

  for (const entry of entries) {
    const path = normalizeNotePathForIdentity(entry.path)
    const result = resultsByPath.get(path)
    if (!result || path === sourcePath) continue

    const context = normalizeContext(result.snippet)
    if (context) searchContextsByPath.set(path, context)
    if (
      linkedPaths.has(path)
      || snippetIsEntryTitle(context, entry)
      || !snippetContainsTarget(context, targets)
    ) continue
    mentionCandidates.push({ context, entry })
  }

  mentionCandidates.sort((left, right) => (right.entry.modifiedAt ?? 0) - (left.entry.modifiedAt ?? 0))
  const [linkedContexts, mentionContexts] = await Promise.all([
    loadReferenceContexts({ entries: linkedEntries, kind: 'linked', targets, vaultPath }),
    loadReferenceContexts({
      entries: mentionCandidates.map(({ entry }) => entry),
      kind: 'mention',
      targets,
      vaultPath,
    }),
  ])
  const contextsByPath = new Map<string, PageReferenceContext[]>()
  for (const [path, context] of searchContextsByPath) contextsByPath.set(path, fallbackContexts(context))
  for (const [path, context] of linkedContexts) contextsByPath.set(path, context)
  for (const [path, context] of mentionContexts) contextsByPath.set(path, context)
  const mentions = mentionCandidates.map(({ context, entry }) => ({
    contexts: contextsByPath.get(normalizeNotePathForIdentity(entry.path)) ?? fallbackContexts(context),
    entry,
  }))
  return { contextsByPath, mentions }
}

function useNearViewport() {
  const anchorRef = useRef<HTMLElement | null>(null)
  const [nearViewport, setNearViewport] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || typeof IntersectionObserver === 'undefined') return
    const scrollRoot = anchor.closest('.editor-scroll-area')
    if (!scrollRoot) {
      let current = true
      queueMicrotask(() => {
        if (current) setNearViewport(true)
      })
      return () => {
        current = false
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setNearViewport(true)
    }, {
      root: scrollRoot,
      rootMargin: REFERENCE_VIEWPORT_MARGIN,
    })
    observer.observe(anchor)
    return () => observer.disconnect()
  }, [])

  return { anchorRef, nearViewport }
}

function linkedReferenceEntries(sourceEntry: VaultEntry, entries: VaultEntry[]): VaultEntry[] {
  return buildRelationshipGroups(sourceEntry, entries)
    .find((group) => group.label === BACKLINK_GROUP_LABEL)?.entries ?? []
}

function usePageReferenceItems(
  sourceEntry: VaultEntry,
  entries: VaultEntry[],
  vaultPath: string,
  active: boolean,
) {
  const linkedEntries = useMemo(
    () => linkedReferenceEntries(sourceEntry, entries),
    [entries, sourceEntry],
  )
  const linkedPaths = useMemo(
    () => new Set(linkedEntries.map((entry) => normalizeNotePathForIdentity(entry.path))),
    [linkedEntries],
  )
  const [search, setSearch] = useState<{
    contextsByPath: Map<string, PageReferenceContext[]>
    mentions: ReferenceItem[]
    sourcePath: string
    state: SearchState
  }>({
    contextsByPath: new Map(),
    mentions: [],
    sourcePath: sourceEntry.path,
    state: 'idle',
  })

  useEffect(() => {
    if (!active) return
    let current = true
    void findMentions({ entries, linkedEntries, linkedPaths, sourceEntry, vaultPath })
      .then((result) => {
        if (!current) return
        setSearch({ ...result, sourcePath: sourceEntry.path, state: 'loaded' })
      })
      .catch((error) => {
        if (!current) return
        console.error('Failed to load page references:', error)
        setSearch({ contextsByPath: new Map(), mentions: [], sourcePath: sourceEntry.path, state: 'loaded' })
      })
    return () => {
      current = false
    }
  }, [active, entries, linkedEntries, linkedPaths, sourceEntry, vaultPath])

  const currentSearch = search.sourcePath === sourceEntry.path ? search : null
  const linked = linkedEntries.map((entry) => {
    const path = normalizeNotePathForIdentity(entry.path)
    return {
      contexts: currentSearch?.contextsByPath.get(path) ?? fallbackContexts(entry.snippet),
      entry,
    }
  })

  return {
    linked,
    mentions: currentSearch?.mentions ?? [],
    searchState: currentSearch?.state ?? (active ? 'loading' : 'idle'),
  }
}

function ReferenceContextMarker({ line }: { line: PageReferenceContextLine }) {
  if (!line.marker) return <span aria-hidden="true" className="w-3 shrink-0" />
  if (/^\d+\.$/u.test(line.marker)) {
    return <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{line.marker}</span>
  }
  return (
    <span aria-hidden="true" className="mt-[7px] flex w-3 shrink-0 justify-center">
      <span className={`size-1.5 rounded-full ${line.matched ? 'bg-foreground/55' : 'bg-muted-foreground/45'}`} />
    </span>
  )
}

function ReferenceContextPreview({
  contexts,
  targets,
}: {
  contexts: PageReferenceContext[]
  targets: string[]
}) {
  return (
    <span className="flex min-w-0 flex-col gap-2 whitespace-normal text-xs font-normal leading-5">
      {contexts.map((context, contextIndex) => (
        <span
          key={`${contextIndex}:${context.lines[0]?.text ?? ''}`}
          className={`flex min-w-0 flex-col ${contextIndex > 0 ? 'border-t border-border/50 pt-2' : ''}`}
        >
          {context.lines.map((line, lineIndex) => (
            <span
              key={`${lineIndex}:${line.text}`}
              className={`flex min-w-0 items-start gap-1.5 ${line.matched ? 'text-foreground/85' : 'text-muted-foreground'}`}
              style={{ paddingInlineStart: line.depth * REFERENCE_CONTEXT_INDENT_PX }}
            >
              <ReferenceContextMarker line={line} />
              <span className="min-w-0 flex-1 break-words text-left">
                <HighlightedContext context={normalizeContext(line.text)} targets={targets} />
              </span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

function HighlightedContext({ context, targets }: { context: string; targets: string[] }) {
  const target = targets
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => context.toLocaleLowerCase().includes(candidate.toLocaleLowerCase()))
  if (!target) return context

  const index = context.toLocaleLowerCase().indexOf(target.toLocaleLowerCase())
  return (
    <>
      {context.slice(0, index)}
      <mark className="rounded-[2px] bg-accent px-0.5 text-inherit">{context.slice(index, index + target.length)}</mark>
      {context.slice(index + target.length)}
    </>
  )
}

function ReferenceEntryButton({
  item,
  kind,
  onNavigate,
  targets,
}: {
  item: ReferenceItem
  kind: ReferenceKind
  onNavigate: (target: string) => void
  targets: string[]
}) {
  const handleNavigate = () => {
    trackPageReferenceOpened(kind)
    onNavigate(item.entry.title)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto min-h-10 w-full min-w-0 items-start justify-start rounded-md px-2 py-2 text-left transition-[background-color,color,transform] active:scale-[0.99]"
      onClick={handleNavigate}
    >
      <NoteTitleIcon icon={item.entry.icon} size={15} className="mt-0.5 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[13px] font-medium leading-5 text-foreground">
          {item.entry.title}
        </span>
        {item.contexts.length > 0 ? <ReferenceContextPreview contexts={item.contexts} targets={targets} /> : null}
      </span>
    </Button>
  )
}

function ReferenceSection({
  defaultOpen,
  items,
  kind,
  onNavigate,
  targets,
  title,
}: {
  defaultOpen: boolean
  items: ReferenceItem[]
  kind: ReferenceKind
  onNavigate: (target: string) => void
  targets: string[]
  title: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        className="-mx-2 h-9 w-[calc(100%+1rem)] justify-start rounded-md px-2 text-sm font-semibold text-foreground transition-[background-color,color,transform] active:scale-[0.995]"
        onClick={() => setOpen((current) => !current)}
      >
        <CaretRight
          aria-hidden="true"
          size={14}
          weight="bold"
          className={open ? 'rotate-90 text-muted-foreground' : 'text-muted-foreground'}
        />
        <span>{title}</span>
        <span className="tabular-nums text-xs font-normal text-muted-foreground">{items.length}</span>
      </Button>
      {open ? (
        <div className="ml-1 flex flex-col gap-0.5 border-l border-border/70 pl-4" data-testid={`${kind}-references-list`}>
          {items.map((item) => (
            <ReferenceEntryButton
              key={item.entry.path}
              item={item}
              kind={kind}
              onNavigate={onNavigate}
              targets={targets}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PageReferences({
  entries,
  locale = 'en',
  onNavigate,
  sourceEntry,
  vaultPath,
}: PageReferencesProps) {
  const { anchorRef, nearViewport } = useNearViewport()
  const { linked, mentions, searchState } = usePageReferenceItems(
    sourceEntry,
    entries,
    vaultPath,
    nearViewport,
  )
  const targets = referenceTargets(sourceEntry)
  const showLinked = linked.length > 0
  const showMentions = searchState === 'loaded' && mentions.length > 0

  if (!showLinked && !showMentions) {
    return <section ref={anchorRef} aria-hidden="true" className="h-[var(--editor-scroll-tail-height)] shrink-0" />
  }

  return (
    <section
      ref={anchorRef}
      className="relative z-[1] mt-14 flex shrink-0 flex-col gap-1 border-t border-border/70 bg-background pb-[var(--editor-scroll-tail-height)] pt-4"
      data-note-pdf-export-exclude="true"
      data-testid="page-references"
    >
      {showLinked ? (
        <ReferenceSection
          key={`linked:${sourceEntry.path}`}
          defaultOpen
          items={linked}
          kind="linked"
          onNavigate={onNavigate}
          targets={targets}
          title={translate(locale, 'editor.references.linked')}
        />
      ) : null}
      {showMentions ? (
        <ReferenceSection
          key={`mention:${sourceEntry.path}`}
          defaultOpen={false}
          items={mentions}
          kind="mention"
          onNavigate={onNavigate}
          targets={targets}
          title={translate(locale, 'editor.references.unlinkedMentions')}
        />
      ) : null}
    </section>
  )
}
