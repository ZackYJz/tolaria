import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLoopbackHost, loadConfig } from '../src/config.ts'

const TOKEN = 'test-token-0123456789'

describe('loadConfig', () => {
  it('refuses to start without a token', () => {
    expect(() => loadConfig({})).toThrowError(/TOLARIA_SERVER_TOKEN is required/)
    expect(() => loadConfig({ TOLARIA_SERVER_TOKEN: '   ' })).toThrowError(/TOLARIA_SERVER_TOKEN is required/)
  })

  it('refuses a token that is too short to be a secret', () => {
    expect(() => loadConfig({ TOLARIA_SERVER_TOKEN: 'short' })).toThrowError(/at least 16 characters/)
  })

  it('binds to loopback on the default port', () => {
    const config = loadConfig({ TOLARIA_SERVER_TOKEN: TOKEN })
    expect(config).toMatchObject({ token: TOKEN, host: '127.0.0.1', port: 8787, maxBodyBytes: 25 * 1024 * 1024 })
    expect(config.remoteUrl).toBeUndefined()
    expect(config.vaultDir).toBe(resolve('data', 'vault'))
    expect(config.stateDir).toBe(resolve('data', 'state'))
  })

  it('reads the vault remote, branch, data directory, port and body limit', () => {
    const config = loadConfig({
      TOLARIA_SERVER_TOKEN: TOKEN,
      TOLARIA_SERVER_PORT: '9000',
      TOLARIA_SERVER_DATA_DIR: '/srv/tolaria',
      TOLARIA_VAULT_REMOTE_URL: ' git@github.com:someone/vault.git ',
      TOLARIA_VAULT_BRANCH: 'main',
      TOLARIA_SERVER_MAX_BODY_BYTES: '1024',
    })
    expect(config).toMatchObject({
      port: 9000,
      remoteUrl: 'git@github.com:someone/vault.git',
      branch: 'main',
      vaultDir: '/srv/tolaria/vault',
      stateDir: '/srv/tolaria/state',
      maxBodyBytes: 1024,
    })
  })

  it.each(['abc', '0', '-1', '80.5', '70000'])('rejects the port %j', (port) => {
    expect(() => loadConfig({ TOLARIA_SERVER_TOKEN: TOKEN, TOLARIA_SERVER_PORT: port })).toThrowError(
      /TOLARIA_SERVER_PORT must be an integer/,
    )
  })

  it('refuses a non-loopback address unless explicitly allowed', () => {
    const env = { TOLARIA_SERVER_TOKEN: TOKEN, TOLARIA_SERVER_HOST: '0.0.0.0' }
    expect(() => loadConfig(env)).toThrowError(/refusing to bind 0.0.0.0/)
    expect(loadConfig({ ...env, TOLARIA_SERVER_ALLOW_NON_LOOPBACK: '1' }).host).toBe('0.0.0.0')
  })
})

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1'])('accepts %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
  })

  it.each(['0.0.0.0', '192.168.1.10', '::', '127.evil.example', 'example.com'])('rejects %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })
})

describe('collaboration settings', () => {
  it('serves the channel by default, flushing after 5 s of quiet or 60 s of typing', () => {
    expect(loadConfig({ TOLARIA_SERVER_TOKEN: TOKEN }).collab).toEqual({
      policy: { idleMs: 5_000, maxWaitMs: 60_000 },
      lingerMs: 30_000,
    })
  })

  it('reads the cadence from the environment', () => {
    const config = loadConfig({
      TOLARIA_SERVER_TOKEN: TOKEN,
      TOLARIA_COLLAB_IDLE_MS: '2000',
      TOLARIA_COLLAB_MAX_WAIT_MS: '30000',
      TOLARIA_COLLAB_LINGER_MS: '1000',
    })

    expect(config.collab).toEqual({ policy: { idleMs: 2_000, maxWaitMs: 30_000 }, lingerMs: 1_000 })
  })

  it('switches the channel off with TOLARIA_COLLAB=0 and refuses a cadence that is no number', () => {
    expect(loadConfig({ TOLARIA_SERVER_TOKEN: TOKEN, TOLARIA_COLLAB: '0' }).collab).toBeNull()
    expect(() => loadConfig({ TOLARIA_SERVER_TOKEN: TOKEN, TOLARIA_COLLAB_IDLE_MS: 'soon' })).toThrowError(/TOLARIA_COLLAB_IDLE_MS/)
  })
})
