---
'@tanstack/browser-db-sqlite-persistence': patch
---

Ship wa-sqlite WebAssembly as a separate asset that the browser loads automatically, instead of inlining it in the OPFS worker. In Vite development, the package finds its assets without configuration; production builds drop that lookup. An install that Vite cannot resolve by package name, or a worker from another installed version of the package, now reports `PersistenceUnavailableError`, and excluding the package from pre-bundling fixes it.
