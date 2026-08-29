import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultEntry } from '../types'
import { mockInvoke } from '../mock-tauri'
import { PageReferences } from './PageReferences'

vi.mock('../mock-tauri', () => ({
  isTauri: () => false,
  mockInvoke: vi.fn(),
}))

vi.mock('../lib/productAnalytics', () => ({
  trackPageReferenceOpened: vi.fn(),
}))

const mockInvokeFn = vi.mocked(mockInvoke)

function entry(overrides: Partial<VaultEntry>): VaultEntry {
  const title = overrides.title ?? 'Untitled'
  return {
    path: overrides.path ?? `/vault/${title.toLowerCase().replaceAll(' ', '-')}.md`,
    filename: overrides.filename ?? `${title.toLowerCase().replaceAll(' ', '-')}.md`,
    title,
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1,
    createdAt: 1,
    fileSize: 10,
    snippet: '',
    wordCount: 1,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

describe('PageReferences', () => {
  beforeEach(() => {
    mockInvokeFn.mockReset()
  })

  it('shows neighborhood backlinks and keeps plain-text mentions in a separate collapsed section', async () => {
    const source = entry({ path: '/vault/alpha.md', title: 'Alpha', aliases: ['Project Alpha'] })
    const linked = entry({
      path: '/vault/linked.md',
      title: 'Linked note',
      snippet: 'A generic note summary.',
      outgoingLinks: ['Alpha'],
    })
    const outlineLinked = entry({
      path: '/vault/outline-linked.md',
      title: 'Outline source',
      display: 'outline',
      snippet: 'Another generic summary.',
      outgoingLinks: ['Alpha'],
    })
    const mentioned = entry({
      path: '/vault/mentioned.md',
      title: 'Mentioned note',
      snippet: 'We discussed Alpha without creating a link.',
    })
    const titleOnly = entry({
      path: '/vault/alpha-follow-up.md',
      title: 'Alpha follow-up',
      snippet: 'This body does not contain the target phrase.',
    })
    const entries = [source, linked, outlineLinked, mentioned, titleOnly]
    const onNavigate = vi.fn()

    mockInvokeFn.mockImplementation(async (command, args) => {
      if (command === 'get_note_content') {
        const path = String((args as Record<string, unknown>).path)
        if (path === linked.path) {
          return '# Linked note\n\nThe exact line points to [[Alpha]] during review.'
        }
        if (path === outlineLinked.path) {
          return [
            '---',
            '_display: outline',
            '---',
            '- Parent references [[Alpha]]',
            '  - Child decision',
            '    - Grandchild evidence',
            '- Unrelated sibling',
          ].join('\n')
        }
        if (path === mentioned.path) {
          return '# Mentioned note\n\nThe exact unlinked Alpha discussion happened here.'
        }
        return ''
      }
      const query = String((args as Record<string, unknown>).query)
      if (query !== 'Alpha') return { results: [], elapsed_ms: 1 }
      return {
        elapsed_ms: 1,
        results: entries.map((candidate) => ({
          path: candidate.path,
          score: 1,
          snippet: candidate === titleOnly ? '# Alpha follow-up' : candidate.snippet,
          title: candidate.title,
          note_type: candidate.isA,
        })),
      }
    })

    render(
      <PageReferences
        entries={entries}
        locale="en"
        onNavigate={onNavigate}
        sourceEntry={source}
        vaultPath="/vault"
      />,
    )

    expect(await screen.findByRole('button', { name: /Linked references.*2/i })).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => {
      expect(screen.getByText('Linked note').closest('button')).toHaveTextContent(
        /Linked note.*The exact line points to Alpha during review/i,
      )
      expect(screen.getByText('Outline source').closest('button')).toHaveTextContent(
        /Outline source.*Parent references Alpha.*Child decision.*Grandchild evidence/i,
      )
    })
    expect(screen.getByText('Child decision')).toBeVisible()
    expect(screen.getByText('Grandchild evidence')).toBeVisible()
    expect(screen.queryByText('Unrelated sibling')).not.toBeInTheDocument()

    const mentionsToggle = await screen.findByRole('button', { name: /Unlinked mentions.*1/i })
    expect(mentionsToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Mentioned note')).not.toBeInTheDocument()

    fireEvent.click(mentionsToggle)
    expect(screen.getByText('Mentioned note')).toBeVisible()
    expect(screen.getByText('Mentioned note').closest('button')).toHaveTextContent(
      /The exact unlinked Alpha discussion happened here/i,
    )
    expect(screen.queryByText('Alpha follow-up')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Mentioned note/i }))
    expect(onNavigate).toHaveBeenCalledWith('Mentioned note')
  })

  it('does not let a stale mention search replace references for a newly opened note', async () => {
    const alpha = entry({ path: '/vault/alpha.md', title: 'Alpha' })
    const beta = entry({ path: '/vault/beta.md', title: 'Beta' })
    const alphaMention = entry({
      path: '/vault/alpha-mention.md',
      title: 'Alpha mention',
      snippet: 'Alpha appears here.',
    })
    let resolveAlpha: ((value: unknown) => void) | undefined

    mockInvokeFn.mockImplementation(async (command, args) => {
      if (command === 'get_note_content') return ''
      const query = String((args as Record<string, unknown>).query)
      if (query === 'Alpha') {
        return new Promise((resolve) => {
          resolveAlpha = resolve
        })
      }
      return { results: [], elapsed_ms: 1 }
    })

    const { rerender } = render(
      <PageReferences
        entries={[alpha, beta, alphaMention]}
        locale="en"
        onNavigate={vi.fn()}
        sourceEntry={alpha}
        vaultPath="/vault"
      />,
    )

    await waitFor(() => expect(resolveAlpha).toBeTypeOf('function'))
    rerender(
      <PageReferences
        entries={[alpha, beta, alphaMention]}
        locale="en"
        onNavigate={vi.fn()}
        sourceEntry={beta}
        vaultPath="/vault"
      />,
    )

    resolveAlpha?.({
      elapsed_ms: 1,
      results: [{
        path: alphaMention.path,
        score: 1,
        snippet: alphaMention.snippet,
        title: alphaMention.title,
        note_type: alphaMention.isA,
      }],
    })

    await waitFor(() => expect(screen.queryByText('Alpha mention')).not.toBeInTheDocument())
  })

  it('loads exact linked context when unlinked mention search fails', async () => {
    const source = entry({ path: '/vault/alpha.md', title: 'Alpha' })
    const linked = entry({
      path: '/vault/linked.md',
      title: 'Linked note',
      snippet: 'Generic fallback.',
      outgoingLinks: ['Alpha'],
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockInvokeFn.mockImplementation(async (command) => {
      if (command === 'search_vault') throw new Error('Search unavailable')
      return '# Linked note\n\nExact fallback-safe [[Alpha]] reference.'
    })

    try {
      render(
        <PageReferences
          entries={[source, linked]}
          locale="en"
          onNavigate={vi.fn()}
          sourceEntry={source}
          vaultPath="/vault"
        />,
      )

      await waitFor(() => {
        expect(screen.getByText('Linked note').closest('button')).toHaveTextContent(
          /Exact fallback-safe Alpha reference/i,
        )
      })
    } finally {
      consoleError.mockRestore()
    }
  })
})
