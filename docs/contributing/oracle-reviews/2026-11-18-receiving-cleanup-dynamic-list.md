# Cleanup registration during recording

This append-only amendment follows the [diagnostic failure-fidelity audit](2026-11-18-receiving-cleanup-fidelity.md).
Its [snapshot](2026-11-18-receiving-cleanup-dynamic-list-snapshot.json) records
exact helper sources, caller classifications, controls and receiving evidence.
The earlier `15317e387…` helper hash remains the attribution for its historical
executions. The repaired helper is
`e3ed6efa8961252cd17bfe49e9675101f8211abe9a164244990563821d4a4af9`.

## Finding and repair

ORC-010 requires the instrument to preserve the primary failure and release its
resources. A receiving recorder can acquire and register resources while it
runs. Those callbacks must participate when recording exits, including when it
throws before producing an observation.

The old retainer evaluated `cleanups.map(...)` before calling the recorder. The
Direct decoder's recorder subsequently added its Collection, status listener,
source subscription, query and query subscription cleanup callbacks with
`unshift`. The retainer therefore omitted those callbacks. Its prior eleven
ordinary controls all supplied fixed arrays; they did not distinguish cleanup
registration during recording. An ordinary actual-decoder control exposed the
missing release after the receiving driver adopted the shared retainer.

The repaired retainer passes an initially empty `guardedCleanups` array to
`withOracleCleanup`. Its recorder wrapper fills that array in `finally`, after
the awaited recorder succeeds or fails. `withOracleCleanup` then iterates the
same populated array. An incomplete recorder's cleanup failures still rethrow
into its aggregate, retaining original cause and error identities. A completed
recorder still returns raw observations with separate cleanup diagnostics.

`withOracleCleanup` and `describeOracleCleanupError` are byte-identical to the
previous helper version. Only the retainer's registration time changes. No
prototype or diagnostic-formatting rule changed in this amendment.

## Applicability inventory

The previous inventory combined 49 caller files for generic cleanup, custom
retainers, formatting and ordinary tests. This audit rechecked those files and
also used TypeScript call-expression inspection across every current package
file naming the shared retainer or either thin wrapper.

It found 30 receiving/support retainer calls in 25 files:

| Supplied cleanup argument | Calls | Disposition |
| --- | ---: | --- |
| Array literal | 26 | Static callback list. The recorder has no alias to mutate this list. Callback closures still read current owned handles when invoked. Moving wrapper construction does not change their callback identities, order, arguments, result or failure policy. |
| Forwarded `cleanups` parameter | 3 | Native PowerSync, Direct receipt and Electric receipt thin wrappers. Every receiving caller was traced to an array literal. |
| Mutable local `cleanups` list | 1 | `observeDecodeRefusal` in `db-adapter-conformance/tests/decode-refusal-driver.ts`. Its recorder registers additional cleanup callbacks. This is the affected receiving path. |

The snapshot lists every call, source hash, argument and classification. It also
records ordinary helper-test calls separately; those are not receiving paths.
The Direct decoder is the only current registrar of this affected shared
recorder: Node's Direct decoder suite and Chromium's Direct decoder page use it.

Native PowerSync's batch-decode and hook-lifecycle outer retainers receive
`[source.dispose]`; their inner retainers also receive literals. A growing
`subscriptions` array inside a fixed callback is different from a growing
cleanup callback list: both helper versions invoke that same closure after
recording. The LocalStorage receiver's reopened Collection and the RxDB
receiver's transaction/receipt handles have the same static-closure argument.

Direct decoder prewarming and its temporary retirement query do have growing
cleanup lists, but both call the unchanged `withOracleCleanup` directly. The
prior inventory's custom Direct main/cursor retainers and all other direct
`withOracleCleanup` or formatter callers likewise do not execute the amended
retainer. Their relevant function bodies did not change.

## Executed evidence

The independent matrix executes the exact original and repaired helper source
under Node 26.13.1. It crosses fixed versus growing callback lists, recorder
success versus failure, and cleanup success versus failure. Dynamic callbacks
register both before and after an awaited turn. It checks exact primary and
secondary identities, raw row-array identity, retained prior diagnostics,
callback order, current captured ownership and every later cleanup attempt.

- Original `15317e387…`: all four static cases pass; all four dynamic cases fail.
- Repaired `e3ed6efa…`: all eight cases pass.
- The retained ordinary helper file passes all 13 controls. Its incomplete
  dynamic recorder now throws synchronously, and its assertions check exact
  aggregate cause and error identities with `toBe`. The independent matrix also
  exercises an awaited recorder failure.
- The existing actual-decoder cleanup and model-control files independently
  pass all seven controls. Their before/after execution capsule verifies stable
  source hashes. These ordinary controls are separate from generated product
  campaigns and do not establish product GREEN by themselves.

Packaging executed both affected real receiving suites with the repaired
helper before changing the decoder production source. The frozen v3 instrument
records the original `1ec1defd…`/`20f8ed31…` production sources. Node reports
66 failed and 268 passed; Chromium reports 66 failed and 261 passed. In each,
42 failures are semantic RED and 24 are calibrations whose clean run already
failed; those 24 receive no mutant credit.

Its exact per-cell records in each host contain 36 histories: 20 semantic RED
and 16 passing ordinary/valid neighbors, with zero detached host errors. The
raw rows, readiness, health and shared violations survive the amended cleanup
path. A resource observation captured before final teardown does not establish
post-teardown SDK release; the dedicated cleanup controls establish the omitted
callback class. This audit does not turn the original receiving RED into GREEN.
Later decoder production repairs and their GREEN evidence belong to the decoder
author's subsequent record.

The generic tests and seven actual-decoder controls were independently rerun
under a source-stable capsule after the author's production repair, at
`6b0a8092…`. Those runs remain ordinary instrument controls, and are not cited
as pre-edit product RED. The earlier frozen v3 receiving records provide that
chronological evidence.

## Carry and limits

Static caller carry is a source argument about the named fixed arrays and
unchanged functions. It supplies no new SDK, browser, SQLite or OPFS receiving
execution. Their prior source hashes stay attached to their actual executions;
final manifests must name the repaired helper dependency separately.

The shared on-demand recorder's two diagnostic nodes were compared with the
previously approved `3f8185ee…` source and are byte-identical in the later
`4573df22…` source. All 108 source-function diagnostic controls were rerun under
Node 26 and pass. This carries only those diagnostics; the added provider work
barriers require their owning review and receiving evidence.

The helper now includes registrations made before the awaited recorder exits.
This finite evidence does not promise registrations made by unawaited later
work, list mutation during cleanup, exotic array getters/proxies, or unbounded
resource counts. No product law, reference model, history grammar or accepted
comparison was changed. No production source edit was made by this audit.

Final scoped ESLint reports zero errors and warnings. `pnpm lint:changed` passes
after the final ordinary helper-control edit. The helper remains `e3ed6efa…`;
its source and the exact 13-test file hash are verified in the snapshot.

## Final independent applicability acknowledgment

Enforcement independently approved this bounded audit at report SHA-256
`026dd9f8e11d5b2da4c5e5d577371d2fb228520c6842cbe34817c49913149d8b`
and snapshot SHA-256
`953f49ebd0cee02969f43b6e1c3a24780b54d077fccbb43cd1a422803d9d0beb`.
Its independent AST inventory found 39 total calls, including the same 30
receiving/support calls in 25 files: 26 literal lists, three forwarding wrappers
with literal receiving callers, and the sole dynamic Direct decoder list.
There were no missing or extra receiving call sites. The strict old/new matrix,
13 generic controls and seven decoder controls retain the results above.

The acknowledgment accepts static-caller carry as source reasoning. The dynamic
Direct path has its separately attributed actual SDK evidence. It adds no new
host execution or whole-portfolio claim. This appended entry records the final
acknowledgment without replacing the earlier reviewed report or snapshot.
