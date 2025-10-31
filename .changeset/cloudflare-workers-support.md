---
"@tanstack/db": minor
---

Add automatic Cloudflare Workers runtime detection and lazy initialization

Collections created with `createCollection` now automatically detect when running in Cloudflare Workers environment and defer initialization to prevent "Disallowed operation called within global scope" errors. This is done using a transparent proxy that initializes the collection on first access.

The detection uses `navigator.userAgent === 'Cloudflare-Workers'` to identify the runtime environment.

Also exports `lazyInitForWorkers` utility function for advanced use cases where users need to apply lazy loading to other resources.

This change is backwards compatible and requires no code changes for existing users.
