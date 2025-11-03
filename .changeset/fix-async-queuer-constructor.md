---
"@tanstack/db": patch
---

Fix queueStrategy implementation to use asyncQueue helper

The previous implementation incorrectly instantiated `AsyncQueuer` directly, which caused TypeScript build errors due to constructor signature mismatches. This fix switches to using the `asyncQueue` helper function from `@tanstack/pacer`, which provides the correct API for creating queued task processors.

Changes:
- Use `asyncQueue()` helper instead of `new AsyncQueuer()`
- Properly pass task processing function and options to asyncQueue
- Remove cleanup methods that aren't exposed by asyncQueue (not needed as queue is garbage collected)

This resolves the type check errors that were preventing builds from completing.
