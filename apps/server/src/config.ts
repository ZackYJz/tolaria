import { isIP } from 'node:net'
import { join, resolve } from 'node:path'
import { DEFAULT_FLUSH_POLICY, type FlushPolicy } from './collab/flush.ts'

export interface ServerConfig {
  token: string
  host: string
  port: number
  /** Git URL of the vault's remote. Optional once the working clone exists. */
  remoteUrl?: string
  branch?: string
  /** Directory of the server's working clone of the vault. */
  vaultDir: string
  /** Directory of server state that is not in git (doc index, later Y.Doc snapshots). */
  stateDir: string
  maxBodyBytes: number
  /** Null when the collaboration channel is switched off. */
  collab: { policy: FlushPolicy; lingerMs: number } | null
}

type Env = Record<string, string | undefined>

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024
const MIN_TOKEN_LENGTH = 16
const DEFAULT_LINGER_MS = 30_000
const MAX_DELAY_MS = 24 * 60 * 60 * 1000
const LOOPBACK_NAMES = new Set(['localhost', '::1'])

function setting(env: Env, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}

function positiveInteger(env: Env, name: string, fallback: number, max: number): number {
  const raw = setting(env, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  // Clamping changes anything outside 1..max, so only an in-range integer survives both checks.
  if (Number.isInteger(value) && Math.min(Math.max(value, 1), max) === value) return value
  throw new Error(`${name} must be an integer between 1 and ${max}`)
}

function requiredToken(env: Env): string {
  const token = setting(env, 'TOLARIA_SERVER_TOKEN')
  if (!token) throw new Error('TOLARIA_SERVER_TOKEN is required: the server does not start without a bearer token')
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`TOLARIA_SERVER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`)
  }
  return token
}

export function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_NAMES.has(host.toLowerCase())) return true
  return isIP(host) === 4 && host.startsWith('127.')
}

/** The service speaks plain HTTP, so leaving loopback takes an explicit opt-in. */
function bindHost(env: Env): string {
  const host = setting(env, 'TOLARIA_SERVER_HOST') ?? DEFAULT_HOST
  if (isLoopbackHost(host) || setting(env, 'TOLARIA_SERVER_ALLOW_NON_LOOPBACK') === '1') return host
  throw new Error(
    `refusing to bind ${host}: set TOLARIA_SERVER_ALLOW_NON_LOOPBACK=1 only behind a TLS-terminating proxy`,
  )
}

function collabSettings(env: Env): ServerConfig['collab'] {
  if (setting(env, 'TOLARIA_COLLAB') === '0') return null
  const { idleMs, maxWaitMs } = DEFAULT_FLUSH_POLICY
  return {
    policy: {
      idleMs: positiveInteger(env, 'TOLARIA_COLLAB_IDLE_MS', idleMs, MAX_DELAY_MS),
      maxWaitMs: positiveInteger(env, 'TOLARIA_COLLAB_MAX_WAIT_MS', maxWaitMs, MAX_DELAY_MS),
    },
    lingerMs: positiveInteger(env, 'TOLARIA_COLLAB_LINGER_MS', DEFAULT_LINGER_MS, MAX_DELAY_MS),
  }
}

/** Reads the configuration from the environment. Throws with a message fit for the operator. */
export function loadConfig(env: Env): ServerConfig {
  const token = requiredToken(env)
  const dataDir = resolve(setting(env, 'TOLARIA_SERVER_DATA_DIR') ?? 'data')
  return {
    token,
    host: bindHost(env),
    port: positiveInteger(env, 'TOLARIA_SERVER_PORT', DEFAULT_PORT, 65_535),
    remoteUrl: setting(env, 'TOLARIA_VAULT_REMOTE_URL'),
    branch: setting(env, 'TOLARIA_VAULT_BRANCH'),
    vaultDir: join(dataDir, 'vault'),
    stateDir: join(dataDir, 'state'),
    maxBodyBytes: positiveInteger(env, 'TOLARIA_SERVER_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES, 2 ** 31),
    collab: collabSettings(env),
  }
}
