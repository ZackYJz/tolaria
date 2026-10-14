import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  DOC_ID_HEADER,
  type ListResponse,
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type VaultResponse,
  type WriteResult,
} from '../../../packages/protocol/src/index.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blobEtag } from '../src/paths.ts'
import { createVaultServer } from '../src/server.ts'
import { LocalDiskStore } from '../src/store.ts'
import type { Vault } from '../src/vault.ts'
import { createFixture, type Fixture, SEED_NOTES, text } from './helpers.ts'

const TOKEN = 'test-token-0123456789'
const WELCOME_ETAG = blobEtag(text(SEED_NOTES['welcome.md']))
const UUID = /^[0-9a-f-]{36}$/

let fixture: Fixture
let vault: Vault
let server: Server
let base: string
let logs: string[]

async function start(maxBodyBytes = 1024 * 1024): Promise<void> {
  server = await createVaultServer({
    vault,
    store: new LocalDiskStore(join(fixture.root, 'server', 'state')),
    token: TOKEN,
    maxBodyBytes,
    // The file API on its own; the collaboration channel is covered in collabServer.test.ts.
    collab: false,
    log: (message) => logs.push(message),
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function stop(): Promise<void> {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

beforeEach(async () => {
  fixture = await createFixture()
  logs = []
  vault = await fixture.openVault({ now: () => new Date('2026-10-10T19:03:00Z') })
  await start()
})

afterEach(async () => {
  await stop()
  await vault.idle()
  await fixture.cleanup()
})

interface Call {
  path: string
  init: RequestInit
}

/** Every request goes to the server this test started on loopback, with the test token. */
function call({ path, init }: Call): Promise<Response> {
  const headers = { authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string>) }
  return fetch(new URL(path, base), { ...init, headers })
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return call({ path, init })
}

function put(path: string, body: string, headers: Record<string, string>): Promise<Response> {
  return api(`/v1/files/${path}`, { method: 'PUT', body, headers })
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe('access', () => {
  it('answers the health check without a token and without vault details', async () => {
    const response = await fetch(new URL('/healthz', base))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it.each([
    ['no header', {}],
    ['a wrong token', { authorization: 'Bearer wrong-token-0123456789' }],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
  ])('rejects %s with 401', async (_label, headers) => {
    const response = await fetch(new URL('/v1/files', base), { headers })
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(await errorCode(response)).toBe('unauthorized')
  })

  it('states its protocol version on every response and refuses another major', async () => {
    const ok = await api('/v1/vault', { headers: { [PROTOCOL_HEADER]: '1.4' } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get(PROTOCOL_HEADER)).toBe(PROTOCOL_VERSION)

    const refused = await api('/v1/vault', { headers: { [PROTOCOL_HEADER]: '2.0' } })
    expect(refused.status).toBe(400)
    expect(refused.headers.get(PROTOCOL_HEADER)).toBe(PROTOCOL_VERSION)
    expect(await errorCode(refused)).toBe('unsupported_protocol_version')
  })

  it('answers 404 for unknown routes and 405 with Allow for unsupported methods', async () => {
    const unknown = await api('/v2/files')
    expect(unknown.status).toBe(404)
    const wrongMethod = await api('/v1/files/welcome.md', { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET, PUT, DELETE')
    expect(await errorCode(wrongMethod)).toBe('method_not_allowed')
  })

  it('hides the cause of an unexpected failure and logs it', async () => {
    vault.list = () => Promise.reject(new Error('disk on fire'))
    const response = await api('/v1/files')
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'internal', message: 'internal error' } })
    expect(logs.join('\n')).toContain('disk on fire')
  })
})

describe('GET /v1/vault', () => {
  it('describes the vault, the file capabilities and the reserved collaboration channel', async () => {
    const meta = (await (await api('/v1/vault')).json()) as VaultResponse
    expect(meta.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(meta.vault).toMatchObject({ name: 'remote', branch: 'main' })
    expect(meta.capabilities).toContain('files.conflict-copy')
    expect(meta.capabilities).not.toContain('collab.yjs')
    expect(meta.collab).toEqual({
      available: false,
      path: '/v1/collab/docs',
      docFormat: 'tolaria.blocknote/1',
      blocksFragment: 'blocks',
      frontmatterField: 'frontmatter',
      metaMap: 'meta',
    })
  })

  it('answers 501 on the reserved collaboration channel', async () => {
    const response = await api('/v1/collab/docs/7f0c1f6e-0000-4000-8000-000000000000')
    expect(response.status).toBe(501)
    expect(await errorCode(response)).toBe('not_implemented')
  })
})

describe('files', () => {
  it('lists files with etags, and doc ids for notes only', async () => {
    const { head, files } = (await (await api('/v1/files')).json()) as ListResponse
    expect(head).toMatch(/^[0-9a-f]{40}$/)
    const welcome = files.find((file) => file.path === 'welcome.md')
    expect(welcome).toMatchObject({ etag: WELCOME_ETAG, docId: expect.stringMatching(UUID) })
    expect(files.find((file) => file.path === 'attachments/pixel.bin')?.docId).toBeUndefined()

    const filtered = (await (await api('/v1/files?prefix=projects/')).json()) as ListResponse
    expect(filtered.files.map((file) => file.path)).toEqual(['projects/alpha.md'])
  })

  it('reads a note with its etag and doc id, and answers 304 when the client has it', async () => {
    const response = await api('/v1/files/welcome.md')
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe(`"${WELCOME_ETAG}"`)
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get(DOC_ID_HEADER)).toMatch(UUID)
    expect(await response.text()).toBe(SEED_NOTES['welcome.md'])

    const cached = await api('/v1/files/welcome.md', { headers: { 'if-none-match': `"${WELCOME_ETAG}"` } })
    expect(cached.status).toBe(304)
  })

  it('reads attachments as bytes and decodes percent-encoded paths', async () => {
    const attachment = await api('/v1/files/attachments/pixel.bin')
    expect(attachment.headers.get('content-type')).toBe('application/octet-stream')
    expect(new Uint8Array(await attachment.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0, 1, 2]))

    await put('my%20notes/caf%C3%A9.md', '# Café\n', { 'if-none-match': '*' })
    expect(await (await api('/v1/files/my%20notes/caf%C3%A9.md')).text()).toBe('# Café\n')
  })

  it.each([
    ['/v1/files/missing.md', 404, 'not_found'],
    ['/v1/files/.git/config', 400, 'invalid_path'],
    ['/v1/files/a/%2e%2e%2f%2e%2e%2fetc%2fpasswd', 400, 'invalid_path'],
    ['/v1/files/bad%ZZ.md', 400, 'invalid_path'],
  ])('answers GET %s with %i %s', async (path, status, code) => {
    const response = await api(path)
    expect(response.status).toBe(status)
    expect(await errorCode(response)).toBe(code)
  })
})

describe('PUT /v1/files', () => {
  it('requires a precondition, so no client overwrites by accident', async () => {
    const response = await put('welcome.md', 'oops\n', {})
    expect(response.status).toBe(428)
    expect(await errorCode(response)).toBe('precondition_required')
    expect(await (await api('/v1/files/welcome.md')).text()).toBe(SEED_NOTES['welcome.md'])
  })

  it('updates a file edited from the current revision', async () => {
    const response = await put('welcome.md', 'edited\n', { 'if-match': `"${WELCOME_ETAG}"` })
    expect(response.status).toBe(200)
    expect(response.headers.get('server-timing')).toMatch(/^pull;dur=[\d.]+, commit;dur=[\d.]+, push;dur=[\d.]+$/)
    const result = (await response.json()) as WriteResult
    expect(result).toMatchObject({ outcome: 'updated', path: 'welcome.md', pushed: true })
    expect(result).not.toHaveProperty('timings')
    expect(response.headers.get('etag')).toBe(`"${result.etag}"`)
    expect(await fixture.desktop.read('welcome.md')).toBe('edited\n')
  })

  it('creates a note with 201 and gives it a doc id', async () => {
    const response = await put('inbox/new.md', '# New\n', { 'if-none-match': '*' })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ outcome: 'created', docId: expect.stringMatching(UUID) })
  })

  it('overwrites unconditionally only with If-Match: *', async () => {
    const response = await put('welcome.md', 'forced\n', { 'if-match': '*' })
    expect(response.status).toBe(200)
    expect(await (await api('/v1/files/welcome.md')).text()).toBe('forced\n')
  })

  it('answers 409 with a conflict copy when the desktop changed the file first', async () => {
    await fixture.desktop.commit('welcome.md', 'desktop version\n')
    const response = await put('welcome.md', 'web version\n', { 'if-match': `"${WELCOME_ETAG}"` })

    expect(response.status).toBe(409)
    const result = (await response.json()) as WriteResult
    expect(result).toMatchObject({
      outcome: 'conflict',
      path: 'welcome (conflict 2026-10-10 1903).md',
      current: { path: 'welcome.md', etag: blobEtag(text('desktop version\n')) },
      docId: expect.stringMatching(UUID),
    })
    expect(await (await api('/v1/files/welcome.md')).text()).toBe('desktop version\n')
    expect(await (await api(`/v1/files/${encodeURIComponent(result.path)}`)).text()).toBe('web version\n')
    const welcome = await api('/v1/files/welcome.md')
    expect(result.docId).not.toBe(welcome.headers.get(DOC_ID_HEADER))
  })

  it('refuses a body over the limit, whether declared or streamed', async () => {
    await stop()
    await start(8)
    const declared = await put('big.md', '123456789', { 'if-none-match': '*' })
    expect(declared.status).toBe(413)
    expect(await errorCode(declared)).toBe('payload_too_large')

    const chunks = new ReadableStream({
      start(controller) {
        controller.enqueue(text('12345'))
        controller.enqueue(text('67890'))
        controller.close()
      },
    })
    const streamed = await api('/v1/files/big.md', {
      method: 'PUT',
      body: chunks,
      headers: { 'if-none-match': '*' },
      duplex: 'half',
    } as RequestInit)
    expect(streamed.status).toBe(413)
    expect((await api('/v1/files/big.md')).status).toBe(404)
  })
})

describe('DELETE /v1/files', () => {
  it('requires the etag of the file being deleted', async () => {
    expect((await api('/v1/files/welcome.md', { method: 'DELETE' })).status).toBe(428)
    expect((await api('/v1/files/welcome.md', { method: 'DELETE', headers: { 'if-match': '*' } })).status).toBe(428)
    const stale = await api('/v1/files/welcome.md', { method: 'DELETE', headers: { 'if-match': '"stale"' } })
    expect(stale.status).toBe(412)
  })

  it('deletes the file and pushes the commit', async () => {
    const response = await api('/v1/files/welcome.md', { method: 'DELETE', headers: { 'if-match': `"${WELCOME_ETAG}"` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ path: 'welcome.md', pushed: true })
    expect((await api('/v1/files/welcome.md')).status).toBe(404)
  })
})

describe('POST /v1/rename', () => {
  function rename(body: unknown): Promise<Response> {
    const payload = typeof body === 'string' ? body : JSON.stringify(body)
    return api('/v1/rename', { method: 'POST', body: payload })
  }

  it('renames a note and keeps its doc id', async () => {
    const before = (await api('/v1/files/welcome.md')).headers.get(DOC_ID_HEADER)
    const response = await rename({ from: 'welcome.md', to: 'archive/hello.md', ifMatch: WELCOME_ETAG })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ from: 'welcome.md', path: 'archive/hello.md', docId: before })
    expect((await api('/v1/files/welcome.md')).status).toBe(404)
  })

  it.each([
    ['not json', 400, 'invalid_request'],
    [[], 400, 'invalid_request'],
    [{ from: 'welcome.md' }, 400, 'invalid_path'],
    [{ from: 'welcome.md', to: '../escape.md' }, 400, 'invalid_path'],
    [{ from: 'welcome.md', to: 'x.md', ifMatch: 7 }, 400, 'invalid_request'],
    [{ from: 'welcome.md', to: 'projects/alpha.md' }, 409, 'destination_exists'],
    [{ from: 'welcome.md', to: 'x.md', ifMatch: 'stale' }, 412, 'precondition_failed'],
  ])('answers %j with %i %s', async (body, status, code) => {
    const response = await rename(body)
    expect(response.status).toBe(status)
    expect(await errorCode(response)).toBe(code)
  })
})

describe('GET /v1/search', () => {
  it('searches note text', async () => {
    const response = await api('/v1/search?q=heron&limit=5')
    expect(await response.json()).toEqual({
      results: [
        {
          path: 'projects/alpha.md',
          pathMatch: false,
          matches: [{ line: 3, text: 'Links to [[welcome]] and mentions the Heron.' }],
        },
      ],
      truncated: false,
    })
  })

  it.each(['/v1/search', '/v1/search?q=%20', '/v1/search?q=a%0Ab', `/v1/search?q=${'a'.repeat(201)}`, '/v1/search?q=a&limit=0', '/v1/search?q=a&limit=x'])(
    'rejects %s',
    async (path) => {
      const response = await api(path)
      expect(response.status).toBe(400)
      expect(await errorCode(response)).toBe('invalid_request')
    },
  )

  it('caps the limit instead of failing', async () => {
    expect((await api('/v1/search?q=e&limit=100000')).status).toBe(200)
  })
})

describe('POST /v1/sync', () => {
  it('pulls desktop pushes; a note renamed on the desktop keeps its doc id', async () => {
    const before = (await api('/v1/files/welcome.md')).headers.get(DOC_ID_HEADER)
    await fixture.desktop.rename('welcome.md', 'hello.md')
    await fixture.desktop.commit('projects/beta.md', '# Beta\n')

    const response = await api('/v1/sync', { method: 'POST' })
    expect(await response.json()).toMatchObject({ pulled: true, pushed: true })
    expect((await api('/v1/files/hello.md')).headers.get(DOC_ID_HEADER)).toBe(before)
    expect((await api('/v1/files/projects/beta.md')).headers.get(DOC_ID_HEADER)).toMatch(UUID)
  })
})
