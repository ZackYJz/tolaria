import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDiskStore } from '../src/store.ts'
import { text } from './helpers.ts'

describe('LocalDiskStore', () => {
  let root: string
  let store: LocalDiskStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tolaria-store-test-'))
    store = new LocalDiskStore(root)
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it('returns null for a key that was never written', async () => {
    expect(await store.get('docs/missing')).toBeNull()
  })

  it('stores, overwrites and deletes values', async () => {
    await store.put('docs/a.bin', text('one'))
    await store.put('docs/a.bin', text('two'))
    expect(Buffer.from((await store.get('docs/a.bin')) as Uint8Array).toString()).toBe('two')

    await store.delete('docs/a.bin')
    await store.delete('docs/a.bin')
    expect(await store.get('docs/a.bin')).toBeNull()
  })

  it('lists the keys under a prefix and leaves no temporary files behind', async () => {
    await store.put('docs/a', text('a'))
    await store.put('docs/b', text('b'))
    expect((await store.list('docs')).sort()).toEqual(['docs/a', 'docs/b'])
    expect(await store.list('nothing')).toEqual([])
    expect((await readdir(join(root, 'docs'))).sort()).toEqual(['a', 'b'])
  })

  it.each(['../escape', '/absolute', 'a/../b', 'a//b', '.hidden', 'a/.b', '', 'a b'])(
    'rejects the unsafe key %j',
    async (key) => {
      await expect(store.put(key, text('x'))).rejects.toThrowError(/invalid store key/)
      await expect(store.get(key)).rejects.toThrowError(/invalid store key/)
    },
  )

  it('reports failures other than a missing file', async () => {
    await store.put('docs/a', text('a'))
    await expect(store.get('docs')).rejects.toThrowError(/EISDIR/)
    await expect(store.list('docs/a')).rejects.toThrowError(/ENOTDIR/)
  })
})
