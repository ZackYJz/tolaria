import { advanceMarkdownFence, type MarkdownFence } from './markdownFences'
import { splitFrontmatter } from './wikilinks'

export type PageReferenceKind = 'linked' | 'mention'

export interface PageReferenceContextLine {
  depth: number
  marker: string | null
  matched: boolean
  text: string
}

export interface PageReferenceContext {
  lines: PageReferenceContextLine[]
}

interface ExtractPageReferenceContextsOptions {
  content: string
  kind: PageReferenceKind
  outline: boolean
  targets: string[]
}

interface ParsedListLine {
  indent: number
  marker: string
  text: string
}

interface SourceLine {
  fenced: boolean
  index: number
  raw: string
}

const LIST_ITEM_PATTERN = /^([\t ]*)([-+*]|\d+\.)\s+(.*)$/u
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/gu
const TAB_INDENT_WIDTH = 2

function indentationWidth(value: string): number {
  return [...value].reduce((width, character) => (
    width + (character === '\t' ? TAB_INDENT_WIDTH : 1)
  ), 0)
}

function parseListLine(line: string): ParsedListLine | null {
  const match = LIST_ITEM_PATTERN.exec(line)
  if (!match) return null
  return {
    indent: indentationWidth(match[1]),
    marker: match[2],
    text: match[3].trim(),
  }
}

function wikilinkTarget(value: string): string {
  return value.split('|')[0].trim()
}

function normalizedTargets(targets: string[]): Set<string> {
  return new Set(targets.map((target) => target.trim().toLocaleLowerCase()).filter(Boolean))
}

function linkedLineMatches(line: string, targets: Set<string>): boolean {
  WIKILINK_PATTERN.lastIndex = 0
  let match = WIKILINK_PATTERN.exec(line)
  while (match) {
    const target = wikilinkTarget(match[1]).toLocaleLowerCase()
    const finalSegment = target.split('/').pop() ?? target
    if (targets.has(target) || targets.has(finalSegment)) return true
    match = WIKILINK_PATTERN.exec(line)
  }
  return false
}

function mentionLineMatches(line: string, targets: Set<string>): boolean {
  const withoutWikilinks = line.replace(WIKILINK_PATTERN, '').toLocaleLowerCase()
  return [...targets].some((target) => withoutWikilinks.includes(target))
}

function lineMatches(line: string, kind: PageReferenceKind, targets: Set<string>): boolean {
  return kind === 'linked'
    ? linkedLineMatches(line, targets)
    : mentionLineMatches(line, targets)
}

function sourceLines(content: string): SourceLine[] {
  const [, body] = splitFrontmatter(content)
  const lines = body.split(/\r?\n/u)
  let fence: MarkdownFence | null = null
  let firstContentLineSeen = false

  return lines.map((raw, index) => {
    const nextFence = advanceMarkdownFence(raw, fence, { maxLeadingSpaces: null })
    const fenced = fence !== null || nextFence !== null
    fence = nextFence

    if (!firstContentLineSeen && raw.trim()) {
      firstContentLineSeen = true
      if (/^\s*#\s+/u.test(raw)) return { fenced: true, index, raw }
    }
    return { fenced, index, raw }
  })
}

function plainContextLine(raw: string): PageReferenceContextLine {
  const listLine = parseListLine(raw)
  return {
    depth: 0,
    marker: listLine?.marker ?? null,
    matched: true,
    text: listLine?.text ?? raw.trim(),
  }
}

function outlineSubtree(lines: SourceLine[], rootIndex: number): PageReferenceContext {
  const root = parseListLine(lines[rootIndex].raw)
  if (!root) return { lines: [plainContextLine(lines[rootIndex].raw)] }

  const descendants: Array<{ list: ParsedListLine | null, raw: string }> = []
  for (let index = rootIndex + 1; index < lines.length; index++) {
    const raw = lines[index].raw
    if (!raw.trim()) continue
    const list = parseListLine(raw)
    const indent = list?.indent ?? indentationWidth(raw.match(/^[\t ]*/u)?.[0] ?? '')
    if (indent <= root.indent) break
    descendants.push({ list, raw })
  }

  const nestedIndents = [...new Set(
    descendants.map(({ list }) => list?.indent).filter((indent): indent is number => indent !== undefined),
  )].sort((left, right) => left - right)
  const contextLines: PageReferenceContextLine[] = [{
    depth: 0,
    marker: root.marker,
    matched: true,
    text: root.text,
  }]

  for (const descendant of descendants) {
    if (descendant.list) {
      contextLines.push({
        depth: Math.max(1, nestedIndents.indexOf(descendant.list.indent) + 1),
        marker: descendant.list.marker,
        matched: false,
        text: descendant.list.text,
      })
      continue
    }

    const text = descendant.raw.trim()
    if (!text || /^(`{3,}|~{3,})/u.test(text)) continue
    const indent = indentationWidth(descendant.raw.match(/^[\t ]*/u)?.[0] ?? '')
    const depth = Math.max(1, nestedIndents.filter((nestedIndent) => nestedIndent <= indent).length)
    contextLines.push({ depth, marker: null, matched: false, text })
  }

  return { lines: contextLines }
}

export function extractPageReferenceContexts({
  content,
  kind,
  outline,
  targets,
}: ExtractPageReferenceContextsOptions): PageReferenceContext[] {
  const normalized = normalizedTargets(targets)
  if (!content || normalized.size === 0) return []

  const lines = sourceLines(content)
  const contexts: PageReferenceContext[] = []
  for (const line of lines) {
    if (line.fenced || !lineMatches(line.raw, kind, normalized)) continue
    contexts.push(outline
      ? outlineSubtree(lines, line.index)
      : { lines: [plainContextLine(line.raw)] })
  }
  return contexts
}
