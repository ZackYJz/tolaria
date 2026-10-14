import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../../mock-tauri'
import { createCommandVaultBackend } from './commandVaultBackend'
import type { VaultBackend } from './types'

export * from './types'
export { contentRevision } from './contentRevision'
export { createCommandVaultBackend } from './commandVaultBackend'
export type { CommandDialect, CommandInvoker, CommandVaultBackendOptions } from './commandVaultBackend'

/** The desktop path: Tauri commands backed by the Rust vault crate. */
export function createTauriVaultBackend(vaultPath: string): VaultBackend {
  return createCommandVaultBackend({ dialect: 'tauri', invoke, vaultPath })
}

/** The browser path: mock data, or the dev vault API when it is running. */
export function createMockVaultBackend(vaultPath: string): VaultBackend {
  return createCommandVaultBackend({ dialect: 'mock', invoke: mockInvoke, vaultPath })
}

/** Picks the backend for the current runtime. A remote backend plugs in here. */
export function createVaultBackend(vaultPath: string): VaultBackend {
  return isTauri() ? createTauriVaultBackend(vaultPath) : createMockVaultBackend(vaultPath)
}
