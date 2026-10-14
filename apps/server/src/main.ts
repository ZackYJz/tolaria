import { loadConfig } from './config.ts'
import { closeVaultServer, createVaultServer } from './server.ts'
import { LocalDiskStore } from './store.ts'
import { Vault } from './vault.ts'

function log(message: string): void {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`)
}

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const vault = await Vault.open({
    dir: config.vaultDir,
    remoteUrl: config.remoteUrl,
    branch: config.branch,
    log,
  })
  const server = await createVaultServer({
    vault,
    store: new LocalDiskStore(config.stateDir),
    token: config.token,
    maxBodyBytes: config.maxBodyBytes,
    collab: config.collab ?? false,
    log,
  })
  const stop = (): void => {
    closeVaultServer(server).catch((error: unknown) => log(`shutdown failed: ${String(error)}`))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  server.listen(config.port, config.host, () => log(`tolaria server listening on http://${config.host}:${config.port}`))
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
