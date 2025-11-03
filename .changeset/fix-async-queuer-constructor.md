---
"@tanstack/db": patch
---

Fix AsyncQueuer constructor usage in queueStrategy

The AsyncQueuer constructor from `@tanstack/pacer` requires a function as the first parameter to process queued items, with options as the second parameter. The previous implementation incorrectly passed only the options object, causing TypeScript build errors.

This fix properly initializes AsyncQueuer with:

- A processing function that executes queued tasks as the first parameter
- Configuration options as the second parameter
- Explicit type annotation to avoid implicit `any` errors

This resolves the type check errors that were preventing builds from completing.
