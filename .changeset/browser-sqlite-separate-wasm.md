---
'@tanstack/browser-db-sqlite-persistence': patch
---

Ship wa-sqlite WebAssembly as a separate asset that the browser loads automatically, instead of inlining it in the OPFS worker. In Vite development, the package finds its assets without configuration. An install that Vite cannot resolve by package name now reports `PersistenceUnavailableError`, and excluding the package from pre-bundling fixes it.
