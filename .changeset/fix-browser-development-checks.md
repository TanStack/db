---
'@tanstack/db': patch
'@tanstack/react-db': patch
---

Run development-only checks in browser development builds. The duplicate `@tanstack/db` instance check and React's development warnings (deprecated dependency arrays, unhashable query identity) skipped themselves whenever there was no `process` global, which is the case in Vite and other browser bundles even though they inline `process.env.NODE_ENV`. They now read `process.env.NODE_ENV` as bundlers expect, so an app that loads two copies of `@tanstack/db` in development throws `DuplicateDbInstanceError` as documented. Set `process.env.TANSTACK_DB_DISABLE_DUP_CHECK` to `'1'` through your bundler's `define` to turn the check off.
