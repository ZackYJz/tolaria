// Wire-level constants and shapes of the Tolaria remote protocol (docs/web/protocol.md).
// No runtime dependencies and no Node or DOM APIs: the server and the web client import it as-is.

/** `major.minor`. Minor versions only add; a different major is a different protocol. */
export const PROTOCOL_VERSION = '1.1'
export const PROTOCOL_MAJOR = 1
/** Sent by the server on every response; clients may send it to assert the major they speak. */
export const PROTOCOL_HEADER = 'tolaria-protocol-version'
/** Response header on note reads: the id of the note's collaborative document. */
export const DOC_ID_HEADER = 'tolaria-doc-id'
/** Every route of this major lives under this prefix. */
export const API_PREFIX = '/v1'

export const ROUTES = {
  vault: `${API_PREFIX}/vault`,
  files: `${API_PREFIX}/files`,
  rename: `${API_PREFIX}/rename`,
  search: `${API_PREFIX}/search`,
  sync: `${API_PREFIX}/sync`,
  /** Websocket channel: `${collabDocs}/<docId>` carries the y-protocols sync of one note. */
  collabDocs: `${API_PREFIX}/collab/docs`,
  /** Issues a short-lived ticket that opens one websocket, for clients that cannot send headers. */
  collabTickets: `${API_PREFIX}/collab/tickets`,
} as const

/**
 * Format of the Y.Doc behind a note. Bump when the shared types inside the doc change.
 * BlockNote's collaboration binding edits a `Y.XmlFragment`, so the note body is one,
 * not a `Y.Text` of raw markdown.
 */
export const DOC_FORMAT = 'tolaria.blocknote/1'
/** Name of the `Y.XmlFragment` holding the note body: what BlockNote's `collaboration.fragment` binds to. */
export const DOC_BLOCKS_FRAGMENT = 'blocks'
/** Name of the shared type holding the frontmatter, which BlockNote does not model. */
export const DOC_FRONTMATTER_FIELD = 'frontmatter'
/** Name of the `Y.Map` holding `format` and `baseRevision` (etag of the markdown last reconciled). */
export const DOC_META_MAP = 'meta'
/** Keys of the `meta` map. */
export const DOC_META = {
  format: 'format',
  /** Etag of the markdown file the document was last reconciled with. */
  baseRevision: 'baseRevision',
  /** Path of the conflict copy holding edits that could not be merged with the file. */
  conflictCopy: 'conflictCopy',
} as const

/** First byte (a varint) of every websocket message, as in y-websocket. */
export const COLLAB_MESSAGE = { sync: 0, awareness: 1, queryAwareness: 3 } as const
/**
 * Largest websocket message either side accepts. A server may set a lower limit; a larger
 * message is refused before it is decoded and the connection is closed.
 */
export const COLLAB_MAX_MESSAGE_BYTES = 16 * 1024 * 1024
/** Query parameter carrying a ticket on the websocket URL. */
export const COLLAB_TICKET_PARAM = 'ticket'
/** Websocket close codes the server uses beyond the standard ones. */
export const COLLAB_CLOSE = {
  /** The message could not be read. */
  invalidMessage: 4400,
  /** The note of this document was deleted. */
  gone: 4410,
  /** A change the connection sent is not a valid change to this kind of document. */
  rejectedChange: 4422,
} as const

export type CollabAccess = 'read' | 'write'

export interface CollabTicketRequest {
  docId: string
  /** `read` joins without the ability to edit. Defaults to `write`. */
  access?: CollabAccess
}

export interface CollabTicketResponse {
  ticket: string
  /** ISO 8601 time after which the ticket is refused. */
  expiresAt: string
  /** Websocket path to open, without the ticket parameter. */
  path: string
  access: CollabAccess
}

export const FILE_CAPABILITIES = [
  'files.read',
  'files.write',
  'files.rename',
  'files.delete',
  'files.conflict-copy',
  'search.text',
  'sync.git',
  'docs.ids',
] as const
/** Advertised only by servers that serve the collaboration channel. */
export const COLLAB_CAPABILITIES = ['collab.yjs', 'collab.awareness', 'collab.tickets'] as const

export type Capability =
  | (typeof FILE_CAPABILITIES)[number]
  | (typeof COLLAB_CAPABILITIES)[number]

export interface CollabInfo {
  /** False while the channel is reserved but not served. */
  available: boolean
  /** Websocket path prefix; append `/<docId>`. */
  path: string
  docFormat: string
  blocksFragment: string
  frontmatterField: string
  metaMap: string
}

export interface VaultResponse {
  protocolVersion: string
  capabilities: Capability[]
  vault: { name: string; branch: string; head: string }
  collab: CollabInfo
}

export interface FileEntry {
  path: string
  size: number
  /** Opaque revision of the file content. Send it back as `If-Match` when writing. */
  etag: string
  /** Stable id of the note's collaborative document; survives renames. Notes only. */
  docId?: string
}

export interface ListResponse {
  /** Commit the listing was taken from. */
  head: string
  files: FileEntry[]
}

export type WriteOutcome = 'created' | 'updated' | 'unchanged' | 'recreated' | 'conflict'

export interface WriteResult {
  outcome: WriteOutcome
  /** Where the bytes of this request now live (the conflict copy when `outcome` is "conflict"). */
  path: string
  etag: string
  commit: string
  /** False when the commit is safe on the server but not yet on the git remote. */
  pushed: boolean
  docId?: string
  /** Only on conflict: the version that kept the requested path. */
  current?: { path: string; etag: string }
}

export interface RenameRequest {
  from: string
  to: string
  /** Etag of `from` the client last saw; omit to rename whatever is there. */
  ifMatch?: string
}

export interface RenameResult {
  from: string
  path: string
  etag: string
  commit: string
  pushed: boolean
  docId?: string
}

export interface DeleteResult {
  path: string
  commit: string
  pushed: boolean
}

export interface SearchMatch {
  line: number
  text: string
}

export interface SearchResult {
  path: string
  pathMatch: boolean
  matches: SearchMatch[]
}

export interface SearchResponse {
  results: SearchResult[]
  truncated: boolean
}

export interface SyncResult {
  head: string
  /** False when the git remote could not be reached; the server keeps serving its copy. */
  pulled: boolean
  pushed: boolean
}

export const ERROR_CODES = [
  'unauthorized',
  'invalid_path',
  'invalid_request',
  'not_found',
  'method_not_allowed',
  'destination_exists',
  'precondition_required',
  'precondition_failed',
  'payload_too_large',
  'unsupported_protocol_version',
  'not_implemented',
  'upgrade_required',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown }
}

/** A client can talk to a server when both speak the same major version. */
export function isSupportedProtocolVersion(version: string): boolean {
  const match = /^(\d{1,4})\.\d{1,4}$/.exec(version.trim())
  return match !== null && Number(match[1]) === PROTOCOL_MAJOR
}

export function hasCapability(vault: Pick<VaultResponse, 'capabilities'>, capability: Capability): boolean {
  return vault.capabilities.includes(capability)
}
