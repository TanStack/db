# Source failure law: design grammar and TLA+ control

This directory holds a Field Lab design-grammar run on the source failure law
that the maintainer chose on 2026-10-13. A source either keeps trying, becomes
ready, or reports a final error for its sync attempt. The framework never heals
an attempt. Recovery is the app's job and starts a fresh attempt.

## Frozen preservation list

U marks a user-required property, S a source-stated property (mostly from
#1751), and I an analyst-inferred property. The user confirmed the list and
corrected F8.

| ID | Property | Basis |
| --- | --- | --- |
| F1 | While a source retries, it reports `loading`, not `error`. A retry that succeeds is a success. | U |
| F2 | `markError` is final for its sync attempt. The framework never moves it back to `ready`. | U |
| F3 | Recovery is the app's job and starts a fresh attempt: cleanup, then preload, a refetch, or a user refresh. The fresh attempt requests all demand again. | U |
| F4 | A final error reaches every consumer with its cause: readiness waits and one-shot reads reject, live queries enter error for every shape, Suspense throws, an Effect reports `onSourceError`, and subscribers get `lastError` and `loadSubset:error`. | U |
| F5 | `ready` means a usable snapshot exists. A failure never publishes a false or empty ready. | S |
| F6 | A failure after the first ready does not discard visible data. Open: whether such a failure moves the status to `error`. | S |
| F7 | Cleanup and restart revoke the old attempt. A stale attempt cannot mark the new one. | S |
| F8 | The framework leaves no wait pending forever: every wait resolves, rejects with the final cause, or ends quietly on cleanup. A buggy source or an app with endless retries can still look stuck; that is a plugin or app problem. | I, corrected by U |
| F9 | Retry policy belongs to the source or the app. The framework adds no retries. | U |
| F10 | Every source maps its native signals to three outcomes: still trying, ready, or final error, including give-ups inside an SDK. | I |
| F11 | Every consumer of one source observes the same outcome at the same point. | I |
| F12 | A request that fails while its source is healthy fails its requester, not the source. | I |

## Model layer: candidate grammar

Primitives (each traced to the frozen list):

- **G1 attempt:** one sync run, from start to cleanup. It is the unit of
  finality (F2, F7).
- **G2 outcome:** the source's signal, one of `trying`, `ready`, or
  `final-error` (F1, F2, F10).
- **G3 snapshot:** usable visible rows (F5, F6).
- **G4 consumer:** a readiness wait, a live query (root or lazy), an Effect, or
  a subscriber (F4, F11).
- **G5 request:** one demand's load. It resolves, fails locally, or fails with
  its source (F12).
- **G6 app restart:** the only way to begin a new attempt (F3, F9).

Rules:

- **R1** `trying` keeps the status `loading` and fails no consumer (F1).
- **R2** `final-error` is absorbing within its attempt (F2).
- **R3** `final-error` reaches every consumer in the same step, with its cause.
  Pending requests reject with that cause (F4, F8).
- **R4** `ready` requires a snapshot (F5).
- **R5** A failure after ready keeps the snapshot (F6). Whether the status
  becomes `error` is **unresolved** (conflict C1).
- **R6** A local request failure fails only its requester (F12).
- **R7** Signals from a cleaned attempt are inert (F7).
- **R8** An adapter translates every give-up inside its SDK into `final-error`
  (F10).
- **R9** Only the app begins an attempt (F3, F9).

Active overlap and conflict:

- **C1 (unresolved):** a failure after ready sits where R3 and R5 overlap. R3
  propagates a final error to every consumer; R5 keeps the visible snapshot.
  PowerSync's comment at `powersync.ts:823` states the R3 side: "Do not leave
  healthy consumers ready against a stale source." #1751 and query-db state
  the R5 side: a refetch failure keeps the collection `ready`. The grammar
  keeps both branches (adjacent forms AF1 and AF2).
- **C2 (low stakes):** Electric rejects loads and then calls `markError` in
  the same turn, so a rejection can arrive before the status. Under R2 and R3
  both orders end with every consumer in terminal error. Only the reported
  cause differs.

## Evidence layer

### Reconstruction against the current code

Rebuilding the current arrangement from the grammar exposes these departures.
Each is an observation with a source pointer. None was invented to fit the
grammar.

| ID | Departure | Rule | Pointer |
| --- | --- | --- | --- |
| V1 | query-db calls `markReady()` after any later successful application, so a refetch heals an initial error. | R2 | `query-db-collection/src/query.ts:2556` |
| V2 | PowerSync marks `error` after ready when a tracking rebuild fails, then marks `ready` when a later rebuild succeeds. | R2, R1 | `powersync-db-collection/src/powersync.ts:813, 826` |
| V3 | A live query leaves error when its errored sources become ready. | R2, R9 | `db/src/query/live/collection-config-builder.ts:1131` |
| V4 | The lifecycle allows `error` → `ready`. | R2 | `db/src/collection/lifecycle.ts:106` |
| V5 | The docs describe healing. | R2 | `docs/guides/error-handling.md:534`; `db/skills/db-core/custom-adapter/SKILL.md:349` |
| V6 | On `main`, Electric marks `error` before the `onError` retry decision. | R1 | `electric-db-collection/src/electric.ts:1970` (fixed by #2127) |
| V7 | With #2127, an SDK give-up after a retry object is not reported. | R8 | #2127 review finding E1 |
| V8 | #2129 detaches waiting loads on a source error instead of rejecting them. | R3 | #2129 `subscription.ts` `detachForErrorRecovery` |
| V9 | Lazy demand fails for good, while a root query follows the source status. | F11 | `collection-config-builder.ts:448` vs `:1131` |
| V10 | RxDB leaves pending loads on a final error unobserved. | R3 (evidence gap) | `rxdb-db-collection/src/rxdb.ts:283` |

The survey found that post-ready failures keep the last snapshot readable in
every adapter. Electric also calls `markError` after ready
(`electric.ts:2628, 2708`), which places it on the R3 side of C1.

### Ablation and model check

`SourceFailure.tla` encodes G1 to G6 as variables and R1 to R9 as actions and
invariants. TLC 2.19 (rev 5a47802) ran with `-deadlock` and `MaxAttempts = 3`.

| Configuration | Result |
| --- | --- |
| `safe` | no error, 31 distinct states |
| `weak-heal` (ablate R2) | `NoHeal` violated: Start, SourceReady, FinalError, SourceReady |
| `weak-reject-on-retry` (ablate R1) | `RetryIsNotFailure` violated: Start, TransientError |
| `weak-detach-waits` (ablate R3) | `PassThrough` violated: Start, TransientError, FinalError |
| `weak-clear-late` (ablate R5's snapshot clause) | `ReadyMeansRows` violated: Start, SourceReady, LateFailure |
| `weak-poison` (ablate R6) | `RequestFailureIsLocal` violated: Start, RequestFails |
| `weak-stale` (ablate R7) | `ErrorIsOwn` violated: Start, TransientError, FinalError, AppRestart, TransientError, StaleCallback |
| `weak-silent-give-up` (ablate R8) | `StoppedSourceReported` violated: Start, SdkGivesUp |
| `weak-framework-retry` (ablate R9) | `OnlyAppRestarts` violated: Start, FinalError, AutoRestart |
| `weak-lazy-terminal` (ablate F11 under healing) | `ConsumersAgree` violated: Start, TransientError, FinalError, SourceReady |

Every rule is load-bearing: removing any one produces its expected
counterexample. The lazy asymmetry (V9) violates agreement only when healing is
also allowed. Under R2, root and lazy demand both end in terminal error, so
V9's bug class disappears instead of needing recovery code.

Encoding receipt: in the first `weak-poison` run, `RequestFails` assigned
`live'` twice, so the poison branch was disabled and TLC found no error. The
action now assigns `live'` once in each branch.

### Range, negative case, and limits

- **Range:** untested. No independent marginal case was supplied.
- **Negative case:** a collection that silently returns from `error` to
  `ready` when the network comes back ("stale-while-revalidate healing"). The
  grammar must not generate it, and R2 excludes it.
- **Limits:** one source, two live-query shapes, one wait, and at most three
  attempts. No fairness and no liveness. TLC checks the rules' internal
  consequences, not that production follows them.

## Adjacent forms

- **AF1 degraded ready (C1, R5 branch):** a failure after ready keeps the
  status `ready` and the rows, and exposes the error through utilities such as
  query-db's `lastError`. Route: rule combination R4 + R5. Loss: consumers that
  must not act on stale data get no status signal.
- **AF2 final after ready (C1, R3 branch):** a final failure after ready moves
  the status to `error` and keeps the last rows readable while consumers report
  the error. Route: rule combination R3 + R5. Loss: every dependent query
  enters error even when its rows were still correct.
- **AF3 app retry helper (G6 + R9):** one call restarts a failed source and its
  dependent live queries, replacing the manual sequence in
  `error-handling.md`. Route: modular augment over the existing cleanup and
  restart interface. Cost: a new public API.

## Process record

- Source and preservation list frozen with the user's correction to F8.
- Source facts: an Explore survey of every `markError` and `markReady` call
  site, plus direct reads of `query.ts:2556` and `powersync.ts:805–830`. The
  survey missed V1; the direct read found it.
- Every model element traces to a frozen item, as listed above.

Run a configuration from this directory:

```sh
~/.claude/skills/field-lab/scripts/tlc . -deadlock -config safe.cfg SourceFailure
```
