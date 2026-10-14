import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Key/value storage for server-side state that is not part of the vault's git history
 * (the doc index, later Y.Doc snapshots). Keys are `/`-separated, so the same interface maps
 * onto an S3-compatible bucket; the spike only ships the local-disk implementation.
 */
export interface BlobStore {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, bytes: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

const SAFE_KEY = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export class LocalDiskStore implements BlobStore {
  private readonly root: string
  private writes = 0

  constructor(root: string) {
    this.root = root
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.file(key))
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  /** Atomic: readers see the old or the new value, never a torn one. */
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.file(key)
    const temp = `${file}.${process.pid}.${this.writes++}.tmp`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(temp, bytes)
    await rename(temp, file)
  }

  async delete(key: string): Promise<void> {
    await rm(this.file(key), { force: true })
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const names = await readdir(this.file(prefix))
      return names.filter((name) => !name.endsWith('.tmp')).map((name) => `${prefix}/${name}`)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  /** Keys are a closed alphabet with no dot-led segment, so a key cannot leave the root. */
  private file(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`invalid store key: ${key}`)
    return join(this.root, key)
  }
}
