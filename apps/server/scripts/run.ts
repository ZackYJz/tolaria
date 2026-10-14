// Runs a TypeScript entry point of the server under Node:
//
//   node --experimental-strip-types apps/server/scripts/run.ts <entry.ts> [arguments]
//
// The server shares the markdown pipeline in `src/` with the app, and that code is written
// for a bundler (imports without extensions, `import.meta.env`). So the entry point is
// bundled first, with every package left external, and then imported.
import { mkdir } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { HOISTED_MODULES, YJS_PACKAGES } from '../yjsResolution.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const OUT_DIR = join(REPO_ROOT, 'node_modules', '.tmp', 'tolaria-server')
const HOISTED_PARENT = pathToFileURL(join(HOISTED_MODULES, 'importer.mjs')).href
const VITE_ENV = JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: true })

function isYjsImport(specifier: string): boolean {
  return YJS_PACKAGES.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

/** Resolves the Yjs packages where pnpm keeps them, so there is one copy with BlockNote. */
function resolveYjsFromHoistedModules(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromOurCode = context.parentURL?.startsWith(pathToFileURL(OUT_DIR).href) ?? false
      if (fromOurCode && isYjsImport(specifier)) return nextResolve(specifier, { ...context, parentURL: HOISTED_PARENT })
      return nextResolve(specifier, context)
    },
  })
}

async function bundle(entry: string): Promise<string> {
  const outfile = join(OUT_DIR, `${basename(entry, '.ts')}.mjs`)
  await mkdir(OUT_DIR, { recursive: true })
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    // The `paths` of the TypeScript config are for the type checker; Node resolves at run time.
    tsconfigRaw: {},
    jsx: 'automatic',
    define: { 'import.meta.env': VITE_ENV },
    logLevel: 'warning',
  })
  return outfile
}

async function main(): Promise<void> {
  const [entry, ...args] = process.argv.slice(2)
  if (!entry) throw new Error('usage: run.ts <entry.ts> [arguments]')
  const outfile = await bundle(resolve(entry))
  resolveYjsFromHoistedModules()
  process.argv = [process.argv[0], outfile, ...args]
  await import(pathToFileURL(outfile).href)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
