import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeVaultServer, createVaultServer } from '../../../apps/server/src/server.ts'
import { LocalDiskStore } from '../../../apps/server/src/store.ts'
import type { Vault } from '../../../apps/server/src/vault.ts'
import { codec } from '../../../apps/server/test/collabHelpers.ts'
import { createFixture, type Fixture, SEED_NOTES } from '../../../apps/server/test/helpers.ts'
import type { SocketLike } from '../src/collabProvider.ts'
import { createRemoteVaultBackend, type RemoteBindings, RemoteError } from '../src/remoteVaultBackend.ts'
import type { VaultBackend, VaultCollabDoc } from '../../../src/lib/vaultBackend/types'

const TOKEN = 'test-token-0123456789'

let fixture: Fixture
let vault: Vault
let server: Server
let backend: VaultBackend<RemoteBindings>
let opened: VaultCollabDoc<RemoteBindings>[]

async function open(path: string, options = {}): Promise<VaultCollabDoc<RemoteBindings>> {
  const doc = await (backend.collab as NonNullable<typeof backend.collab>).openDoc(path, options)
  opened.push(doc)
  await doc.synced
  return doc
}

beforeEach(async () => {
  fixture = await createFixture()
  vault = await fixture.openVault()
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes: 1024 * 1024,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  backend = createRemoteVaultBackend({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    token: TOKEN,
    createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  })
  opened = []
})

afterEach(async () => {
  for (const doc of opened) doc.close()
  await closeVaultServer(server)
  await vault.idle()
  await fixture.cleanup()
})

describe('the remote vault backend', () => {
  it('describes itself as a remote with collaboration and store-side revision checks', () => {
    expect(backend).toMatchObject({
      kind: 'remote',
      capabilities: { collaboration: true, atomicRevisions: true, attachments: false },
    })
  })

  it('reads a file with its revision', async () => {
    const file = await backend.files.read('welcome.md')

    expect(file).toEqual({ path: 'welcome.md', content: SEED_NOTES['welcome.md'], revision: expect.stringMatching(/^[0-9a-f]{40}$/) })
  })

  it('writes on top of the revision it read, creates, and overwrites when asked to', async () => {
    const { revision } = await backend.files.read('welcome.md')

    const updated = await backend.files.write('welcome.md', '# Updated\n', { baseRevision: revision })
    const created = await backend.files.write('folder/new note.md', '# New\n', { baseRevision: null })
    const forced = await backend.files.write('welcome.md', '# Forced\n')

    expect([updated.status, created.status, forced.status]).toEqual(['written', 'written', 'written'])
    expect((await backend.files.read('folder/new note.md')).content).toBe('# New\n')
  })

  it('reports a stale write as a conflict, with the file that won', async () => {
    const { revision } = await backend.files.read('welcome.md')
    await fixture.desktop.commit('welcome.md', '# From the desktop\n')

    const result = await backend.files.write('welcome.md', '# Stale\n', { baseRevision: revision })

    expect(result).toMatchObject({ status: 'conflict', current: { path: 'welcome.md', content: '# From the desktop\n' } })
  })

  it('raises the status of a request the server refuses', async () => {
    await expect(backend.files.read('missing.md')).rejects.toMatchObject({ name: 'RemoteError', status: 404 })
    await expect(open('attachments/pixel.bin')).rejects.toBeInstanceOf(RemoteError)
  })

  it('refuses by name what needs the note index the server does not have yet', async () => {
    const { files } = backend
    const refused = [
      files.list(),
      files.rename({ path: 'welcome.md', newFilenameStem: 'hello' }),
      files.delete(['welcome.md']),
      files.search('welcome'),
      files.saveAttachment({ filename: 'a.png', bytes: new Uint8Array() }),
    ]

    const outcomes = await Promise.allSettled(refused)

    expect(outcomes.map((outcome) => outcome.status)).toEqual(Array(5).fill('rejected'))
    expect(String((outcomes[0] as PromiseRejectedResult).reason)).toMatch(/not available on the Tolaria remote yet/)
  })

  it('opens a note as a live document that two clients share', async () => {
    const ada = await open('welcome.md', { user: { name: 'Ada', color: '#d9480f' } })
    const luca = await open('welcome.md')

    ada.doc.getText('frontmatter').insert(0, '')
    const heading = ada.fragment.createTreeWalker((node) => node.constructor.name === 'YXmlText').next().value as { insert(index: number, text: string): void }
    heading.insert(0, 'Shared ')

    await expect.poll(() => codec.read(luca.doc)).toContain('# Shared Welcome')
    expect(luca.awareness.getStates().get(ada.doc.clientID)).toEqual({ user: { name: 'Ada', color: '#d9480f' } })
  })

  it('opens a read-only document that cannot change the note', async () => {
    const viewer = await open('welcome.md', { readOnly: true })
    const editor = await open('welcome.md')

    viewer.doc.getText('frontmatter').insert(0, 'defaced')
    editor.doc.getText('frontmatter').insert(0, '')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(editor.doc.getText('frontmatter').toString()).not.toContain('defaced')
  })
})
