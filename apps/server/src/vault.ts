import { basename } from 'node:path'
import type {
  DeleteResult,
  FileEntry,
  ListResponse,
  RenameResult,
  SearchResponse,
  SyncResult,
  WriteOutcome,
  WriteResult,
} from '../../../packages/protocol/src/index.ts'
import { notFound, stale, VaultError } from './errors.ts'
import { GitRepo, REMOTE, type RepoOptions } from './gitRepo.ts'
import { GitSync, type VaultChange } from './gitSync.ts'
import { blobEtag, conflictCopyPath, type VaultPath } from './paths.ts'
import { searchVault } from './search.ts'

export interface VaultOptions extends RepoOptions {
  now?: () => Date
  log?: (message: string) => void
}

/** Revision of a file's content: its git blob id. */
export type Etag = string

interface Placement {
  outcome: WriteOutcome
  path: VaultPath
}

/** The revision a write is based on: the HTTP precondition of the request. */
export type WritePrecondition =
  /** `If-Match: "<etag>"`: the client edited this revision. */
  | { kind: 'match'; etag: Etag }
  /** `If-None-Match: *`: the client believes the file does not exist yet. */
  | { kind: 'absent' }
  /** `If-Match: *`: explicit last-write-wins overwrite. */
  | { kind: 'any' }

export interface Timings {
  pullMs: number
  commitMs: number
  pushMs: number
}

export type TimedWriteResult = WriteResult & { timings: Timings }

/** The stored version of a file, handed to a `FileProducer`. */
export interface StoredFile {
  bytes: Buffer
  etag: Etag
}

/** Computes the new content of a file from what is stored (null: no such file), or null to skip. */
export type FileProducer = (current: StoredFile | null) => Promise<Uint8Array | null>

interface PendingWrite {
  path: VaultPath
  bytes: Uint8Array
  precondition: WritePrecondition
}

interface PullClock {
  started: number
  pulled: number
}

/** Called with the vault lock held, for every change to the vault's files. */
export type ChangeListener = (changes: VaultChange[]) => Promise<void>

const SYMLINK_MODE = '120000'

function createOutcome(precondition: WritePrecondition): WriteOutcome {
  // The client edited a file that has since been deleted: its edit wins and the file returns.
  if (precondition.kind === 'match') return 'recreated'
  return 'created'
}

function overwriteOutcome(current: Etag, precondition: WritePrecondition): WriteOutcome {
  if (precondition.kind === 'any') return 'updated'
  if (precondition.kind === 'match' && precondition.etag === current) return 'updated'
  return 'conflict'
}

/** Decides what a write does from the stored revision, the new one and the client's base. */
export function writeOutcome(
  current: Etag | null,
  incoming: Etag,
  precondition: WritePrecondition,
): WriteOutcome {
  if (current === incoming) return 'unchanged'
  return current === null ? createOutcome(precondition) : overwriteOutcome(current, precondition)
}

function commitMessage(outcome: WriteOutcome, path: VaultPath): string {
  if (outcome === 'conflict') return `Conflict copy of ${path}`
  return `${outcome === 'updated' ? 'Update' : 'Create'} ${path}`
}

function parseTreeRecord(record: string): FileEntry | null {
  const tab = record.indexOf('\t')
  if (tab < 0) return null
  // `<mode> <type> <object> <size>`, the size padded with spaces.
  const [mode, type, etag, size] = record.slice(0, tab).split(' ').filter(Boolean)
  if (type !== 'blob' || mode === SYMLINK_MODE) return null
  return { path: record.slice(tab + 1), size: Number(size), etag }
}

/**
 * One vault = one git working clone owned by this process. Every mutation runs under a
 * single lock as: fetch + integrate upstream, change files, commit, push.
 */
export class Vault {
  private readonly repo: GitRepo
  private readonly sync: GitSync
  private readonly now: () => Date
  private readonly listeners: ChangeListener[] = []
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(repo: GitRepo, options: VaultOptions) {
    this.repo = repo
    this.now = options.now ?? (() => new Date())
    this.sync = new GitSync(repo, {
      log: options.log ?? (() => {}),
      conflictPath: (path) => this.conflictPath(path),
      onChanges: (changes) => this.emit(changes),
    })
  }

  static async open(options: VaultOptions): Promise<Vault> {
    return new Vault(await GitRepo.open(options), options)
  }

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener)
  }

  async info(): Promise<{ name: string; branch: string; head: string }> {
    const url = (await this.repo.run(['remote', 'get-url', REMOTE])).stdout.trim()
    const name = basename(url).replace(/\.git$/, '')
    return { name, branch: this.repo.branch, head: await this.repo.head() }
  }

  async list(prefix = ''): Promise<ListResponse> {
    const head = await this.repo.head()
    const tree = await this.repo.run(['ls-tree', '-r', '-l', '-z', head])
    const files: FileEntry[] = []
    for (const record of tree.stdout.split('\0')) {
      const entry = parseTreeRecord(record)
      if (entry?.path.startsWith(prefix)) files.push(entry)
    }
    return { head, files }
  }

  async read(path: VaultPath): Promise<{ bytes: Buffer; etag: string }> {
    const bytes = await this.repo.readIfExists(path)
    if (!bytes) throw notFound(path)
    return { bytes, etag: blobEtag(bytes) }
  }

  write(path: VaultPath, bytes: Uint8Array, precondition: WritePrecondition): Promise<TimedWriteResult> {
    return this.locked(async () => {
      const started = performance.now()
      await this.sync.pull()
      return this.storeAndPush({ path, bytes, precondition }, { started, pulled: performance.now() })
    })
  }

  /**
   * Rewrites a file with content computed from its current state. `produce` runs under the
   * lock and after the pull, so what it is given is what the write replaces: a change from
   * the git remote cannot slip in between. Returning null leaves the file alone.
   */
  update(path: VaultPath, produce: FileProducer): Promise<TimedWriteResult | null> {
    return this.locked(async () => {
      const started = performance.now()
      await this.sync.pull()
      const pulled = performance.now()
      const current = await this.repo.readIfExists(path)
      const bytes = await produce(current ? { bytes: current, etag: blobEtag(current) } : null)
      if (!bytes) return null
      const precondition: WritePrecondition = current ? { kind: 'match', etag: blobEtag(current) } : { kind: 'absent' }
      return this.storeAndPush({ path, bytes, precondition }, { started, pulled })
    })
  }

  private async storeAndPush({ path, bytes, precondition }: PendingWrite, clock: PullClock): Promise<TimedWriteResult> {
    const stored = await this.store(path, bytes, precondition)
    const committed = performance.now()

    this.sync.relocated.clear()
    const pushed = await this.sync.push()
    // Someone pushed the same file between our fetch and our push: upstream keeps the path.
    const moved = this.sync.relocated.get(stored.path)
    const placed: Placement = moved ? { outcome: 'conflict', path: moved } : stored
    const timings = {
      pullMs: clock.pulled - clock.started,
      commitMs: committed - clock.pulled,
      pushMs: performance.now() - committed,
    }
    return { ...(await this.writeResult(path, bytes, placed, pushed)), timings }
  }

  rename(from: VaultPath, to: VaultPath, ifMatch?: Etag): Promise<RenameResult> {
    return this.locked(async () => {
      await this.sync.pull()
      const etag = await this.currentEtag(from, ifMatch)
      if (this.repo.exists(to)) throw new VaultError(409, 'destination_exists', `${to} already exists`)
      await this.repo.makeParent(to)
      await this.repo.run(['mv', '--', from, to])
      await this.repo.run(['commit', '-q', '-m', `Rename ${from} to ${to}`])
      await this.emit([{ kind: 'rename', from, to }])
      this.sync.relocated.clear()
      const pushed = await this.sync.push()
      // Someone pushed a file at the destination first: theirs keeps it, ours is the conflict copy.
      const path = this.sync.relocated.get(to) ?? to
      return { from, path, etag, commit: await this.repo.head(), pushed }
    })
  }

  remove(path: VaultPath, ifMatch: Etag): Promise<DeleteResult> {
    return this.locked(async () => {
      await this.sync.pull()
      await this.currentEtag(path, ifMatch)
      await this.repo.run(['rm', '-q', '--', path])
      await this.repo.run(['commit', '-q', '-m', `Delete ${path}`])
      await this.emit([{ kind: 'delete', path }])
      const pushed = await this.sync.push()
      return { path, commit: await this.repo.head(), pushed }
    })
  }

  async search(query: string, limit: number): Promise<SearchResponse> {
    const { files } = await this.list()
    return searchVault(this.repo, files, query, limit)
  }

  /** Pull, then push anything still pending. Clients call this to pick up desktop pushes. */
  syncNow(): Promise<SyncResult> {
    return this.locked(async () => {
      const pulled = await this.sync.pull()
      const pushed = await this.sync.push()
      return { head: await this.repo.head(), pulled, pushed }
    })
  }

  /** Resolves once every queued operation has finished. */
  async idle(): Promise<void> {
    await this.queue
  }

  /** Writes and commits the bytes where the precondition allows: the path or a conflict copy. */
  private async store(
    path: VaultPath,
    bytes: Uint8Array,
    precondition: WritePrecondition,
  ): Promise<Placement> {
    const current = await this.repo.readIfExists(path)
    if (!current && this.repo.exists(path)) throw new VaultError(409, 'destination_exists', `${path} is a folder`)
    const outcome = writeOutcome(current ? blobEtag(current) : null, blobEtag(bytes), precondition)
    if (outcome === 'unchanged') return { outcome, path }
    const target = outcome === 'conflict' ? this.conflictPath(path) : path
    await this.repo.commitFile(target, bytes, commitMessage(outcome, path))
    await this.emit([{ kind: 'upsert', path: target }])
    return { outcome, path: target }
  }

  private async writeResult(
    requested: VaultPath,
    bytes: Uint8Array,
    placed: Placement,
    pushed: boolean,
  ): Promise<WriteResult> {
    const result: WriteResult = {
      ...placed,
      etag: blobEtag(bytes),
      commit: await this.repo.head(),
      pushed,
    }
    if (placed.outcome !== 'conflict') return result
    const kept = await this.repo.readIfExists(requested)
    if (kept) result.current = { path: requested, etag: blobEtag(kept) }
    return result
  }

  /** The etag of an existing file, checked against the revision the client last saw. */
  private async currentEtag(path: VaultPath, ifMatch?: Etag): Promise<Etag> {
    const current = await this.repo.readIfExists(path)
    if (!current) throw notFound(path)
    const etag = blobEtag(current)
    if (ifMatch && ifMatch !== etag) throw stale(path, etag)
    return etag
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      try {
        return await fn()
      } catch (error) {
        // An unexpected failure may have left half a change behind; never serve or commit it.
        if (!(error instanceof VaultError)) await this.repo.restoreCleanTree()
        throw error
      }
    })
    this.queue = run.catch(() => {})
    return run
  }

  private async emit(changes: VaultChange[]): Promise<void> {
    if (changes.length === 0) return
    for (const listener of this.listeners) await listener(changes)
  }

  private conflictPath(path: VaultPath): VaultPath {
    return conflictCopyPath(path, this.now(), (candidate) => this.repo.exists(candidate))
  }
}
