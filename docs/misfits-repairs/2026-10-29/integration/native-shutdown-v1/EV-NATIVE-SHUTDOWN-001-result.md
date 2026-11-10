# EV-NATIVE-SHUTDOWN-001: receiving-host setup repair

The failure belongs to the Vite receiving host. During the first page's startup,
Vite discovers three worker-only SQLite imports, changes its optimized graph,
and reloads the page. The database correctly rejects its pending open on
pagehide. The receiving module's top-level await then fails module evaluation,
which Chromium reports as a pageError. Production should retain that rejection.

The proposed repair is nine lines in the shared OPFS Vite config: preoptimize
the exact three imports before an actual test page starts. No production,
driver, comparison, model, history selection, or diagnostics assertion changes.
No private P source edits were made by this investigation.

## Authority and original observation

`packages/browser-db-sqlite-persistence/README.md:209–223` requires pagehide
to terminate the worker and reject pending initialization, queries and close
with AbortError. `tests/opfs-page-lifecycle-oracle.test.ts` is the primary
owner; its controlled pagehide-during-init histories exclude native lifecycle
delivery. The open-outcome owner covers opening steps. Neither requires an
open to succeed after its document leaves.

Original P6 evidence stays RED: all six source-head comparisons passed, but
one actual startup pageError failed the final unfiltered diagnostics assertion.
The pageError was at 2381.345; first explicit cleanup was 4393.744. The first
page's identical HTML loaded at 2122.968 and 2376.545. Its shared dependency
chunk changed version from `4ecf8cb7` to `a4b0f243` at 2356.568. These requests
are retained in `original-optimizer-hash-transition-v1.json`.

Original log SHA256:
`d708596fbaef51016d009eb34b58828800eed717b4f227a4253646ca63db0204`.
Original trace ZIP SHA256:
`51e15bd2c38d1d9a7c2c3719bef7f4b93ce654f83ec37b74c5b5dd3468b1db80`.

## Discriminating controls

The diagnostic used the unchanged receiving module, private cold caches,
real Chromium, the real SQLite worker, and no file watcher. No backend result
claim comes from these startup controls.

1. **Original cold host:** Vite logged new optimized wa-sqlite imports at
   2384.399 and `optimized dependencies changed. reloading` at 2384.403;
   the server sent full-reload at 2384.837 and the client received it at
   2401.194. Pagehide at 2412.558 terminated the worker. The exact AbortError
   appeared as a module error and actual pageError at 2413.993, with empty
   stack. The replacement document later installed its probe.
2. **Promise-owner control:** a diagnostic HTML transform owned the receiving
   module's dynamic-import rejection. The real WebSocket reload still reached
   pagehide and worker termination; that caller received the same AbortError
   at 504.662, with no pageError. This diagnostic-only control attributes the
   error. It is not the repair and is absent from actual receiving tests.
3. **Preoptimized cold host:** the original unowned receiving module reached
   worker init, execute and probe installation with one navigation, no
   full-reload and no pageError. The three preincluded dependencies are
   `@journeyapps/wa-sqlite/dist/wa-sqlite.mjs`, `@journeyapps/wa-sqlite`, and
   `@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js`.

`native-diagnostic-verdict-v1.json` records the shared event checks and hashes.
The original host without preoptimization is the hostile setup control: it
reproduces the precise startup AbortError observation, rather than failing in
setup or at an unrelated later checkpoint.

Two unsuccessful diagnostic controls remain preserved and receive no credit:
the first intercepted-HTML owner control could not connect its WebSocket due
to Chromium local-network checks; the first preoptimization control used a
long database name and failed `sqlite3_open_v2` before probe installation.
The latter may encounter the VFS's 64-byte pathname bound; this investigation
does not establish that separate failure's complete cause. The short normal
database-name preoptimization control passed. An initial sandbox localhost
listener refusal is also retained separately.

## Actual receiving GREEN

Both runs used unchanged private P v2 before the observer change, base main
`9cfa11fc712866f8f276e85762865ebb8bd49cbe`. Each run started a separate cold
optimizer cache, with one Playwright worker. The original spec and page
driver retained every actual pageError and the final empty-diagnostics check.

| Run | Result | Evidence |
| --- | --- | --- |
| Original default lost-row/disjoint case first | 1 passed | `native-first-v1-results.json`, receipt, freeze, log, one retained trace |
| Exact original six selected cells | 6 passed | `native-six-v1-results.json`, receipt, freeze, log, six retained traces |

All seven traces contain zero pageErrors and exactly one HTML document request
per actual page. All shared source-head comparisons and declared reaches
passed, including interrupted numeric-resume and `now` recovery. No run used
message filtering, error swallowing, retries, or lowered budgets.

First-case log SHA256:
`f648eff6fa5fb83265648906a617cda95e9a6f9196bf434950f0f2f8ecc4fb4a`.
First-case freeze SHA256:
`bb0d011fd7825ba42716ea66b37a977201b3f5974d126de8cb9ead0ce96141cf`.
Six-cell log SHA256:
`ea94203a2595d1ef827350cc427606bff3e5ad155a7a3e8f7114249b97b9d296`.
Six-cell freeze SHA256:
`532cbd3ef3941c23e7e1f84d084652d07e8e18d23e1a6f2a439f83b33398b873`.

Each before/after guard retained all 313 production files, 3411 tracked and
untracked inputs, 1049 built files, dependency metadata, both host configs,
Git HEAD, index and status. Production `persisted.ts` stayed
`025ae33d53ffbd77e9be2973a34aaaa9c1f6188d867abc467f4af93f37602d8f`.
`native-observer-independence-v1.json` checks all 186 files in the existing P6
static import graph against the executed freeze. None changed; none imports
the five pending observer files. New host overrides import only existing roots
and the same three external worker imports.

`native-host-verdict-v1.json` contains per-test reaches, exact selection, trace
hashes, document counts, receipts and all unchanged guards.

## Proposed reusable delta and limits

`native-stable-host-v1.patch` SHA256:
`06009669f1767c031039ab5ea9c1b10349d51796895a00f2e191f6979be66e5b`.
Its target is only `packages/browser-db-sqlite-persistence/vite.opfs.config.ts`.
The reusable delta excludes the artifact cache directories, absolute paths,
diagnostic HTML transform and run-specific Playwright configs. Root acceptance
is still required before applying that delta to private P or author sources.

This evidence closes the observed cold-optimizer reload contamination for the
specified Vite/Chromium receiving startup and these six source-prefix cells.
It does not establish arbitrary navigation or bfcache behavior, other browsers,
every OPFS test cell, backend schedules beyond these six, or a general promise
of quiet console output. P5's caught post-dispose leadership diagnostics are a
separate observation and receive no defect classification here.

All diagnostic and actual-run Vite servers and browser contexts are closed.
Private P and heavy slot 1 were explicitly released to root and integration
after the actual six-cell run completed. There were no commits, pushes or PRs.
