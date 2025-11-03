---
"@tanstack/db": patch
---

Fix queueStrategy to use AsyncQueuer constructor correctly

The previous implementation incorrectly instantiated `AsyncQueuer` with only an options object, but the constructor requires both a processing function and options. This caused TypeScript build errors.

Changes:
- Pass both processing function and options to `new AsyncQueuer(fn, options)`
- The processing function receives tasks and executes them asynchronously
- Properly configure concurrency, wait time, and queue position options
- Restore cleanup methods (stop/clear) for proper resource management

This resolves the type check errors that were preventing builds from completing.
