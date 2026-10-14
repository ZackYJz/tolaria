import type { IncomingHttpHeaders } from 'node:http'
import {
  COLLAB_CAPABILITIES,
  type CollabAccess,
  DOC_BLOCKS_FRAGMENT,
  DOC_FORMAT,
  DOC_FRONTMATTER_FIELD,
  DOC_ID_HEADER,
  DOC_META_MAP,
  FILE_CAPABILITIES,
  PROTOCOL_VERSION,
  ROUTES,
  type VaultResponse,
  type WriteResult,
} from '../../../packages/protocol/src/index.ts'
import type { TicketBook } from './collab/tickets.ts'
import type { DocIndex } from './docIndex.ts'
import { VaultError } from './errors.ts'
import { entityTag, errorReply, quoted, type Reply, singleHeader } from './httpIo.ts'
import { isNote, type VaultPath, vaultPath } from './paths.ts'
import type { TimedWriteResult, Timings, Vault, WritePrecondition } from './vault.ts'

export interface Services {
  vault: Vault
  docs: DocIndex
  /** True once the collaboration channel is served, not only reserved. */
  collab: boolean
  /** Present when the collaboration channel is served. */
  tickets?: TicketBook
}

export interface ApiRequest {
  method: string
  url: URL
  headers: IncomingHttpHeaders
  body(): Promise<Buffer>
}

type Handler = (request: ApiRequest, services: Services, path: VaultPath) => Promise<Reply>
type Methods = Map<string, Handler>

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const MAX_QUERY_CHARS = 200
const WRITE_STATUS = new Map<string, number>([
  ['created', 201],
  ['recreated', 201],
  ['conflict', 409],
])

function invalidRequest(message: string): VaultError {
  return new VaultError(400, 'invalid_request', message)
}

function withDocId<T extends { path: string }>(result: T, docs: DocIndex): T & { docId?: string } {
  const docId = docs.docId(result.path)
  return docId ? { ...result, docId } : result
}

async function describeVault(_request: ApiRequest, { vault, collab }: Services): Promise<Reply> {
  const body: VaultResponse = {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: collab ? [...FILE_CAPABILITIES, ...COLLAB_CAPABILITIES] : [...FILE_CAPABILITIES],
    vault: await vault.info(),
    collab: {
      available: collab,
      path: ROUTES.collabDocs,
      docFormat: DOC_FORMAT,
      blocksFragment: DOC_BLOCKS_FRAGMENT,
      frontmatterField: DOC_FRONTMATTER_FIELD,
      metaMap: DOC_META_MAP,
    },
  }
  return { status: 200, body }
}

async function listFiles({ url }: ApiRequest, { vault, docs }: Services): Promise<Reply> {
  const { head, files } = await vault.list(url.searchParams.get('prefix') ?? '')
  return { status: 200, body: { head, files: docs.withDocIds(files) } }
}

async function readFile({ headers }: ApiRequest, { vault, docs }: Services, path: VaultPath): Promise<Reply> {
  const { bytes, etag } = await vault.read(path)
  const replyHeaders: Record<string, string> = {
    etag: quoted(etag),
    'content-type': isNote(path) ? 'text/markdown; charset=utf-8' : 'application/octet-stream',
  }
  const docId = docs.docId(path)
  if (docId) replyHeaders[DOC_ID_HEADER] = docId
  if (entityTag(singleHeader(headers, 'if-none-match')) === etag) return { status: 304, headers: replyHeaders }
  return { status: 200, headers: replyHeaders, body: bytes }
}

function writePrecondition(headers: IncomingHttpHeaders): WritePrecondition {
  const ifMatch = entityTag(singleHeader(headers, 'if-match'))
  if (ifMatch === '*') return { kind: 'any' }
  if (ifMatch) return { kind: 'match', etag: ifMatch }
  if (entityTag(singleHeader(headers, 'if-none-match')) === '*') return { kind: 'absent' }
  throw new VaultError(
    428,
    'precondition_required',
    'send If-Match with the etag you edited, If-None-Match: * to create, or If-Match: * to overwrite',
  )
}

function serverTiming({ pullMs, commitMs, pushMs }: Timings): string {
  const parts = [`pull;dur=${pullMs.toFixed(1)}`, `commit;dur=${commitMs.toFixed(1)}`, `push;dur=${pushMs.toFixed(1)}`]
  return parts.join(', ')
}

function writeReply({ timings, ...result }: TimedWriteResult, docs: DocIndex): Reply {
  const body: WriteResult = withDocId(result, docs)
  return {
    status: WRITE_STATUS.get(result.outcome) ?? 200,
    headers: { etag: quoted(result.etag), 'server-timing': serverTiming(timings) },
    body,
  }
}

async function writeFile(request: ApiRequest, { vault, docs }: Services, path: VaultPath): Promise<Reply> {
  const precondition = writePrecondition(request.headers)
  return writeReply(await vault.write(path, await request.body(), precondition), docs)
}

async function deleteFile({ headers }: ApiRequest, { vault }: Services, path: VaultPath): Promise<Reply> {
  const ifMatch = entityTag(singleHeader(headers, 'if-match'))
  if (!ifMatch || ifMatch === '*') {
    throw new VaultError(428, 'precondition_required', 'send If-Match with the etag of the file to delete')
  }
  return { status: 200, body: await vault.remove(path, ifMatch) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value instanceof Object && !Array.isArray(value)
}

function jsonObject(bytes: Buffer): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw invalidRequest('the body is not valid JSON')
  }
  if (isRecord(parsed)) return parsed
  throw invalidRequest('the body must be a JSON object')
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw invalidRequest(`${name} must be a string`)
  return value
}

async function renameFile(request: ApiRequest, { vault, docs }: Services): Promise<Reply> {
  const body = jsonObject(await request.body())
  const from = vaultPath(body.from)
  const to = vaultPath(body.to)
  const result = await vault.rename(from, to, optionalString(body.ifMatch, 'ifMatch'))
  return { status: 200, body: withDocId(result, docs) }
}

function searchLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_SEARCH_LIMIT
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) throw invalidRequest('limit must be a positive integer')
  return Math.min(limit, MAX_SEARCH_LIMIT)
}

function searchQuery(query: string): string {
  const oneLine = !query.includes('\n') && query.length <= MAX_QUERY_CHARS
  if (oneLine && query.trim() !== '') return query
  throw invalidRequest(`q must be one line of 1 to ${MAX_QUERY_CHARS} characters`)
}

async function search({ url }: ApiRequest, { vault }: Services): Promise<Reply> {
  const query = searchQuery(url.searchParams.get('q') ?? '')
  return { status: 200, body: await vault.search(query, searchLimit(url.searchParams.get('limit'))) }
}

async function sync(_request: ApiRequest, { vault }: Services): Promise<Reply> {
  return { status: 200, body: await vault.syncNow() }
}

function collabAccess(value: unknown): CollabAccess {
  if (value === undefined || value === 'write') return 'write'
  if (value === 'read') return 'read'
  throw invalidRequest('access must be "read" or "write"')
}

function collabNotServed(): VaultError {
  return new VaultError(501, 'not_implemented', 'this server does not serve the collaboration channel')
}

/** The channel is a websocket: a plain request for it gets told so. */
async function collabDocument(_request: ApiRequest, { collab }: Services): Promise<Reply> {
  if (!collab) throw collabNotServed()
  const refused = new VaultError(426, 'upgrade_required', 'open this route as a websocket')
  return { ...errorReply(refused), headers: { upgrade: 'websocket', connection: 'Upgrade' } }
}

async function issueTicket(request: ApiRequest, { docs, tickets }: Services): Promise<Reply> {
  if (!tickets) throw collabNotServed()
  const body = jsonObject(await request.body())
  const docId = optionalString(body.docId, 'docId') ?? ''
  if (!docs.pathOf(docId)) throw new VaultError(404, 'not_found', 'no such document')
  return { status: 201, body: tickets.issue({ docId, access: collabAccess(body.access) }) }
}

const FILE_METHODS: Methods = new Map([
  ['GET', readFile],
  ['PUT', writeFile],
  ['DELETE', deleteFile],
])
const COLLAB_METHODS: Methods = new Map([['GET', collabDocument]])
const EXACT_ROUTES = new Map<string, Methods>([
  [ROUTES.vault, new Map([['GET', describeVault]])],
  [ROUTES.files, new Map([['GET', listFiles]])],
  [ROUTES.rename, new Map([['POST', renameFile]])],
  [ROUTES.search, new Map([['GET', search]])],
  [ROUTES.sync, new Map([['POST', sync]])],
  [ROUTES.collabTickets, new Map([['POST', issueTicket]])],
])

function decodedPath(encoded: string): VaultPath {
  try {
    return vaultPath(decodeURIComponent(encoded))
  } catch (error) {
    if (error instanceof URIError) throw new VaultError(400, 'invalid_path', 'path is not valid percent-encoding')
    throw error
  }
}

interface Resolved {
  methods: Methods
  /** Set for file routes only. */
  path: VaultPath
}

const NO_PATH = '' as VaultPath

function resolveRoute(pathname: string): Resolved | null {
  const exact = EXACT_ROUTES.get(pathname)
  if (exact) return { methods: exact, path: NO_PATH }
  if (pathname.startsWith(`${ROUTES.files}/`)) {
    return { methods: FILE_METHODS, path: decodedPath(pathname.slice(ROUTES.files.length + 1)) }
  }
  if (pathname.startsWith(`${ROUTES.collabDocs}/`)) return { methods: COLLAB_METHODS, path: NO_PATH }
  return null
}

/** Finds the handler for a request and runs it. Throws `VaultError` for anything it refuses. */
export async function route(request: ApiRequest, services: Services): Promise<Reply> {
  const resolved = resolveRoute(request.url.pathname)
  if (!resolved) throw new VaultError(404, 'not_found', `no route for ${request.url.pathname}`)
  const handler = resolved.methods.get(request.method)
  if (handler) return handler(request, services, resolved.path)
  const refused = new VaultError(405, 'method_not_allowed', `${request.method} is not supported here`)
  return { ...errorReply(refused), headers: { allow: [...resolved.methods.keys()].join(', ') } }
}
