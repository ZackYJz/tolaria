import type { SearchResult, VaultEntry } from '../../types'
import { contentRevision } from './contentRevision'
import {
  VAULT_BACKEND_INTERFACE_VERSION,
  type VaultAttachment,
  type VaultAttachmentUpload,
  type VaultBackend,
  type VaultBackendKind,
  type VaultFile,
  type VaultFileOps,
  type VaultRenameRequest,
  type VaultRenameResult,
  type VaultRevision,
  type VaultSearchResponse,
  type VaultWriteResult,
} from './types'

/**
 * VaultBackend over the existing command surface: the same adapter serves the
 * Tauri `invoke` and the browser `mockInvoke`, which already share command
 * names. The two differ only in argument casing and a few command aliases,
 * captured by `CommandDialect`. Neither store versions files, so revisions are
 * content hashes and the base-revision check is compare-then-write in the
 * client (`atomicRevisions: false`).
 */

export type CommandInvoker = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export type CommandDialect = Extract<VaultBackendKind, 'tauri' | 'mock'>

export interface CommandVaultBackendOptions {
  dialect: CommandDialect
  invoke: CommandInvoker
  vaultPath: string
}

interface NoteDraft {
  path: string
  content: string
}

interface RawRenameResult {
  new_path: string
  updated_files: number
  failed_updates?: number
}

interface RawSearchResult {
  title: string
  path: string
  snippet: string
  score: number
  note_type: string | null
}

interface RawSearchResponse {
  results: RawSearchResult[]
  elapsed_ms: number
}

const FILE_EXISTS_ERROR = /already exists/i
const BASE64_CHUNK_SIZE = 0x8000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toVaultFile({ path, content }: NoteDraft): VaultFile {
  return { path, content, revision: contentRevision(content) }
}

function written({ content }: NoteDraft): VaultWriteResult {
  return { status: 'written', revision: contentRevision(content) }
}

function toSearchResult(raw: RawSearchResult): SearchResult {
  return { title: raw.title, path: raw.path, snippet: raw.snippet, score: raw.score, noteType: raw.note_type }
}

function toRenameResult(raw: RawRenameResult): VaultRenameResult {
  return { newPath: raw.new_path, updatedFiles: raw.updated_files, failedUpdates: raw.failed_updates ?? 0 }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

function renameCommand(request: VaultRenameRequest): 'rename_note' | 'rename_note_filename' {
  return 'newTitle' in request ? 'rename_note' : 'rename_note_filename'
}

type RenameArgsBuilder = (request: VaultRenameRequest, options: CommandVaultBackendOptions) => Record<string, unknown>

const tauriRenameArgs: RenameArgsBuilder = (request, { vaultPath }) => {
  const target = 'newTitle' in request
    ? { newTitle: request.newTitle, oldTitle: request.oldTitle ?? null }
    : { newFilenameStem: request.newFilenameStem }
  return { args: { vaultPath, oldPath: request.path, ...target } }
}

const mockRenameArgs: RenameArgsBuilder = (request, { vaultPath }) => {
  const target = 'newTitle' in request
    ? { new_title: request.newTitle, old_title: request.oldTitle ?? null }
    : { new_filename_stem: request.newFilenameStem }
  return { vault_path: vaultPath, old_path: request.path, ...target }
}

function createFileOps(options: CommandVaultBackendOptions): VaultFileOps {
  const { dialect, invoke, vaultPath } = options
  const isTauri = dialect === 'tauri'

  const read = async (path: string): Promise<VaultFile> =>
    toVaultFile({ path, content: await invoke<string>('get_note_content', { path, vaultPath }) })

  const readOrNull = (path: string): Promise<VaultFile | null> => read(path).catch(() => null)

  const save = async (draft: NoteDraft): Promise<VaultWriteResult> => {
    await invoke<void>('save_note_content', { ...draft, vaultPath })
    return written(draft)
  }

  // The mock store has no create-exclusive command; the shell saves new notes directly there too.
  const create = async (draft: NoteDraft): Promise<VaultWriteResult> => {
    if (!isTauri) return save(draft)
    try {
      await invoke<void>('create_note_content', { ...draft, vaultPath })
      return written(draft)
    } catch (error) {
      if (!FILE_EXISTS_ERROR.test(errorMessage(error))) throw error
      return { status: 'conflict', current: await readOrNull(draft.path) }
    }
  }

  const saveIfUnchanged = async (draft: NoteDraft, baseRevision: VaultRevision): Promise<VaultWriteResult> => {
    const current = await readOrNull(draft.path)
    if (current?.revision !== baseRevision) return { status: 'conflict', current }
    return save(draft)
  }

  const write: VaultFileOps['write'] = (path, content, { baseRevision } = {}) => {
    const draft = { path, content }
    if (baseRevision === undefined) return save(draft)
    if (baseRevision === null) return create(draft)
    return saveIfUnchanged(draft, baseRevision)
  }

  const rename = async (request: VaultRenameRequest): Promise<VaultRenameResult> => {
    const args = (isTauri ? tauriRenameArgs : mockRenameArgs)(request, options)
    return toRenameResult(await invoke<RawRenameResult>(renameCommand(request), args))
  }

  const search: VaultFileOps['search'] = async (query, searchOptions = {}): Promise<VaultSearchResponse> => {
    const args = { vaultPath, query, mode: 'keyword', ...searchOptions }
    const raw = await invoke<RawSearchResponse>('search_vault', args)
    return { results: raw.results.map(toSearchResult), elapsedMs: raw.elapsed_ms }
  }

  const saveAttachment = async ({ filename, bytes }: VaultAttachmentUpload): Promise<VaultAttachment> => {
    const data = bytesToBase64(bytes)
    const args = isTauri ? { vaultPath, filename, data } : { vault_path: vaultPath, filename, data }
    return { path: await invoke<string>('save_image', args) }
  }

  return {
    list: () => invoke<VaultEntry[]>('list_vault', { path: vaultPath }),
    read,
    write,
    rename,
    delete: (paths) => invoke<string[]>(isTauri ? 'batch_delete_notes_async' : 'batch_delete_notes', { paths, vaultPath }),
    search,
    saveAttachment,
  }
}

export function createCommandVaultBackend(options: CommandVaultBackendOptions): VaultBackend {
  return {
    kind: options.dialect,
    interfaceVersion: VAULT_BACKEND_INTERFACE_VERSION,
    capabilities: { collaboration: false, atomicRevisions: false, attachments: true },
    files: createFileOps(options),
    collab: null,
  }
}
