import { dirname, resolve } from 'node:path'
import { URL as NodeURL, fileURLToPath } from 'node:url'

/** Pure setup fixture: no production, Query, supervisor, or history imports. */
export function observeRootSetup() {
  const moduleUrl = import.meta.url
  const relative = `../../../`
  const GlobalURL = globalThis.URL
  return {
    moduleUrl,
    moduleFilename: import.meta.filename,
    moduleDirname: import.meta.dirname,
    locationHref: globalThis.location.href,
    globalIsNodeURL: GlobalURL === NodeURL,
    literal: new URL(`../../../`, import.meta.url).href,
    indirectGlobal: new GlobalURL(relative, moduleUrl).href,
    nodeLiteral: new NodeURL(`../../../`, import.meta.url).href,
    nodeIndirect: new NodeURL(relative, moduleUrl).href,
    resolvedRoot: resolve(dirname(fileURLToPath(moduleUrl)), relative),
  }
}
