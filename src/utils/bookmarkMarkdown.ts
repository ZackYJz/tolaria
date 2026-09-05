import { type BlockLike, type DurableBlockCodec, readCodeBlockLanguage, readInlineText } from './durableMarkdownBlocks'

export const BOOKMARK_BLOCK_TYPE = 'webBookmark'

export function normalizeBookmarkUrl(value: string): string {
  const trimmed = value.trim()
  const hasControlOrSpace = Array.from(trimmed).some(character => {
    const code = character.charCodeAt(0)
    return code <= 32 || code === 127
  })
  if (!trimmed || hasControlOrSpace) return ''
  const address = /^[a-z][a-z\d+.-]*:/iu.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.href
  } catch {
    return ''
  }
}

function stringField(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === 'string' ? payload[key] : ''
}

function decodePayload(payload: unknown): Record<string, string> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  return {
    url: normalizeBookmarkUrl(stringField(record, 'url')),
    title: stringField(record, 'title'),
    description: stringField(record, 'description'),
    image: normalizeBookmarkUrl(stringField(record, 'image')),
    favicon: normalizeBookmarkUrl(stringField(record, 'favicon')),
  }
}

function parsePayload(source: string): Record<string, string> | null {
  try {
    return decodePayload(JSON.parse(source))
  } catch {
    return null
  }
}

function serializeBlock(block: BlockLike): string {
  const payload = JSON.stringify(decodePayload(block.props ?? {}))
  const longestRun = Math.max(0, ...Array.from(payload.matchAll(/`+/gu), match => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}bookmark\n${payload}\n${fence}`
}

export const bookmarkMarkdownCodec: DurableBlockCodec = {
  tokenPrefix: '@@TOLARIA_BOOKMARK_BLOCK:',
  tokenSuffix: '@@',
  readFenceMetadata: info => info.trim().toLowerCase() === 'bookmark' ? {} : null,
  buildPayload: ({ lines, start, end }) => parsePayload(lines.slice(start + 1, end).join('')),
  decodePayload,
  buildBlock: (block, payload) => ({
    ...block,
    type: BOOKMARK_BLOCK_TYPE,
    props: payload as Record<string, string>,
    content: undefined,
    children: [],
  }),
  readCodeBlock: block => block.type === 'codeBlock' && readCodeBlockLanguage({ block }) === 'bookmark'
    ? parsePayload(readInlineText(block.content) ?? '') : null,
  isBlock: block => block.type === BOOKMARK_BLOCK_TYPE,
  serializeBlock,
}
