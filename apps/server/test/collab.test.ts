import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { baseRevision } from '../../../packages/markdown-yjs/src/index.ts'
import type { VaultPath } from '../src/paths.ts'
import { createHarness, type Harness, NOTE, settle } from './collabHelpers.ts'
import { text } from './helpers.ts'

const SEED = '# Alpha\n\nLinks to [[welcome]] and mentions the Heron.\n'
const LONG_NOTE = '---\ntype: Note\n---\n\n# Plan\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness()
})

afterEach(async () => {
  await harness.cleanup()
})

describe('a room', () => {
  it('gives a client the note as a tolaria.blocknote/1 document', async () => {
    const { doc } = await harness.client('welcome.md')

    expect(doc.getText('frontmatter').toString()).toBe('---\ntype: Note\n---\n')
    expect(doc.getXmlFragment('blocks').toString()).toContain('A throwaway vault for tests.')
    expect(doc.getMap('meta').toJSON()).toEqual({
      format: 'tolaria.blocknote/1',
      baseRevision: (await harness.vault.read('welcome.md' as VaultPath)).etag,
    })
  })

  it('makes two clients converge on concurrent edits', async () => {
    const ada = await harness.client()
    const luca = await harness.client()

    ada.type('Alpha', ' by Ada')
    luca.type('Heron', ' Luca was here.')
    luca.type('Alpha', ' and Luca')
    await settle()

    expect(ada.markdown()).toBe(luca.markdown())
    expect(ada.markdown()).toContain('Luca was here.')
    expect(ada.markdown()).toMatch(/# Alpha( by Ada| and Luca){2}/)
  })

  it('shows each client the presence and cursor of the other', async () => {
    const ada = await harness.client()
    const luca = await harness.client()

    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    luca.provider.awareness.setLocalStateField('user', { name: 'Luca', color: '#36c' })
    await settle()

    expect(luca.provider.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
    expect(ada.provider.awareness.getStates().get(luca.doc.clientID)).toEqual({ user: { name: 'Luca', color: '#36c' } })
  })

  it('withdraws the presence of a client that leaves', async () => {
    const ada = await harness.client()
    const luca = await harness.client()
    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    await settle()

    ada.provider.destroy()
    await settle()

    expect([...luca.provider.awareness.getStates().keys()]).toEqual([luca.doc.clientID])
  })

  it('sends a late joiner the presence of who is already there', async () => {
    const ada = await harness.client()
    ada.provider.awareness.setLocalStateField('user', { name: 'Ada', color: '#d33' })
    await settle()

    const luca = await harness.client()

    expect(luca.provider.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d33' } })
  })

  it('ignores the edits of a read-only client and still shows it the document', async () => {
    const viewer = await harness.client(NOTE, 'read')
    const editor = await harness.client()

    viewer.type('Alpha', ' defaced')
    editor.type('Alpha', ' edited')
    await settle()

    expect(editor.markdown()).not.toContain('defaced')
    expect(viewer.markdown()).toContain('edited')
  })

  it('puts back the meta map when a client writes to it', async () => {
    const ada = await harness.client()
    const luca = await harness.client()
    const revision = (await harness.vault.read(NOTE as VaultPath)).etag

    ada.doc.getMap<string>('meta').set('baseRevision', 'forged')
    ada.doc.getMap<string>('meta').set('conflictCopy', 'somewhere-else.md')
    await settle()

    expect(luca.doc.getMap('meta').toJSON()).toEqual({ format: 'tolaria.blocknote/1', baseRevision: revision })
    expect(ada.doc.getMap('meta').toJSON()).toEqual(luca.doc.getMap('meta').toJSON())
  })

  it.each([
    ['a node type the editor does not have', (doc: Y.Doc) => doc.getXmlFragment('blocks').insert(0, [new Y.XmlElement('script')])],
    [
      'an attribute the node does not have',
      (doc: Y.Doc) => (doc.getXmlFragment('blocks').get(0) as Y.XmlElement).setAttribute('onclick', 'alert(1)'),
    ],
    [
      'a mark the editor does not have',
      (doc: Y.Doc) => {
        const walker = doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
        ;(walker.next().value as Y.XmlText).format(0, 1, { blink: true })
      },
    ],
    ['a shared type the format does not have', (doc: Y.Doc) => doc.getMap('extra').set('key', 'value')],
  ])('turns down a change that adds %s, and closes that connection', async (_name, deface) => {
    const mallory = await harness.client()
    const ada = await harness.client()
    const before = ada.markdown()

    deface(mallory.doc)
    await settle()
    mallory.provider.destroy()
    ada.type('Alpha', ' still fine')
    await settle()

    expect(mallory.sockets[0].closeCode).toBe(4422)
    expect(ada.sockets[0].closeCode).toBeNull()
    expect(ada.markdown()).toBe(before.replace('# Alpha', '# Alpha still fine'))
    expect([...(await harness.session()).doc.share.keys()].sort()).toEqual(['blocks', 'frontmatter', 'meta'])
  })

  it('closes the connection of a client that sends bytes that are no message', async () => {
    const ada = await harness.client()

    ada.sockets[0].send(new Uint8Array([1, 250]))
    await settle()

    expect(ada.sockets[0].closeCode).toBe(4400)
  })

  it('refuses a document id that names no note', async () => {
    expect(await harness.hub.connect('no-such-doc', { send: () => {}, close: () => {} }, 'write')).toBeNull()
  })
})

describe('flushing a document to its file', () => {
  it('writes an edit as one commit that changes only the edited line', async () => {
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE)
    await harness.vault.syncNow()
    const ada = await harness.client('plan.md')

    ada.type('Second', ' Edited.')
    await settle()
    const outcome = await (await harness.session('plan.md')).flush()

    expect(outcome).toBe('written')
    expect(await harness.fixture.desktop.read('plan.md')).toBe(LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Edited.'))
    expect(await harness.commits()).toEqual(['Update plan.md', 'desktop: plan.md'])
  })

  it('tells clients the revision the document is now in step with', async () => {
    const ada = await harness.client()
    ada.type('Alpha', '!')
    await settle()

    await (await harness.session()).flush()
    await settle()

    expect(baseRevision(ada.doc)).toBe((await harness.vault.read(NOTE as VaultPath)).etag)
  })

  it('makes no commit when the document says what the file says', async () => {
    await harness.client()

    expect(await (await harness.session()).flush()).toBe('skipped')
    expect(await harness.commits()).toEqual([])
  })

  it('makes no commit for an edit that was undone', async () => {
    const ada = await harness.client()
    ada.type('Alpha', '!')
    const heading = ada.doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText).next().value as Y.XmlText
    heading.delete(heading.length - 1, 1)
    await settle()

    expect(await (await harness.session()).flush()).toBe('skipped')
    expect(await harness.file()).toBe(SEED)
  })

  it('writes what is pending when the last client has left and the room closes', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' closing')
    await settle()

    ada.provider.destroy()
    await harness.hub.close()

    expect(await harness.file()).toBe(SEED.replace('# Alpha', '# Alpha closing'))
  })
})

describe('flushing on a cadence', () => {
  it('writes shortly after the typing stops', async () => {
    await harness.cleanup()
    harness = await createHarness({ policy: { idleMs: 20, maxWaitMs: 10_000 } })
    const ada = await harness.client()

    ada.type('Alpha', ' one')
    await settle()
    ada.type('Alpha', ' two')
    await new Promise((resolve) => setTimeout(resolve, 60))
    await (await harness.session()).settled()

    expect(await harness.commits()).toEqual([`Update ${NOTE}`])
    expect(await harness.file()).toContain('# Alpha one two')
  })

  it('closes a room nobody is connected to, after writing it', async () => {
    await harness.cleanup()
    harness = await createHarness({ lingerMs: 5 })
    const ada = await harness.client()
    ada.type('Alpha', ' bye')
    await settle()
    const session = await harness.session()

    ada.provider.destroy()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await harness.hub.idle()
    await session.settled()

    expect(await harness.hub.session(harness.docId())).toBeUndefined()
    expect(await harness.file()).toContain('# Alpha bye')
  })

  it('keeps a room open for a client that comes back within the linger time', async () => {
    const ada = await harness.client()
    const session = await harness.session()

    ada.provider.destroy()
    await settle()
    await harness.client()

    expect(await harness.session()).toBe(session)
  })
})

describe('a desktop commit that lands on a live document', () => {
  beforeEach(async () => {
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE)
    await harness.vault.syncNow()
  })

  it('reaches the clients when the document has no edits of its own', async () => {
    const ada = await harness.client('plan.md')

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third paragraph, from the desktop.'))
    await harness.vault.syncNow()
    await settle()

    expect(ada.markdown()).toContain('Third paragraph, from the desktop.')
    expect(await (await harness.session('plan.md')).flush()).toBe('skipped')
  })

  it('is merged with unwritten edits elsewhere in the note, and neither is lost', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' From the web.')
    await settle()

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third paragraph, from the desktop.'))
    await harness.vault.syncNow()
    await settle()
    await (await harness.session('plan.md')).flush()

    const merged = LONG_NOTE.replace('First paragraph.', 'First paragraph. From the web.').replace(
      'Third paragraph.',
      'Third paragraph, from the desktop.',
    )
    expect(await harness.fixture.desktop.read('plan.md')).toBe(merged)
    expect(ada.markdown()).toContain('Third paragraph, from the desktop.')
    expect(harness.logs).toEqual([])
  })

  it('is merged when it arrives in the pull of the flush itself', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' From the web.')
    await settle()
    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third, desktop.'))

    expect(await (await harness.session('plan.md')).flush()).toBe('written')

    const file = await harness.fixture.desktop.read('plan.md')
    expect(file).toContain('First paragraph. From the web.')
    expect(file).toContain('Third, desktop.')
    expect((await harness.vault.list()).files.map((entry) => entry.path).filter((path) => path.includes('conflict'))).toEqual([])
  })

  it('keeps a cursor in an untouched paragraph where it was', async () => {
    const ada = await harness.client('plan.md')
    const walker = ada.doc.getXmlFragment('blocks').createTreeWalker((node) => node instanceof Y.XmlText)
    const first = ([...walker] as Y.XmlText[]).find((node) => node.toString().startsWith('First')) as Y.XmlText
    const cursor = Y.createRelativePositionFromTypeIndex(first, 5)

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Third paragraph.', 'Third, desktop.'))
    await harness.vault.syncNow()
    await settle()

    const resolved = Y.createAbsolutePositionFromRelativePosition(cursor, ada.doc)
    expect({ text: resolved?.type.toString(), index: resolved?.index }).toEqual({ text: 'First paragraph.', index: 5 })
  })

  it('forks a conflict copy when both changed the same line', async () => {
    const ada = await harness.client('plan.md')
    ada.type('Second', ' Web version.')
    await settle()

    await harness.fixture.desktop.commit('plan.md', LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Desktop version.'))
    await harness.vault.syncNow()
    await (await harness.session('plan.md')).settled()
    await settle()

    const copy = ada.doc.getMap<string>('meta').get('conflictCopy') as string
    expect(copy).toMatch(/^plan \(conflict .+\)\.md$/)
    expect(await harness.fixture.desktop.read(copy)).toBe(LONG_NOTE.replace('Second paragraph.', 'Second paragraph. Web version.'))
    expect(await harness.fixture.desktop.read('plan.md')).toContain('Second paragraph. Desktop version.')
    expect(ada.markdown()).toContain('Second paragraph. Desktop version.')
  })

  it('follows a rename made on the desktop', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' Renamed underneath.')
    await settle()
    const session = await harness.session('plan.md')

    await harness.fixture.desktop.rename('plan.md', 'roadmap.md')
    await harness.vault.syncNow()
    await session.flush()

    expect(session.path).toBe('roadmap.md')
    expect(await harness.fixture.desktop.read('roadmap.md')).toContain('First paragraph. Renamed underneath.')
  })

  it('closes the room of a note deleted on the desktop', async () => {
    const ada = await harness.client('plan.md')

    await harness.fixture.desktop.commit('plan.md', null)
    await harness.vault.syncNow()

    expect(ada.sockets[0].closeCode).toBe(4410)
    expect(await harness.hub.session(harness.docId('plan.md'))).toBeUndefined()
  })

  it('restores a note deleted on the desktop while it had unwritten edits', async () => {
    const ada = await harness.client('plan.md')
    ada.type('First', ' Still being written.')
    await settle()

    await harness.fixture.desktop.commit('plan.md', null)
    await harness.vault.syncNow()
    await harness.vault.idle()

    expect(await harness.fixture.desktop.read('plan.md')).toBe(LONG_NOTE.replace('First paragraph.', 'First paragraph. Still being written.'))
  })

  it('leaves documents of other notes alone', async () => {
    const ada = await harness.client()

    await harness.fixture.desktop.commit('plan.md', `${LONG_NOTE}\nMore.\n`)
    await harness.vault.syncNow()

    expect(ada.markdown()).toContain('# Alpha')
    expect(await (await harness.session()).flush()).toBe('skipped')
  })
})

describe('a restart', () => {
  it('reopens a document from its snapshot, so a reconnecting client merges instead of duplicating', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' before')
    await settle()

    await harness.restart()
    ada.type('Alpha', ' offline')
    await ada.provider.whenSynced()
    await settle()
    const luca = await harness.client()

    expect(luca.markdown()).toBe(ada.markdown())
    expect(luca.markdown().match(/# Alpha before offline/g)).toHaveLength(1)
  })

  it('reconciles a snapshot with a file that changed while the server was down', async () => {
    const ada = await harness.client()
    ada.type('Alpha', ' kept')
    await settle()
    await harness.hub.close()
    await harness.vault.write(NOTE as VaultPath, text(`${SEED}\nAdded while down.\n`.replace('# Alpha', '# Alpha kept')), { kind: 'any' })

    await harness.restart()
    const luca = await harness.client()

    expect(luca.markdown()).toContain('Added while down.')
    expect(luca.markdown()).toContain('# Alpha kept')
  })

  it('rebuilds a document from the file when its snapshot cannot be read', async () => {
    await harness.client()
    await harness.hub.close()
    const store = (harness.hub as unknown as { options: { store: { put(key: string, bytes: Uint8Array): Promise<void> } } }).options.store
    await store.put(`collab/${harness.docId()}/base.json`, text('not json'))

    await harness.restart()

    expect((await harness.client()).markdown()).toContain('# Alpha')
  })
})
