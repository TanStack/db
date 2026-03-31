---
"@tanstack/browser-db-sqlite-persistence": patch
---

Fix absolute worker path in bundled output by setting `base: './'` in vite config, so the OPFS worker URL resolves relative to the module via `import.meta.url` instead of being hardcoded to `/assets/...`
