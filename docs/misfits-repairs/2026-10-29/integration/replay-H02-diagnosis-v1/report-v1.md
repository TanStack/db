# H02 bounded causal packet v1

## Result and claim boundary

The custom-key receiving path exhibits a reproducible bounded prefix of actual
Collection acquisition/unload feedback. The unchanged archived driver also
exhausts a 384 MiB heap against reconstructed baseline source. The controls
exclude a Vitest-spy-only explanation, growing subscription identities, and
retained acquisition/options history as necessary causes of that feedback.
They do not attribute every historical OOM allocation or prove that the exact
historical built process had the same cause.

**Historical H02 remains unverified/excluded.** No intended retained-publication
comparison completed, no receiving reach receives credit, and no bug class is
closed. No production or oracle repair, contract redesign, canonical status edit,
commit, or publishing occurred. This packet is a candidate law-interaction and
liveness investigation, not a tested fix.

Historical R23/R24 logs did not establish which phase exhausted memory. Their
old initial-preload account is unestablished. In this reconstruction, primitive
instrumentation proves initial preload settles before the feedback begins.

## Identities and containment

- Archived source: `3937a73aeb3a273c95ab77b8d8dd66fc739517c5`.
- Scratch: `/private/tmp/replay-h02-diagnostic-mo8pxcv_`.
- Raw archived driver SHA256: `56e2f2854d978826ad89747f209d4e00db50879f8e065e21ab6d5607359919c8`.
- Retained-publication helper SHA256: `267e425349cc6bae7b34637411ccb1f675ec11bf832fd20061869a1ed150b70f`.
- `diagnostic-freeze-v1.json` pins every diagnostic driver/config/runner, four
  critical historical production files, runtime versions, and the source
  manifest. The four production hashes equal the archived baseline receipt.
- `reconstructed-source-manifest.json` names 161 files: 125 DB, 29 db-ivm,
  seven query-db-collection source files. No production file was edited.
- Vitest 4.1.12, Vite 7.3.7, Query Core 5.90.20, jsdom 27.4.0, Node v24.19.0.
  Dependencies were separate copy-on-write clones of the coordinator tree.
  Critical workspace/runtime links resolve inside scratch.
- Explicit source aliases replace DB and db-ivm package dist entry points.
  **No build ran. Original early built bytes are unavailable.** These runs
  reconstruct a source receiving path; they are not exact historical process
  reproduction or current integrated-tree evidence.

The runner uses one fork worker and 384 MiB Node heap per Node process. A
supervisor samples whole process-group RSS, enforces 1 GiB RSS and 20 seconds,
and kills the complete process group. Instrumented runs emit at most 128
primitive events. At event128 a synchronous sentinel blocks that diagnostic
worker; the supervisor observes the sentinel and kills the group. This ensures
that a cap does not depend on the possibly starved JS event loop. Every cap
termination is outside the comparison. No subprocess remains; slot3 is free.

## Legal key and source projection

The base key is `['replay-query-receiver-markers']`. A derived key is that
prefix followed by a stable numeric subscription identity and the finite
requested marker-key set. The original Map retains two subscription identities
throughout the observed feedback. Cache entries remain eight. All key members
are primitive values or finite arrays of primitive values; the key never
serializes a subscription graph.

Query Collection docs, "Using Query Key Builders" and "Query Key Prefix
Convention" (`docs/collections/query-collection.md:1564–1610`), allow function
keys, require the base prefix, and require every data-changing request option.
In every observed provider demand, `orderBy`, `limit`, and `offset` are absent.
The provider returns all marked rows among the exact predicate-selected keys
from its fixed five-row domain; requestedKeys is its full data-changing demand
projection. Key computation is stable across the same acquisition/release.
Thus no omitted observed data dimension or unstable identity explains these
receipts. This legality judgment is scoped to this finite provider and these
observed options, not a general endorsement of dropping order/limit options.

## Distinguishing causal prefix

1. Source has rows1–5 ordered by rank. Markers initially exist for1,3,4,5.
   The live query left-joins markers, selects unmatched source rows, applies
   offset1/limit1, and includes markers correlated by the same row id.
2. Initial preload settles: eight acquisitions, eight provider calls, two
   subscription identities, eight Query cache entries.
3. Hold provider fetches, remove marker3 from the provider, call the public
   `markers.reload()`. Its initial timer-based flush completes.
4. Release held join fetch `[1,2]`; its timer-based flush completes.
5. Release held join fetch `[3]`, whose new result is empty. Before this release's
   timer-based flush returns, the include repeatedly acquires and unloads its
   same `[3]` demand, with no further driver release or provider answer.
6. The join cache for owner0/[3] contains `[]`; the include cache for owner1/[3]
   still contains `[3]`. Its one new refetch remains pending. Public marker3
   membership is false before each include acquisition and true before each
   include unload. The active route therefore invalidates and recreates itself
   while replaying that retained cache value.

E05 records actual Collection `_sync.loadSubset` and `_sync.unloadSubset`
calls, not just Query observer events. E06 removes the Vitest spy and every
stored options/subscription/acquisition-history object; it retains only
primitive events, finite row/key data and pending transport resolvers. Feedback
still reaches the cap. Therefore recorded subscription graphs are not needed
for the demonstrated operational feedback. The exact contribution of those
recorders to the raw OOM's heap growth was not profiled and remains open.

E07 removes only the correlated include and the same two-release schedule
completes. E08 removes ordered windowing (orderBy/offset/limit) while retaining
the include and custom key; its schedule completes. The window changes which
provider scopes exist, so these ablations localize a composition, not a unique
production helper. Neither control substitutes the default semantic key.

## Fairness and external-completion controls

`flushPromises` is literally a Promise resolved by `setTimeout(resolve,0)` in
`packages/db/tests/utils.ts:534`. The original experimental release loop waits
for that timer after each answer, so by itself it could be accused of withholding
a useful completion behind an unsuitable checkpoint.

E10 removes that dependency for the new held include fetch: when fetch13 for
`[3]` starts, it arms a zero-delay timer that will complete all held provider
work. The timer is armed at31.116ms; feedback continues through40.229ms and
128events without its completion callback firing. E11 makes the same intervention
with `queueMicrotask`, armed at25.793ms; it too fails to execute before32.662ms
and the cap. Both are genuine completion opportunities already queued by the
provider. The callback must execute even if the original release loop waits.

This finite evidence is consistent with synchronous reentry/feedback starving
both microtasks and timers. It is stronger than observer-only churn or a driver
that merely forgets to answer a request. It is **not** proof of an infinite
execution, a heap-allocation attribution, or an identified production call-stack
cycle; a fresh reader should verify that mechanism before a defect claim. The
sentinel itself blocks only after event128 and cannot explain any earlier
missing completion.

## Accepted laws constrain the repair

`ownership-lifecycle.oracle.test.ts:961–975` explicitly requires a reacquired
observer lease to own its current cached result while a stale refetch is
pending. A failed refetch retains that result; staleTime controls whether to
refetch, not whether cached rows are owned. Skipping the include's cached data
would violate this accepted contract. That tempting change is not an authorized
bug fix.

Live architecture laws6/7 govern stale demand and applied settlement, law9
requires complete graph publication, law10 requires uncovered-demand loading,
law11 requires explicit row ownership, and law13 bounds retained state. None
alone states a numeric retry budget or complete liveness theorem for this
nonmonotone anti-join/include ownership interaction. A bounded active-demand
feedback prefix does not by itself prove law13's retained-state violation.

The immediate classification is a **candidate product liveness defect at a
contract interaction**, with a credible receiving witness. Key-builder misuse,
recorder-only growth, and fair completion withheld solely by the driver are
unsupported explanations for the observed prefix. Exact violated liveness
promise, repair location, and class closure remain for independent review.
The original H02 OOM record remains unverified.

## Concrete oracle-first follow-up plan

1. Have an independent reviewer check the legal source/key schedule, queued
   completion controls, synchronous causal mechanism and the applicable repair
   location. Do not change ownership expectations to match production.
2. State a compositional liveness authority explicitly: with a finite legal
   source step and no additional external steps, graph processing must permit
   already queued provider completions; it cannot synchronously repeat the same
   active-demand ownership cycle without reaching a waiting cut. Establish
   whether this follows from the accepted preload/reload/async-source contracts
   or needs a maintainer decision. This is an authority question, not automatic
   authorization for a new cache/publication policy.
3. Extend the primary replay owner with a receiving witness across real Query
   cache leases, or add a separate receiving owner if that boundary needs an
   independent ownership judgment. Keep existing core retention laws and the
   Query reacquisition owner. The reference model should use finite relation
   membership, explicit cache-result versions, demands/owners, held provider
   replies and legal step cuts. It must not copy production route/retry states.
4. Generate nearby histories: marked subsets, zero/one/multiple initial unmatched
   rows, offsets/limits, anti-join membership changes, per-subscription versus
   compatible semantic cache identities, cached empty/nonempty results, fresh
   and stale refetch policy, join/include release order, timer/microtask
   completion, failure/cancel and cleanup. Declare reaches for distinct cached
   versions, cached include reacquisition while refetch is pending, and queued
   external completion during the interaction. Measure reach; pinned rows alone
   do not close the class.
5. Compare at justified public/waiting cuts: whether an independently queued
   completion can execute, exact active leases, public row membership, full
   result retention during replay, and final result after provider work settles.
   Isolate the watchdog in the driver; termination is a diagnostic, not a fake
   expected public row. Explain its relation to the accepted liveness law.
6. Freeze the pre-edit RED witness, then repair the correct boundary without
   dropping cached ownership. Show GREEN and a hostile original-behavior mutant
   rejection. Recheck both neighboring ownership and complete-publication laws.
   Any unresolved legal counterexample keeps the class open and needs its
   coverage-map owner. No such repair or oracle authoring is done in this task.

## Experiments

Each exact argv, cwd, driver hash, limit, exit status, duration and process-group
RSS receipt is in its `E*.json`; raw output is in matching `E*.log`.
`experiment-summary-v1.json` projects primitive phase counts and checkpoints.
Drivers in `drivers/` are frozen diagnostic inputs, not repaired oracle owners.

| Experiment | Exit / termination | Seconds | Max group MiB | Events |
|---|---|---:|---:|---:|
| E01-raw-source | 1 / normal leader exit | 7.369 | 977.5 | 0 |
| E02-instrumented | 1 / normal leader exit | 2.283 | 568.3 | 132 |
| E03-hardcap | -9 / event-cap | 1.971 | 580.2 | 128 |
| E04-no-spy | -9 / event-cap | 1.619 | 567.5 | 128 |
| E05-checkpoints | -9 / event-cap | 1.610 | 568.6 | 128 |
| E06-minimal-records | -9 / event-cap | 1.575 | 568.6 | 128 |
| E07-no-include | 0 / normal leader exit | 1.721 | 547.3 | 53 |
| E08-no-window | 0 / normal leader exit | 1.747 | 545.2 | 37 |
| E09-cache-observations | -9 / event-cap | 1.582 | 561.8 | 128 |
| E10-timer-completion | -9 / event-cap | 1.709 | 569.3 | 128 |
| E11-microtask-completion | -9 / event-cap | 1.631 | 566.7 | 128 |

E01 is the unchanged raw driver and OOMs; it completes no test. E02's attempted
`process.exit` cap was intercepted by Vitest and produced four harness errors;
its misleading passed-test line receives no credit. E03 fixes containment via
the external-supervisor sentinel. E03–E06/E09–E11 intentionally stop at128events.
E07/E08 complete their reduced diagnostic schedules but do not run the intended
retention comparison or establish general correctness.

The Vite config also reports missing Expo tsconfig bases elsewhere in the
archived workspace. These diagnostics occur before test startup in every run;
they do not prevent these tests from importing and executing. No dependency
installation or override was performed for this task.
