import { beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { baseRevision, installHeadlessDom, NoteCodec, patchText } from '../src/index.ts'

const NOTE = '---\ntype: Note\n---\n# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\n- item'

let codec: NoteCodec

beforeAll(() => {
  codec = new NoteCodec()
})

async function docOf(markdown: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  await codec.write(doc, { markdown, revision: 'etag-1' })
  return doc
}

function blockIds(doc: Y.Doc): string[] {
  const group = doc.getXmlFragment('blocks').get(0) as Y.XmlElement
  return group.toArray().map((block) => (block as Y.XmlElement).getAttribute('id') ?? '')
}

describe('NoteCodec', () => {
  it('lays a note out as blocks, frontmatter and meta', async () => {
    const doc = await docOf(NOTE)

    expect(doc.getText('frontmatter').toString()).toBe('---\ntype: Note\n---\n')
    expect(doc.getMap('meta').toJSON()).toEqual({ format: 'tolaria.blocknote/1', baseRevision: 'etag-1' })
    expect(codec.read(doc)).toBe(await codec.canonical(NOTE))
  })

  it('reads a document without frontmatter or content', async () => {
    const doc = await docOf('')

    expect(codec.read(doc)).toBe('')
    expect(baseRevision(new Y.Doc())).toBeUndefined()
  })

  it('rewrites only the blocks that changed and keeps the others in place', async () => {
    const doc = await docOf(NOTE)
    const before = blockIds(doc)

    await codec.write(doc, { markdown: NOTE.replace('Second paragraph.', 'Second paragraph, edited.\n\nA new one.'), revision: 'etag-2' })

    const after = blockIds(doc)
    expect([after[0], after[1], after.at(-1)]).toEqual([before[0], before[1], before.at(-1)])
    expect(after).toHaveLength(before.length + 1)
    expect(baseRevision(doc)).toBe('etag-2')
  })

  it('keeps a cursor in an untouched block where it was', async () => {
    const doc = await docOf(NOTE)
    const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
    const first = [...walker][1] as Y.XmlText
    const cursor = Y.createRelativePositionFromTypeIndex(first, 5)

    await codec.write(doc, { markdown: NOTE.replace('- item', '- changed item'), revision: 'etag-2' })

    const resolved = Y.createAbsolutePositionFromRelativePosition(cursor, doc)
    expect({ type: resolved?.type.toString(), index: resolved?.index }).toEqual({ type: 'First paragraph.', index: 5 })
  })

  it('removes blocks and changes the frontmatter in one transaction', async () => {
    const doc = await docOf(NOTE)
    let transactions = 0
    doc.on('afterTransaction', () => transactions++)

    await codec.write(doc, { markdown: '---\ntype: Project\n---\n# Title', revision: 'etag-2' }, 'test')

    expect(codec.read(doc)).toBe('---\ntype: Project\n---\n# Title\n')
    expect(transactions).toBe(1)
  })

  it('falls back to the serializer form when the source cannot carry the edit', async () => {
    const versions = { source: 'a\n\n<div>x</div>', canonicalSource: 'a', canonical: 'b' }
    const lossy = new NoteCodec()
    lossy.canonical = async () => 'something else'

    expect(await lossy.fileContent(versions)).toEqual({ markdown: 'b', preserved: false })
  })
})

describe('patchText', () => {
  it.each([
    ['a change in the middle', 'status: Open\nowner: me\n', 'status: Done\nowner: me\n'],
    ['an addition', 'a', 'abc'],
    ['a removal', 'abc', 'a'],
    ['no change', 'same', 'same'],
    ['repeated characters', 'aaa', 'aa'],
  ])('applies %s', (_name, from, to) => {
    const text = new Y.Doc().getText('t')
    text.insert(0, from)

    patchText(text, to)

    expect(text.toString()).toBe(to)
  })
})

describe('installHeadlessDom', () => {
  it('lends DOM globals only where there are none', () => {
    const bare: Record<string, unknown> = {}
    const browser: Record<string, unknown> = { document: 'already here' }

    installHeadlessDom(bare)
    installHeadlessDom(browser)

    expect(typeof bare.document).toBe('object')
    expect(browser).toEqual({ document: 'already here' })
  })
})
