---
"@tanstack/db": patch
"@tanstack/browser-db-sqlite-persistence": patch
"@tanstack/offline-transactions": patch
"@tanstack/db-sqlite-persistence-core": patch
"@tanstack/electron-db-sqlite-persistence": patch
---

Use a safe `randomUUID` helper that falls back to `crypto.getRandomValues` when `crypto.randomUUID` is unavailable (non-secure browser contexts such as dev servers reached via a LAN IP over HTTP). Fixes #1541.
