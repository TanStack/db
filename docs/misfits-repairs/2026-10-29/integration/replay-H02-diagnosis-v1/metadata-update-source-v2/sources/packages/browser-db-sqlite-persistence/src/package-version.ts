/**
 * The package build that the opener and its worker come from. A pre-bundled
 * copy under a Vite dev server can start another installed copy's worker, so
 * the worker refuses an opener from another build. Only the package build
 * defines the value; source that Vite or Vitest serves runs both sides from one
 * copy.
 */
export const packageVersion: string =
  typeof __BROWSER_SQLITE_PACKAGE_VERSION__ === `undefined`
    ? `source`
    : __BROWSER_SQLITE_PACKAGE_VERSION__
