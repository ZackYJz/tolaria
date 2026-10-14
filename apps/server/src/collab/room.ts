import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { awarenessMessage, receive, syncStep1, updateMessage } from '../../../../packages/protocol/src/collabWire.ts'

/** One websocket of one client, as far as a room is concerned. */
export interface Peer {
  readOnly: boolean
  send(data: Uint8Array): void
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

/**
 * The live document of one note and everyone connected to it. Changes from one peer are
 * applied to the server's copy and relayed to the others; so is presence. A change is first
 * tried on a scratch copy and applied only if the result passes the room's check.
 */
/** Says why a document is not acceptable, or null when it is. */
export type DocCheck = (doc: Y.Doc) => string | null

export class Room {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  /**
   * A copy of the document on which a peer's change is tried first. It follows every change
   * the document accepts, and is rebuilt after a change that was turned down.
   */
  private trial = new Y.Doc()
  private readonly check: DocCheck
  /** Each peer with the awareness client ids it announced, to withdraw them when it leaves. */
  private readonly peers = new Map<Peer, Set<number>>()

  constructor(check: DocCheck = () => null) {
    this.check = check
    // The server takes part in the document, not in presence.
    this.awareness.setLocalState(null)
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      Y.applyUpdate(this.trial, update)
      this.broadcast(updateMessage(update), origin)
    })
    this.awareness.on('update', (change: AwarenessChange, origin: unknown) => this.relayAwareness(change, origin))
  }

  get size(): number {
    return this.peers.size
  }

  join(peer: Peer): void {
    this.peers.set(peer, new Set())
    peer.send(syncStep1(this.doc))
    const present = [...this.awareness.getStates().keys()]
    if (present.length > 0) peer.send(awarenessMessage(this.awareness, present))
  }

  /** Applies a message from a peer. Throws when the bytes are not a valid message. */
  receive(peer: Peer, data: Uint8Array): void {
    if (!this.peers.has(peer)) return
    const sender = { origin: peer, readOnly: peer.readOnly, accept: (update: Uint8Array) => this.accepts(update) }
    const { reply } = receive(data, this, sender)
    if (reply) peer.send(reply)
  }

  /** Tries a peer's change on the copy: the document itself only ever gets changes that pass. */
  private accepts(update: Uint8Array): boolean {
    try {
      Y.applyUpdate(this.trial, update)
      if (this.check(this.trial) === null) return true
    } catch {
      // An update that cannot be applied is turned down like one that fails the check.
    }
    this.trial.destroy()
    this.trial = new Y.Doc()
    Y.applyUpdate(this.trial, Y.encodeStateAsUpdate(this.doc))
    return false
  }

  leave(peer: Peer): void {
    const announced = this.peers.get(peer)
    if (!announced) return
    this.peers.delete(peer)
    removeAwarenessStates(this.awareness, [...announced], peer)
  }

  destroy(): void {
    this.peers.clear()
    this.trial.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }

  private relayAwareness({ added, updated, removed }: AwarenessChange, origin: unknown): void {
    const announced = this.peers.get(origin as Peer)
    if (announced) {
      for (const client of [...added, ...updated]) announced.add(client)
      for (const client of removed) announced.delete(client)
    }
    this.broadcast(awarenessMessage(this.awareness, [...added, ...updated, ...removed]), null)
  }

  /** Sends to every peer except the one the change came from, which already has it. */
  private broadcast(data: Uint8Array, origin: unknown): void {
    for (const peer of this.peers.keys()) {
      if (peer !== origin) peer.send(data)
    }
  }
}
