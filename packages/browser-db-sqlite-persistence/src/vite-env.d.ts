/// <reference types="vite/client" />

/** Defined only by the package build in vite.config.ts. */
declare const __BROWSER_SQLITE_PACKAGE_BUILD__: true | undefined

declare module '*?url&no-inline' {
  const url: string
  export default url
}
