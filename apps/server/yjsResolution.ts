import { fileURLToPath } from 'node:url'

/**
 * `yjs`, `y-protocols` and `lib0` are installed as dependencies of `@blocknote/core` and are
 * not declared in the root `package.json` (see docs/web/s4-spike-report.md, "Dependencies").
 * pnpm links every installed package under this directory; resolving the three names here
 * gives the server, the web client and BlockNote one shared copy, which Yjs requires.
 */
export const HOISTED_MODULES = fileURLToPath(new URL('../../node_modules/.pnpm/node_modules', import.meta.url))

export const YJS_PACKAGES = ['yjs', 'y-protocols', 'lib0'] as const

/** An import of one of `YJS_PACKAGES` or of a subpath of one. */
const YJS_IMPORT = /^(yjs|y-protocols|lib0)(\/.*)?$/

/** A Vite `resolve.alias` entry for the three packages and their subpaths. */
export function yjsAlias(): { find: RegExp; replacement: string } {
  return { find: YJS_IMPORT, replacement: `${HOISTED_MODULES}/$1$2` }
}
