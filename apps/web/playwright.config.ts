import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Static web bundle lane (TOL-3): serves apps/web/dist with `pnpm preview:web` and
// runs the same checks in desktop Chromium, desktop WebKit and iPhone/iPad
// emulation. Not part of the pre-push smoke lane; run `pnpm build:web` first.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:41760'
const port = new URL(baseURL).port || '41760'
// Collaboration lane (TOL-8): a Tolaria server on loopback with a throwaway vault, seeded
// fresh for every run, reached through the preview server's `/v1` proxy.
const remotePort = process.env.TOLARIA_E2E_REMOTE_PORT ?? '41761'
const remoteUrl = `http://127.0.0.1:${remotePort}`
const remoteDir = join(tmpdir(), `tolaria-web-collab-e2e-${remotePort}`)
export const COLLAB_TOKEN = 'e2e-token-not-a-secret-0123456789'
const COLLAB_SPEC = /collab\.spec\.ts/
const storageState = {
  cookies: [],
  origins: [
    {
      origin: baseURL,
      localStorage: [
        { name: 'tolaria:claude-code-onboarding-dismissed', value: '1' },
      ],
    },
  ],
}

export default defineConfig({
  testDir: './tests',
  outputDir: '../../test-results/web',
  timeout: 45_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    storageState,
  },
  projects: [
    { name: 'chromium', testIgnore: COLLAB_SPEC, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: COLLAB_SPEC, use: { ...devices['Desktop Safari'] } },
    { name: 'iphone-15', testIgnore: COLLAB_SPEC, use: { ...devices['iPhone 15'] } },
    { name: 'ipad', testIgnore: COLLAB_SPEC, use: { ...devices['iPad Pro 11'] } },
    { name: 'ipad-landscape', testIgnore: COLLAB_SPEC, use: { ...devices['iPad Pro 11 landscape'] } },
    // The spec launches Chromium, WebKit and an iPhone itself: they edit one note together.
    { name: 'collab', testMatch: COLLAB_SPEC },
  ],
  webServer: [
    {
      command: `rm -rf "${remoteDir}" && pnpm server:seed "${remoteDir}/remote.git" 0 && pnpm run server`,
      cwd: repoRoot,
      url: `${remoteUrl}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        TOLARIA_SERVER_TOKEN: COLLAB_TOKEN,
        TOLARIA_SERVER_PORT: remotePort,
        TOLARIA_SERVER_DATA_DIR: `${remoteDir}/data`,
        TOLARIA_VAULT_REMOTE_URL: `${remoteDir}/remote.git`,
        TOLARIA_COLLAB_IDLE_MS: '500',
      },
    },
    {
      command: `pnpm preview:web --port ${port}`,
      cwd: repoRoot,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { TOLARIA_REMOTE_URL: remoteUrl },
    },
  ],
})
