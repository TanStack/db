---
'@tanstack/db': patch
---

Production builds now shorten error messages to a code, the inputs the error can show, and a link to the new error codes page, for example `TanStack DB error 17 (key=1, collectionId=todos): https://tanstack.com/db/latest/docs/errors#error-17`. Development builds keep the full messages. Error classes, `name` values, `instanceof`, and error fields are unchanged. This removes about 8 KB of minified code (3.2 KB gzip) from production bundles.
