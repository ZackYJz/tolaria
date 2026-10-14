import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import { COLLAB_MAX_MESSAGE_BYTES, COLLAB_TICKET_PARAM, type CollabAccess, ROUTES } from '../../../../packages/protocol/src/index.ts'
import type { DocId, DocIndex } from '../docIndex.ts'
import { isAuthorized, singleHeader } from '../httpIo.ts'
import type { CollabHub, Connection } from './hub.ts'
import type { TicketBook } from './tickets.ts'

export interface UpgradeOptions {
  hub: CollabHub
  tickets: TicketBook
  docs: DocIndex
  token: string
  maxMessageBytes: number
  log(message: string): void
}

interface Admission {
  docId: DocId
  access: CollabAccess
}

const DOC_PREFIX = `${ROUTES.collabDocs}/`
const REFUSALS = new Map([
  [401, 'Unauthorized'],
  [404, 'Not Found'],
])
const INTERNAL_ERROR = 1011
const MESSAGE_TOO_BIG = 1009

/** Thrown with the HTTP status the upgrade is refused with. */
class Refusal extends Error {
  readonly status: number

  constructor(status: number) {
    super(`upgrade refused with ${status}`)
    this.status = status
  }
}

function bytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data)
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data
}

/** Who may open which document: the bearer token, or a ticket issued for this document. */
function admit(request: IncomingMessage, { token, tickets, docs }: UpgradeOptions): Admission {
  const url = new URL(request.url ?? '/', 'http://vault.invalid')
  const docId = url.pathname.startsWith(DOC_PREFIX) ? url.pathname.slice(DOC_PREFIX.length) : ''
  if (!docs.pathOf(docId)) throw new Refusal(404)
  if (isAuthorized(singleHeader(request.headers, 'authorization'), token)) return { docId, access: 'write' }
  const access = tickets.redeem(url.searchParams.get(COLLAB_TICKET_PARAM) ?? '', docId)
  if (!access) throw new Refusal(401)
  return { docId, access }
}

function refuse(socket: Duplex, error: unknown): void {
  const status = error instanceof Refusal ? error.status : 401
  socket.end(`HTTP/1.1 ${status} ${REFUSALS.get(status)}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/**
 * Messages that arrive while the document is still opening. They are held up to the size of
 * one message in total: a client has no reason to send more before it has the document.
 */
export class WaitingRoom {
  private readonly held: Uint8Array[] = []
  private readonly limit: number
  private bytes = 0

  constructor(limit: number) {
    this.limit = limit
  }

  /** False when holding this message would exceed the limit; nothing more is held then. */
  hold(data: Uint8Array): boolean {
    this.bytes += data.byteLength
    if (this.bytes > this.limit) {
      this.held.length = 0
      return false
    }
    this.held.push(data)
    return true
  }

  release(): Uint8Array[] {
    this.bytes = 0
    return this.held.splice(0)
  }
}

/** One websocket from the upgrade until it is in its room, and from then on. */
class Arrival {
  private readonly ws: WebSocket
  private readonly waiting: WaitingRoom
  private connection: Connection | null = null
  private closed = false

  constructor(ws: WebSocket, maxMessageBytes: number) {
    this.ws = ws
    this.waiting = new WaitingRoom(maxMessageBytes)
  }

  message(data: Uint8Array): void {
    if (this.connection) this.connection.receive(data)
    else if (!this.waiting.hold(data)) this.ws.close(MESSAGE_TOO_BIG, 'too much sent before the document opened')
  }

  close(): void {
    this.closed = true
    this.connection?.closed()
  }

  /** The document is open. Null: the hub would not take the connection. */
  joined(connection: Connection | null): void {
    if (!connection) {
      this.ws.close(INTERNAL_ERROR, 'the document is not available')
      return
    }
    this.connection = connection
    if (this.closed) connection.closed()
    for (const data of this.waiting.release()) connection.receive(data)
  }
}

/** Joins a websocket to its document. Messages that arrive while the document opens wait. */
function serve(ws: WebSocket, { docId, access }: Admission, { hub, log, maxMessageBytes }: UpgradeOptions): void {
  const arrival = new Arrival(ws, maxMessageBytes)
  ws.on('message', (data) => arrival.message(bytes(data)))
  ws.on('close', () => arrival.close())
  ws.on('error', (error) => log(`collab: websocket error: ${error.message}`))
  const socket = { send: (data: Uint8Array) => ws.send(data), close: (code: number, reason: string) => ws.close(code, reason) }
  hub
    .connect(docId, socket, access)
    .then((joined) => arrival.joined(joined))
    .catch((error: unknown) => {
      log(`collab: opening document ${docId} failed: ${error instanceof Error ? error.message : String(error)}`)
      ws.close(INTERNAL_ERROR, 'the document could not be opened')
    })
}

/** Serves the collaboration channel on the HTTP server's websocket upgrades. */
export function attachCollab(server: Server, options: UpgradeOptions): WebSocketServer {
  // The websocket layer closes a connection that sends more, before the frame is buffered.
  const maxPayload = Math.min(options.maxMessageBytes, COLLAB_MAX_MESSAGE_BYTES)
  const sockets = new WebSocketServer({ noServer: true, maxPayload })
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const admission = admit(request, options)
      sockets.handleUpgrade(request, socket, head, (ws) => serve(ws, admission, options))
    } catch (error) {
      refuse(socket, error)
    }
  })
  return sockets
}
