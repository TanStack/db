# PR #2213 OPFS close review

- Base: `origin/main` at the PR's merge base. Original PR commit: `832dff8a4`.
- Repairs: `b836bfc95` (connection close), `0cd9128c8` (worker request
  order), `d56a7ee98` (closed-connection error), and the change that gives
  the request-order oracle its Node and Chromium drivers.
- Oracles:
  - The connection close lane of
    `packages/browser-db-sqlite-persistence/tests/opfs-page-lifecycle-oracle.test.ts`,
    which uses a controlled worker.
  - The request-order oracle,
    `packages/browser-db-sqlite-persistence/tests/opfs-request-order-oracle.ts`.
    Its Node driver is `tests/opfs-request-order-oracle.test.ts` and its
    Chromium driver is `e2e/opfs-request-order-oracle.opfs.spec.ts`.

## Contract and evidence

Every request an OPFS connection accepts settles exactly once. Close ends
admission when it starts, and concurrent close calls share one outcome. The
worker answers requests in arrival order, so close waits for earlier requests
and those requests keep their results. Pagehide or a Worker terminal event
during close wins: close and pending work reject with that event's failure.
The README states this contract.

The original PR rejected pending work when close settled. An external review
found that concurrent close rejected the second caller, that work admitted
during close reached a worker that had cleared its state, and that the pinned
close table could not distinguish rejecting at close start from rejecting at
settlement. A real-worker probe then showed that the worker handled messages
concurrently: close ran while an execute waited for the OPFS access handle,
SQLite refused to close the unfinalized statement, and close was answered
first.

## Calibration

Each control below ran against the full lifecycle or request-order oracle.
"Killed" means the named lane failed an assertion rather than timing out.
Where a row names the failing observation, it was inspected; the other rows
record only which lane failed.

| Control | Owner | Result |
| --- | --- | --- |
| Pre-PR connection (pending work never settles) | Close lane | Killed at close settlement |
| Original PR connection (second close posts its own request) | Close lane | Killed |
| Reject all pending work when close starts | Close lane | Killed |
| Concurrent close not memoized | Close lane | Killed |
| No admission check while closing | Close lane | Killed |
| Defer rejection past close settlement | Close lane | Killed at close settlement |
| Ignore pagehide while closing | Close lane, pagehide lane | Killed |
| Ignore Worker `error` while closing | Close lane, terminal lane | Killed |
| Concurrent worker (pre-repair) | Request-order, Node driver | Killed on an insert that waits for the handle while close reaches the worker |
| Worker queues executes but not close | Request-order, Node driver | Killed on the same history |
| Concurrent worker (pre-repair) | Request-order, Chromium driver | Killed in 20 of 32 examples: settlements differ from the model |
| Worker queues executes but not close | Request-order, Chromium driver | Killed in 20 of 32 examples |

The pre-PR and original-PR connection controls are the exact earlier
production files. The other connection and worker controls were temporary
source mutations, reverted after each run. Before the close lane replaced it,
the original pinned close table let the "reject at close start" and "dispose
before reject" mutants pass.

With the repairs, the package's unit and type suite passed: 20 files and 467
runtime tests. All configured Chromium OPFS specs passed.

A first version of the shared driver returned the handle in the same turn
that it submitted close. Close then never reached the worker during the wait,
and both worker mutants passed both drivers. The driver now waits for close to
reach the worker before it returns the handle. Both mutants then failed.

## Limits

The close lane uses a controlled worker that can answer in any order, so it
also covers a close response that overtakes pending work. The request-order
oracle runs the real worker module and wa-sqlite WASM in Node over an
in-memory VFS with OPFSCoopSyncVFS's lock protocol, and its Chromium driver
runs the same fixed examples against real OPFS in local Chromium. Together
they do not establish
other browsers, frozen tabs, a crash between a write and close, or multi-tab
contention beyond one held handle.

`BrowserWASQLiteDriver.close()` does not wait for queued driver work, the same
as the Node and OP-SQLite drivers. A probe showed that a transaction and
queued work interrupted by close reject with the closed-connection error, and
close succeeds; SQLite rolls back the open transaction. This is the accepted
driver contract: draining would make close wait for a transaction callback's
own application code, which may itself wait for close.

A closed connection used to report `InvalidPersistedCollectionConfigError`.
It now reports `SQLiteConnectionClosedError`, exported from the core and
browser packages. Work accepted before close and then cancelled still rejects
with `AbortError`, the same as pagehide.

While writing the Chromium driver, a 63-character database name failed to
open with a bare `sqlite3_open_v2` error, while a 56-character name opened.
The limit and its error message are untested and unrecorded elsewhere.
