import { blocksToYXmlFragment, yXmlFragmentToBlocks } from '@blocknote/core/yjs'
import * as Y from 'yjs'
import { type LineMatch, matchLines } from './lineMerge.ts'
import type { HeadlessEditor, NoteBlock } from './markdownBlocks.ts'

/**
 * Changes a live document to a new list of blocks while touching as little as possible:
 * top-level blocks that did not change keep their Yjs items, so cursors, selections and
 * concurrent edits inside them survive. Changed blocks are replaced whole.
 */

interface Gap {
  /** Top-level blocks `[from, to)` of the live document to remove. */
  from: number
  to: number
  /** Top-level blocks `[insertFrom, insertTo)` of the new list to put in their place. */
  insertFrom: number
  insertTo: number
}

function withoutIds(_key: string, value: unknown): unknown {
  if (value instanceof Object && 'id' in value) return { ...value, id: undefined }
  return value
}

/** A block's content regardless of its id: equal signatures mean nothing to change. */
function signature(block: NoteBlock): string {
  return JSON.stringify(block, withoutIds)
}

function gaps(matches: readonly LineMatch[], liveCount: number, nextCount: number): Gap[] {
  const found: Gap[] = []
  let live = 0
  let next = 0
  for (const [inLive, inNext] of [...matches, [liveCount, nextCount] as const]) {
    if (inLive > live || inNext > next) found.push({ from: live, to: inLive, insertFrom: next, insertTo: inNext })
    live = inLive + 1
    next = inNext + 1
  }
  return found
}

function topLevelGroup(fragment: Y.XmlFragment): Y.XmlElement {
  return fragment.get(0) as Y.XmlElement
}

function clones(group: Y.XmlElement, from: number, to: number): Y.XmlElement[] {
  return group.slice(from, to).map((node) => (node as Y.XmlElement).clone())
}

/** Must run inside a transaction on the fragment's document. */
export function patchBlocks(editor: HeadlessEditor, fragment: Y.XmlFragment, next: NoteBlock[]): void {
  if (fragment.length === 0) {
    blocksToYXmlFragment(editor, next, fragment)
    return
  }
  const live = yXmlFragmentToBlocks(editor, fragment)
  const matches = matchLines(live.map(signature), next.map(signature))
  const replacement = topLevelGroup(blocksToYXmlFragment(editor, next, new Y.Doc().getXmlFragment('next')))
  const group = topLevelGroup(fragment)
  // Back to front, so the positions of earlier gaps stay valid.
  for (const gap of gaps(matches, live.length, next.length).reverse()) {
    group.delete(gap.from, gap.to - gap.from)
    group.insert(gap.from, clones(replacement, gap.insertFrom, gap.insertTo))
  }
}

/** Replaces the text with the smallest edit: what is shared at both ends is left alone. */
export function patchText(text: Y.Text, next: string): void {
  const current = text.toString()
  if (current === next) return
  let start = 0
  while (start < current.length && start < next.length && current[start] === next[start]) start++
  let end = 0
  const limit = Math.min(current.length, next.length) - start
  while (end < limit && current[current.length - 1 - end] === next[next.length - 1 - end]) end++
  text.delete(start, current.length - start - end)
  text.insert(start, next.slice(start, next.length - end))
}
