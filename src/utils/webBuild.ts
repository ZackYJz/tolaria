/** The static web build (apps/web); the desktop app and its browser dev build are not. */
export function isWebBuild(): boolean {
  return import.meta.env.VITE_TOLARIA_WEB_BUILD === 'true'
}
