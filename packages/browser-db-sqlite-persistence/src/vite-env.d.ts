/// <reference types="vite/client" />

/** Defined only by the package build in vite.config.ts. */
declare const __BROWSER_SQLITE_PACKAGE_BUILD__: true | undefined
/** The package name and version; defined only by the package build. */
declare const __BROWSER_SQLITE_PACKAGE_VERSION__: string | undefined

declare module '*?url&no-inline' {
  const url: string
  export default url
}
