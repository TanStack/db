# One candidate: coordinated separate writable query results

# Provisional exploratory preservation contract

Source: the current Endpoints probe as inspected in the representation survey, bounded by the user's explicit corrections. Target: the representation linking authored reads, guessed row effects, retained collections and authoritative result delivery. This is exploratory, not exact equivalence; the source has known missing behavior.

P1 (user): Bare writable query collections; synchronous Transaction-returning actions.
P2 (user): Every affected non-GCed collection participates, regardless of subscribers.
P3 (user/source): Guesses use existing transaction overlays; actual server branches may differ.
P4 (source): Preserve whole-row snapshot and transaction retirement semantics; no preload in mutationFn.
P5 (user): Unknown analysis cannot prove non-impact. Inline full-result fallback remains.
P6 (source/inference): Query identity includes client scope and arguments; no untrusted SQL execution.
P7 (user): No implicit mutation queue; no server code in client artifacts.
P8 (user/source): Effects may span tables and reads; returned target rows are not complete-effects proof.
P9 (user): Safety and benefit are separate, independently per shortcut.
P10 (source/inference): Late creation/GC, pending sibling overlays, read errors and publication order require explicit boundaries; do not erase them through decomposition.
P11 (user/source): SQL truth, result keys, ordering and support completeness constrain local guesses.
P12 (evidence): No production speed claim or independent range claim follows from local examples.


# First executable coherence draft

The first slice is implemented in the Endpoints probe. Bare query collections remain writable, actions still return a DB Transaction synchronously, and there is no mutation queue. The original two-query optimistic insert failure now passes.

## What runs

The compiler emits a small serializable query model: trusted relation identity, full-row membership (`all` or `completed = boolean`), and total ascending order. The client lowers membership into **TanStack DB's existing expression evaluator**. It does not serialize handlers or the full runtime QueryIR.

A mutation captures authored row guesses through the existing transaction. The runtime applies those full-row effects to other eligible query collections within that same transaction, including collections with no subscribers. An update can remove a row from one filtered result and insert it into another. Cleanup is the retention exit.

The mutation request carries retained query identities. A generated server-only dispatch table validates every identity before invoking the write. Actual write coverage remains unknown, so **every retained requested query is evaluated on the server**. The mutation returns full authoritative results. Query Collection's manual write utilities install them against tracked confirmed keys before DB retires the transaction overlay. The implementation does not start a preload inside mutation persistence.

Server-side reads retry three times with 1/2/4-second delays. The write is never retried by that loop. Exhausted reads produce a distinct “write committed; reads failed” result, recorded on the client and surfaced through the action's persistence error. The oracle checks that error and server commit separately, then checks convergence after a fresh load. It does not assert that unavailable data equals a guessed successful read.


## Model, oracle, implementation

- Model and evaluator: [coherence.ts](../../integrated-todo/src/coherence.ts).
- Client capture, fanout, retention and publication: [runtime.ts](../../integrated-todo/src/runtime.ts).
- Compiler metadata and trusted read dispatch: [bound-transform.mjs](../../integrated-todo/bound-transform.mjs).
- Server refresh/retry boundary: [refresh.server.ts](../../integrated-todo/src/refresh.server.ts).
- Generated full-stack oracle: [tests/oracles](../../integrated-todo/tests/oracles/README.md).

The reference uses separate PGlite confirmed and visible worlds. It never imports the SUT's membership evaluator or its recipient selection. Every retained result and order is checked independently at initial, optimistic, held reconciliation/retry and settled checkpoints. The server can trim text while the client guesses the original text; independent SQL `btrim` supplies confirmed expectations.

## Evidence

The final full campaign used N=2 scenarios × X=2 fresh sequences per campaign, up to three operations per sequence, plus fixed controls. It built **8 programs, ran 18 sequences, 40 operations and 173 checkpoints**, and inspected 32 client artifacts. All four campaigns passed. A larger coherence-only run passed 3 generated programs, 12 sequences, 35 operations and 95 checkpoints. Random coverage is supplemented by a fixed all/active/completed fixture proving membership entry/exit, correction, rollback, zero-subscriber retention and GC exclusion.

The saved old failure was red before the implementation and green afterward. An isolated `omit-fanout` mutant restores that same failure. The `early-settlement` mutant is also rejected: the rendered optimistic row disappears before authority arrives ([receipt](../../integrated-todo/evidence/representation-mutant-settlement/report.json)). Compiler/server boundary unit tests passed (13 checks); TypeScript passed. The final retention/evaluator refactor also passed the fixed witness and a generated sequence ([receipt](../../integrated-todo/evidence/representation-retention-final/report.json)). The existing Todo browser lifecycle, binding and callback-error regressions passed against a disposable in-memory server, including scope isolation and persistence after reload. Each generated program also gets a production build: client artifacts and browser-delivered sources are scanned for server canaries and server dependency paths, with positive server witnesses and rejected raw/server-module requests. These checks cover the tested boundaries, not every possible leak.

Receipts: [all campaigns](../../integrated-todo/evidence/representation-final/report.json), [larger coherence run](../../integrated-todo/evidence/representation-coherence/report.json), [original red](../../integrated-todo/evidence/representation-red/report.json), [green replay](../../integrated-todo/evidence/representation-green/report.json), [fanout mutant](../../integrated-todo/evidence/representation-mutant-fanout/report.json), [Todo lifecycle](../../integrated-todo/evidence/representation-browser.json).

## Cost boundary

A fixed fixture with two full-result queries over 200 rows runs the same edit under each strategy, checked by the same PG oracle. Three fresh sequences per strategy:

| Strategy | Browser requests/op | Request body bytes | Decoded response body bytes | Local median elapsed | With 50 ms injected request delay |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inline full results | 1 | 562 | 106,069 | 146.10 ms | 181.01 ms |
| Client refetch | 3 | 755 | 106,010 | 162.28 ms | 246.58 ms |

[Raw measurement summary](../../integrated-todo/evidence/representation-wire-summary.json) and [fixed workload](../../integrated-todo/evidence/representation-wire-input.json) permit replay. Client refetch still propagates optimism correctly; only its authoritative delivery strategy changes in the disposable copy.

These are tiny local measurements with oracle gates, browser publication checks and instrumentation included. The 50 ms case adds a fixed delay before each browser POST, not a measured real network RTT. Body sizes exclude HTTP headers/compression. Fewer request phases help here; **full-result delivery does not save substantial payload bytes**. No patches, shared SQL, result deduplication, or production speed claim is implemented.

## Explicit first-draft limits

- **One trusted Todo schema and one authored module.** Only full rows, empty query arguments, scope, `completed` predicates and ascending `createdAt`/`id` order are recognized. Unsupported query shapes still get compiler diagnostics. General safe execution of arbitrary unanalysable queries with inline fallback remains future work. Opaque mutation handlers already use conservative full reads; target-row `RETURNING` is never treated as complete effects.
- **No complete multi-table effects observer.** The model distinguishes complete relation coverage from unknown; the runtime supplies unknown. The server helper can refresh multiple registered reads but that is not a multi-table Endpoints compiler implementation. Joins, aggregates, top-k, complex projections, codecs and collations remain outside this slice.
- **Nonempty, coherent authored guesses.** The existing zero-mutation restriction remains. An insert excluded from every retained query, an empty bulk write, or conflicting guesses for the same row needs a separate action/transaction contract. The generator now respects this supported precondition rather than silently claiming those cases pass.
- **Stable loaded query set during each operation.** Reads must finish loading before mutations. New endpoint creation during pending work fails explicitly. GC before a mutation is tested; restart/GC/initial-read races during work and generation-aware catch-up remain unresolved.
- **Concurrent response publication is unproved.** Actions are not queued or globally disabled, and existing DB snapshot ownership is preserved, but the generated sequences are sequential. No common PG snapshot, database revision, linearizability or atomic publication across result collections is claimed. Overlapping responses and conflicting authored effects need the next model extension.
- **No durable error recovery protocol.** Exhausted reads are visible errors; reload repairs confirmed state. Response loss after commit and app-wide query registries remain open.


Source code paths are relative to probes/endpoints/integrated-todo. Inspect that code and tests directly; do not open sibling design forms or other audit outputs.
