import type { BlockLike, InlineItem } from './durableMarkdownBlocks'

export const TOGGLE_BLOCK_TYPE = 'toggleListItem'

const TOGGLE_TOKEN_PREFIX = 'TOLARIA-TOGGLE-START:'
const TOGGLE_TOKEN_SUFFIX = ':END'
const DETAILS_OPEN_RE = /^ {0,3}<details(?:\s+open(?:=(?:""|''|open))?)?\s*>\s*$/iu
const DETAILS_CLOSE_RE = /^ {0,3}<\/details>\s*$/iu
const SUMMARY_RE = /^\s*<summary>([\s\S]*)<\/summary>\s*$/iu
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/u
const MARKDOWN_ACTIVE_URI_CHARACTERS = /[!'()*_~]/gu

type ToggleSerializationOptions = {
  blocks: unknown[]
  serializeBlocks: (blocks: unknown[]) => string
  serializeOrdinaryBlocks: (blocks: unknown[]) => string
}

function encodeTitle(title: string): string {
  return encodeURIComponent(title).replace(
    MARKDOWN_ACTIVE_URI_CHARACTERS,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function readEncodedTitle(token: string): { length: number; title: string } | null {
  if (!token.startsWith(TOGGLE_TOKEN_PREFIX)) return null
  const suffixIndex = token.indexOf(TOGGLE_TOKEN_SUFFIX, TOGGLE_TOKEN_PREFIX.length)
  if (suffixIndex === -1) return null

  try {
    const title = decodeURIComponent(token.slice(TOGGLE_TOKEN_PREFIX.length, suffixIndex))
    const tokenLength = suffixIndex + TOGGLE_TOKEN_SUFFIX.length
    return {
      length: token.charAt(tokenLength) === '\n' ? tokenLength + 1 : tokenLength,
      title,
    }
  } catch {
    return null
  }
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/gu, '')
    .replace(/&#(\d+);/gu, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&#x([\da-f]+);/giu, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fenceCharacter(line: string): string | null {
  return FENCE_RE.exec(line)?.at(1)?.charAt(0) ?? null
}

function closingDetailsIndex(lines: string[], openingIndex: number): number {
  let depth = 0
  let activeFence: string | null = null

  for (let index = openingIndex; index < lines.length; index += 1) {
    const line = lines.at(index) ?? ''
    const fence = fenceCharacter(line)
    if (fence) {
      activeFence = activeFence === fence ? null : activeFence ?? fence
      continue
    }
    if (activeFence) continue
    if (DETAILS_OPEN_RE.test(line)) depth += 1
    if (!DETAILS_CLOSE_RE.test(line)) continue
    depth -= 1
    if (depth === 0) return index
  }

  return -1
}

function summaryLineIndex(lines: string[], openingIndex: number, closingIndex: number): number {
  for (let index = openingIndex + 1; index < closingIndex; index += 1) {
    const line = lines.at(index) ?? ''
    if (!line.trim()) continue
    return SUMMARY_RE.test(line) ? index : -1
  }
  return -1
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines.at(start)?.trim()) start += 1
  while (end > start && !lines.at(end - 1)?.trim()) end -= 1
  return lines.slice(start, end)
}

export function preProcessToggleMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let activeFence: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines.at(index) ?? ''
    const fence = fenceCharacter(line)
    if (fence) {
      activeFence = activeFence === fence ? null : activeFence ?? fence
      output.push(line)
      continue
    }
    if (activeFence || !DETAILS_OPEN_RE.test(line)) {
      output.push(line)
      continue
    }

    const closingIndex = closingDetailsIndex(lines, index)
    const summaryIndex = closingIndex === -1 ? -1 : summaryLineIndex(lines, index, closingIndex)
    const summaryMatch = summaryIndex === -1 ? null : SUMMARY_RE.exec(lines.at(summaryIndex) ?? '')
    if (closingIndex === -1 || !summaryMatch) {
      output.push(line)
      continue
    }

    const title = decodeHtmlText(summaryMatch.at(1) ?? '')
    const bodyLines = trimBlankEdges(lines.slice(summaryIndex + 1, closingIndex))
    const body = preProcessToggleMarkdown(bodyLines.join('\n'))
    const indent = line.match(/^ */u)?.at(0) ?? ''
    output.push(`${indent}- ${TOGGLE_TOKEN_PREFIX}${encodeTitle(title)}${TOGGLE_TOKEN_SUFFIX}`)
    if (body) output.push(...body.split('\n').map(bodyLine => `${indent}    ${bodyLine.slice(indent.length)}`))
    index = closingIndex
  }

  return output.join('\n')
}

function inlineText(item: InlineItem): string {
  if (item.type === 'text' && typeof item.text === 'string') return item.text
  if (!Array.isArray(item.content)) return ''
  return (item.content as InlineItem[]).map(inlineText).join('')
}

function blockTitle(block: BlockLike): string {
  return Array.isArray(block.content) ? block.content.map(inlineText).join('') : ''
}

function dropInlineTextPrefix(content: InlineItem[], count: number): InlineItem[] {
  let remaining = count
  const result: InlineItem[] = []
  for (const item of content) {
    if (remaining === 0) {
      result.push(item)
      continue
    }
    if (item.type !== 'text' || typeof item.text !== 'string') continue
    if (item.text.length <= remaining) {
      remaining -= item.text.length
      continue
    }
    result.push({ ...item, text: item.text.slice(remaining) })
    remaining = 0
  }
  return result
}

function injectToggleMarkdownBlock(block: BlockLike): BlockLike {
  const children = Array.isArray(block.children)
    ? injectToggleMarkdownBlocks(block.children) as BlockLike[]
    : []
  const token = block.type === 'bulletListItem' && Array.isArray(block.content)
    ? readEncodedTitle(blockTitle(block))
    : null
  if (!token) return { ...block, children }

  const remainingContent = dropInlineTextPrefix(block.content ?? [], token.length)
  const bodyChildren = remainingContent.length > 0
    ? [{ content: remainingContent, children: [], props: {}, type: 'paragraph' }]
    : []
  return buildToggleBlock(block, token.title, [...bodyChildren, ...children])
}

function buildToggleBlock(block: BlockLike, title: string, children: BlockLike[]): BlockLike {
  return {
    ...block,
    children,
    content: title ? [{ type: 'text', text: title, styles: {} }] : [],
    type: TOGGLE_BLOCK_TYPE,
  }
}

export function injectToggleMarkdownBlocks(blocks: unknown[]): unknown[] {
  return (blocks as BlockLike[]).map(injectToggleMarkdownBlock)
}

export function isToggleMarkdownBlock(block: BlockLike): boolean {
  return block.type === TOGGLE_BLOCK_TYPE
}

function hasToggleMarkdownBlock(block: BlockLike): boolean {
  return isToggleMarkdownBlock(block)
    || (Array.isArray(block.children) && block.children.some(hasToggleMarkdownBlock))
}

export function hasToggleMarkdownBlocks(blocks: unknown[]): boolean {
  return (blocks as BlockLike[]).some(hasToggleMarkdownBlock)
}

function serializeToggleBlock(block: BlockLike, serializeBlocks: (blocks: unknown[]) => string): string {
  const children = Array.isArray(block.children) ? serializeBlocks(block.children).trim() : ''
  return formatToggleDetailsMarkdown(blockTitle(block), children)
}

export function formatToggleDetailsMarkdown(title: string, childrenMarkdown: string): string {
  return [
    '<details>',
    `<summary>${escapeHtmlText(title)}</summary>`,
    ...(childrenMarkdown ? ['', childrenMarkdown] : []),
    '</details>',
  ].join('\n')
}

export function serializeToggleMarkdownBlocks({
  blocks,
  serializeBlocks,
  serializeOrdinaryBlocks,
}: ToggleSerializationOptions): string {
  const chunks: string[] = []
  let pending: unknown[] = []

  const flushPending = () => {
    if (pending.length === 0) return
    const markdown = serializeOrdinaryBlocks(pending).trimEnd()
    if (markdown) chunks.push(markdown)
    pending = []
  }

  for (const block of blocks as BlockLike[]) {
    if (!isToggleMarkdownBlock(block)) {
      pending.push(block)
      continue
    }
    flushPending()
    chunks.push(serializeToggleBlock(block, serializeBlocks))
  }

  flushPending()
  return chunks.join('\n\n')
}
