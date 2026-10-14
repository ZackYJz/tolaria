import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isSupportedProtocolVersion, PROTOCOL_HEADER } from '../../../packages/protocol/src/index.ts'
import { DEFAULT_FLUSH_POLICY, type FlushPolicy } from './collab/flush.ts'
import { CollabHub } from './collab/hub.ts'
import { TicketBook } from './collab/tickets.ts'
import { attachCollab } from './collab/upgrade.ts'
import { DocIndex } from './docIndex.ts'
import { VaultError } from './errors.ts'
import { errorReply, isAuthorized, type Reply, readBody, send, singleHeader } from './httpIo.ts'
import { isNote, type VaultPath } from './paths.ts'
import { route, type Services } from './routes.ts'
import type { BlobStore } from './store.ts'
import type { Vault } from './vault.ts'

export interface ServerOptions {
  vault: Vault
  store: BlobStore
  token: string
  maxBodyBytes: number
  log?: (message: string) => void
  /** Settings of the collaboration channel; `false` leaves it reserved and unserved. */
  collab?: CollabOptions | false
}

export interface CollabOptions {
  policy?: FlushPolicy
  /** How long a document without clients stays open. */
  lingerMs?: number
}

const DEFAULT_LINGER_MS = 30_000
/** What to do before the HTTP server of a vault stops, by server. */
const SHUTDOWN = new WeakMap<Server, () => Promise<void>>()

const HEALTH_PATH = '/healthz'

function checkAccess(request: IncomingMessage, token: string): void {
  if (!isAuthorized(singleHeader(request.headers, 'authorization'), token)) {
    throw new VaultError(401, 'unauthorized', 'a valid bearer token is required')
  }
  const version = singleHeader(request.headers, PROTOCOL_HEADER)
  if (version !== undefined && !isSupportedProtocolVersion(version)) {
    throw new VaultError(400, 'unsupported_protocol_version', `this server does not speak protocol ${version}`)
  }
}

async function answer(request: IncomingMessage, services: Services, options: ServerOptions): Promise<Reply> {
  // The base only gives relative request targets something to resolve against.
  const url = new URL(request.url ?? '/', 'http://vault.invalid')
  if (url.pathname === HEALTH_PATH) return { status: 200, body: { status: 'ok' } }
  checkAccess(request, options.token)
  return route(
    {
      method: request.method ?? 'GET',
      url,
      headers: request.headers,
      body: () => readBody(request, options.maxBodyBytes),
    },
    services,
  )
}

function failure(error: unknown, log: (message: string) => void): Reply {
  if (!(error instanceof VaultError)) log(`request failed: ${error instanceof Error ? error.stack : String(error)}`)
  const reply = errorReply(error)
  // The body may be unread, so the connection cannot be reused for another request.
  const headers: Record<string, string> = { connection: 'close' }
  if (reply.status === 401) headers['www-authenticate'] = 'Bearer'
  return { ...reply, headers }
}

/** Builds the HTTP server of one vault. The caller decides where it listens. */
export async function createVaultServer(options: ServerOptions): Promise<Server> {
  const { vault } = options
  const log = options.log ?? (() => {})
  const docs = await DocIndex.open(options.store)
  const { files } = await vault.list()
  await docs.reconcile(files.map((file) => file.path as VaultPath).filter(isNote))
  vault.onChange((changes) => docs.apply(changes))
  const tickets = options.collab === false ? undefined : new TicketBook()
  const services: Services = { vault, docs, collab: tickets !== undefined, tickets }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    answer(request, services, options)
      .catch((error: unknown) => failure(error, log))
      .then((reply) => send(response, reply))
  })
  if (tickets) serveCollab(server, { options, docs, tickets, log })
  return server
}

interface CollabParts {
  options: ServerOptions
  docs: DocIndex
  tickets: TicketBook
  log(message: string): void
}

function serveCollab(server: Server, { options, docs, tickets, log }: CollabParts): void {
  const { vault, store, token } = options
  const settings = options.collab || {}
  const hub = new CollabHub({
    vault,
    docs,
    store,
    log,
    policy: settings.policy ?? DEFAULT_FLUSH_POLICY,
    lingerMs: settings.lingerMs ?? DEFAULT_LINGER_MS,
  })
  const sockets = attachCollab(server, { hub, tickets, docs, token, log, maxMessageBytes: options.maxBodyBytes })
  SHUTDOWN.set(server, async () => {
    await hub.close()
    sockets.close()
  })
}

/** Stops a vault server: open documents are written to their files first. */
export async function closeVaultServer(server: Server): Promise<void> {
  await SHUTDOWN.get(server)?.()
  server.close()
  server.closeAllConnections()
}
