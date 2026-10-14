import { type Lines, type MergeChunk, merge3 } from './lineMerge.ts'

/**
 * Writing a note back must not reformat what nobody edited: the serializer normalises
 * markdown (blank lines, escapes, the trailing newline), and a file rewritten in that form
 * shows a git diff for lines the user never touched. So an edit is carried over to the
 * original bytes instead: the lines that differ between the serialized source and the
 * serialized document are the edit, and only those replace lines of the source file.
 */

export interface SourceVersions {
  /** The bytes of the file the document was loaded from. */
  source: string
  /** The serializer's rendering of that file, before any edit. */
  canonicalSource: string
  /** The serializer's rendering of the document now. */
  canonical: string
}

function lines(text: string): string[] {
  return text.split('\n')
}

function indexOfRun(haystack: Lines, needle: Lines): number {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) return start
  }
  return -1
}

/**
 * The source formats these lines differently and the user also edited them. When the source
 * only added lines around them (a blank line after the frontmatter, the final newline), those
 * stay; otherwise the edit wins in the serializer's form.
 */
function editedOverSource(base: Lines, source: Lines, edited: Lines): Lines {
  const start = indexOfRun(source, base)
  if (start < 0) return edited
  return [...source.slice(0, start), ...edited, ...source.slice(start + base.length)]
}

function chunkLines(chunk: MergeChunk): Lines {
  if (chunk.kind === 'conflict') return editedOverSource(chunk.base, chunk.a, chunk.b)
  return chunk.lines
}

/** The source file with the document's edits applied and every untouched line byte-identical. */
export function preserveSource({ source, canonicalSource, canonical }: SourceVersions): string {
  if (canonical === canonicalSource) return source
  const chunks = merge3(lines(canonicalSource), lines(source), lines(canonical))
  return chunks.flatMap(chunkLines).join('\n')
}
