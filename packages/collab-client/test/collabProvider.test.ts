import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createHarness, type Harness, NOTE, settle } from '../../../apps/server/test/collabHelpers.ts'
import { type CollabStatus, CollabProvider, type SocketLike } from '../src/collabProvider.ts'

let harness: Harness | undefined
let provider: CollabProvider | undefined

afterEach(async () => {
  provider?.destroy()
  await harness?.cleanup()
  harness = undefined
})

/** A socket that never opens, to look at the provider before it is connected. */
function deadSocket(): SocketLike {
  return { binaryType: '', readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, send: () => {}, close: () => {} }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('CollabProvider', () => {
  it('reports connecting, then syncing, then synced', async () => {
    harness = await createHarness()
    const client = await harness.client()
    const seen: CollabStatus[] = []

    client.provider.onStatus((status) => seen.push(status))
    client.sockets[0].close()
    await client.provider.whenSynced()

    expect(seen).toEqual(['synced', 'offline', 'syncing', 'synced'])
  })

  it('keeps edits made while offline and sends them when the connection is back', async () => {
    harness = await createHarness()
    const ada = await harness.client()
    const luca = await harness.client()

    ada.sockets[0].close()
    ada.type('Alpha', ' written offline')
    expect(luca.markdown()).not.toContain('written offline')
    await ada.provider.whenSynced()
    await settle()

    expect(luca.markdown()).toContain('# Alpha written offline')
  })

  it('stops showing the others while offline', async () => {
    harness = await createHarness()
    const ada = await harness.client()
    const luca = await harness.client()
    luca.provider.awareness.setLocalStateField('user', { name: 'Luca' })
    await settle()

    const before = ada.provider.awareness.getStates().size
    ada.sockets[0].close()

    expect([before, ada.provider.awareness.getStates().has(luca.doc.clientID)]).toEqual([2, false])
  })

  it('retries with a growing delay while the server cannot be reached', async () => {
    const attempts: number[] = []
    const started = Date.now()
    provider = new CollabProvider({
      doc: new Y.Doc(),
      retryMs: 10,
      maxRetryMs: 25,
      openSocket: async () => {
        attempts.push(Date.now() - started)
        throw new Error('unreachable')
      },
    })

    await wait(120)

    expect(provider.status).toBe('offline')
    expect(attempts.length).toBeGreaterThanOrEqual(4)
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(15)
  })

  it('opens with the socket handlers when the socket connects later', async () => {
    const socket = deadSocket()
    const sent: Uint8Array[] = []
    socket.send = (data) => sent.push(data)
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)

    socket.readyState = 1
    socket.onopen?.()
    socket.onopen?.()

    expect(provider.status).toBe('syncing')
    // The document request and the client's own presence, once each.
    expect(sent).toHaveLength(2)
  })

  it('closes a failing socket so that it is retried', async () => {
    const socket = deadSocket()
    let closed = 0
    socket.close = () => closed++
    provider = new CollabProvider({ doc: new Y.Doc(), openSocket: async () => socket })
    await settle(1)

    socket.onerror?.()

    expect(closed).toBe(1)
  })

  it('does nothing after it was destroyed, even when a socket arrives late', async () => {
    const socket = deadSocket()
    let closed = 0
    socket.close = () => closed++
    const doc = new Y.Doc()
    provider = new CollabProvider({ doc, openSocket: async () => socket })

    provider.destroy()
    provider.destroy()
    await settle(1)
    doc.getText('t').insert(0, 'ignored')

    expect([provider.status, closed]).toEqual(['closed', 1])
  })

  it('ignores messages and closes of a socket it has replaced', async () => {
    harness = await createHarness()
    const client = await harness.client(NOTE)
    const [old] = client.sockets
    const { onmessage, onclose } = old

    old.close()
    await client.provider.whenSynced()
    onmessage?.({ data: new Uint8Array([]) })
    onclose?.()

    expect(client.provider.status).toBe('synced')
  })
})
