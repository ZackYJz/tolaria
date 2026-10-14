import type { SearchResult, VaultEntry } from '../../types'

/**
 * VaultBackend: the storage seam between the Tolaria shell and wherever a vault
 * lives (local disk through Tauri, mock data in the browser, or the Tolaria
 * remote). See docs/web/s1-tauri-inventory.md.
 *
 * Two paths, on purpose:
 *  1. `files` — plain file operations. Writes carry the revision the edit was
 *     based on, so whole-file last-write-wins is only what happens when a
 *     caller explicitly omits it (offline/single-user fallback).
 *  2. `collab` — a live collaborative document per note (a Y.Doc on the web).
 *     Markdown files stay canonical for export, git and desktop; the document
 *     channel is the primary write path where it exists. Backends without it
 *     (desktop, mock) expose `collab: null`.
 */

/** Bumped when the interface changes shape, so collaboration stays additive. */
export const VAULT_BACKEND_INTERFACE_VERSION = 1

/** Opaque token identifying one stored version of a file. Never parse it. */
export type VaultRevision = string

export interface VaultFile {
  path: string
  content: string
  revision: VaultRevision
}

export interface VaultWriteOptions {
  /**
   * The revision this edit was based on.
   *  - a revision: write only if the stored file is still at that revision.
   *  - `null`: create; fail with a conflict if the file already exists.
   *  - omitted: unconditional overwrite (last-write-wins fallback).
   */
  baseRevision?: VaultRevision | null
}

export type VaultWriteResult =
  | { status: 'written'; revision: VaultRevision }
  /** `current` is the stored file that won, or `null` when it could not be read. */
  | { status: 'conflict'; current: VaultFile | null }

export type VaultRenameRequest =
  | { path: string; newTitle: string; oldTitle?: string }
  | { path: string; newFilenameStem: string }

export interface VaultRenameResult {
  newPath: string
  /** Other notes whose wikilinks were rewritten to follow the rename. */
  updatedFiles: number
  failedUpdates: number
}

export interface VaultSearchOptions {
  limit?: number
  excludeFrontmatter?: boolean
}

export interface VaultSearchResponse {
  results: SearchResult[]
  elapsedMs: number
}

export interface VaultAttachmentUpload {
  filename: string
  bytes: Uint8Array
}

export interface VaultAttachment {
  /** Backend-native location of the stored attachment. */
  path: string
}

export interface VaultFileOps {
  list(): Promise<VaultEntry[]>
  read(path: string): Promise<VaultFile>
  write(path: string, content: string, options?: VaultWriteOptions): Promise<VaultWriteResult>
  rename(request: VaultRenameRequest): Promise<VaultRenameResult>
  /** Resolves with the paths that were actually deleted. */
  delete(paths: string[]): Promise<string[]>
  search(query: string, options?: VaultSearchOptions): Promise<VaultSearchResponse>
  saveAttachment(upload: VaultAttachmentUpload): Promise<VaultAttachment>
}

/**
 * What an editor needs to bind to a live document. The members are typed by
 * the implementing package (yjs `Doc`/`XmlFragment`, a y-protocols `Awareness`
 * and a websocket provider on the web) so this module stays free of a yjs
 * dependency. `fragment`, `provider` and the awareness user map directly onto
 * BlockNote's `collaboration` editor option.
 */
export interface VaultCollabBindings {
  doc: unknown
  fragment: unknown
  provider: unknown
  awareness: unknown
}

export interface VaultCollabUser {
  name: string
  color: string
}

export interface VaultCollabOpenOptions {
  user?: VaultCollabUser
  /** Join without the ability to edit (shared read-only links). */
  readOnly?: boolean
}

export type VaultCollabDoc<TBindings extends VaultCollabBindings = VaultCollabBindings> = TBindings & {
  path: string
  /** Resolves once the local document has caught up with the server state. */
  synced: Promise<void>
  /** Leave the document: drops presence and releases the connection. */
  close(): void
}

export interface VaultCollabChannel<TBindings extends VaultCollabBindings = VaultCollabBindings> {
  openDoc(path: string, options?: VaultCollabOpenOptions): Promise<VaultCollabDoc<TBindings>>
}

export interface VaultBackendCapabilities {
  /** `collab` is available: notes can be opened as live documents. */
  collaboration: boolean
  /** Revision checks are enforced by the store itself, not compare-then-write in the client. */
  atomicRevisions: boolean
  attachments: boolean
}

export type VaultBackendKind = 'tauri' | 'mock' | 'remote'

export interface VaultBackend<TBindings extends VaultCollabBindings = VaultCollabBindings> {
  kind: VaultBackendKind
  interfaceVersion: number
  capabilities: VaultBackendCapabilities
  files: VaultFileOps
  collab: VaultCollabChannel<TBindings> | null
}
