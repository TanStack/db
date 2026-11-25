# Effect publication across successful acquisition and truncate replay

Baseline `371e40d48739607cb4d2d53c898e80a1df00b5ae`. This record is bound to
the following Git blobs.

| Source | Git blob |
| --- | --- |
| `src/query/effect.ts` | `ad6bf9769c127e528f9eb936bb52ce3a8c2cff69` |
| `tests/query/ordered-source-loader-state-oracle.test.ts` | `821c8805094e2a3b5dac8f045d21aa876ebb9588` |
| `tests/query/includes-temporal-oracle.test.ts` | `2c2b4c4d7d4ce812a9975c6aefbc6b8a4dc42653` |

Paths in the table are relative to `packages/db`.

## Law and witnesses

[Atomic window publication and replay participants](../../../packages/db/src/query/live/ARCHITECTURE.md#atomic-window-publication)
require the last complete window to remain public while a repair or the
truncate replay it starts still owes a replacement. A successful repair
can start that replay when it releases a superseded acquisition. The raw
source can already be empty. The Effect must hold the preceding result and
emit the net delta only after the replacement applies. A rejected replay
keeps the preceding result. The originating error decides the Effect or
window operation on the paths that expose it.

[Initial readiness](../../../packages/db/src/query/live/ARCHITECTURE.md#mutation-boundaries-and-initial-readiness)
gives the same pending replay authority over an Effect's first acquisition.
A `skipInitial` Effect suppresses replay delivery when truncate starts
before the successful initial acquisition's observers run. After the
replacement settles it reports later matching writes.

The retirement receiver covers a live-query Collection, a Collection with
an active window move, and an Effect. The provider truth sorts independently
of the loader to derive before and after windows and expected callback
events. The driver records adapter entry, applied raw rows, public batches,
window options at fulfillment and the originating error. The temporal
receiver enumerates source readiness and ordinary-write positions around
same-turn initial fulfillment and truncate. It compares against the
existing readiness model, and its ready-at-start twin checks independence
from the on-demand source's Collection readiness.

## RED, GREEN, and calibration

- On the baseline, the retirement oracle rejected a held Effect replay at
  random seed `-199466404`, path `37:0:1:1`, because a callback showed row
  2 while row 1 should still be public. Fixed seed `20261029`, path
  `7:0:1:1`, caught a replay that emitted two batches when its answer was
  unheld. The expanded grammar decodes that random replay path as a rejected
  replay. In a scratch run, the literal successful history also failed the
  held-cut comparison and its determinism check on the baseline. Both tests
  passed with the production change.
- The initial-acquisition witness was identified during follow-up review.
  With the expanded temporal oracle and the original Effect implementation,
  all 12 new histories failed on replay settlement. The real Effect
  delivered rows that the model still classified as initial. The same
  selected histories pass with the production change already made for the
  retirement defect. There was no further production edit.
- The retirement owner passes 125 tests and the temporal owner passes 906.
  The temporal enumeration reached a second, still-pending acquisition
  after same-turn initial fulfillment in all 12 new histories. The
  retirement owner checks 20 independently drawn bases for each of 12
  constructions in both seed campaigns. Each construction requires every
  state it names. The 1,200 ordinary generated histories per campaign
  retain their separate aggregate thresholds. Fixed and random held-replay
  reach was 63 and 52 for Collection, 50 and 61 for the window move, and 59
  and 52 for Effect. The minified suite passes 522 tests. The DB test
  configuration type-checks, and changed-file oracle lint and formatting
  pass.
- The older retirement receiver accepted an Effect that reported an
  entering replay row as an update. The expanded comparison fails at
  `retirement receiver: Effect callback deltas`. The older receiver also
  accepted a window getter that always reported its initial options. The
  expanded comparison rejects it at window fulfillment. Suppressing the
  sixth constructed Effect case's reach survives with five bases and
  fails the named `effect-held-replay` state with 20.
- The prior scoped mutation run also rejected clearing a newer ordering
  invalidation, resuming an obsolete chain, and dropping a successful
  replay handoff. The source of the Effect, loader and Collection builder
  is identical across the original and follow-up oracle runs. The wider
  mutation run remains provisional because its capture failed in four
  other files.

Run the parent retirement replay in `packages/db` with the original
`effect.ts`. The expanded grammar decodes this coordinate as the
neighboring rejected-replay outcome. Both histories fail the same held cut.

```sh
TANSTACK_DB_ORACLE_PROPERTY=ordered-loader.retirement-receiver \
TANSTACK_DB_ORACLE_SEED=-199466404 TANSTACK_DB_ORACLE_PATH=37:0:1:1 \
TANSTACK_DB_ORACLE_UNIT='random seed: generated' \
pnpm exec vitest run --coverage.enabled=false --maxWorkers=1 \
  tests/query/ordered-source-loader-state-oracle.test.ts
```

For the initial gate use the same Vitest options with
`tests/query/includes-temporal-oracle.test.ts -t settle-and-truncate`.
Remove the selector and run both owner files for GREEN.

## Oracle review

| Rubric | Result |
| --- | --- |
| ORC-001–003 | The architecture supplies the publication and readiness laws. A full-provider sort, keyed comparison of complete windows, and current-demand readiness model supply independent judgments. Both owning suites state the production path and observation cuts. |
| ORC-004–005 | The grammar reconstructs the retirement regression, a successful initial acquisition followed by truncate, and adjacent rejection, eviction, supersession, and ordinary-write controls. The drivers use actual Collection and Effect APIs and record callback deltas and settled options in addition to rows. |
| ORC-006–007 | Reverting the Effect behavior and corrupting callback classification, settled window options, and constructed reach produce the failures above. The retirement owner runs its fixed and random campaigns and supports direct replay; the initial gate enumerates its finite histories. |
| ORC-008–009 | The callback model derives its events from two complete windows. Readiness retains the existing current-acquisition fact. Neither model tracks production leases, timers or ordering epochs. |
| ORC-010–011 | Existing cleanup clears the adapter holds and consumer subscriptions. The readiness twin provides a second formulation for on-demand source readiness. The retirement expected rows and net deltas derive from provider truth independently of the recorded callbacks. |
| ORC-012–013 | This record binds the evidence. A fulfilled repair can start a replay and must hand off the publication hold. Eviction without replay, replay rejection after applied writes, an obsolete held repair, and ordinary initial load completion are legal neighboring cases. |
| ORC-014–016 | The adapters are controlled. Required reach binds to each constructed base or to every member of the temporal enumeration. Fixed retirement histories use the same driver and judgment. No provider or framework integration claim follows. |

The retirement receiver uses one ordered numeric source and one consumer,
with at most one unload-triggered truncate or one more ordering write while
an answer is held. The initial-replay receiver is a direct on-demand Effect.
Neither closes the separate joined-refill cut after replay settlement, or
claims coverage of repeated truncate cycles or arbitrary provider behavior.

## CI lint follow-up

CI rejected four conditions that TypeScript narrowed to their initial values.
Adapter callbacks update those values before the production driver checks them.
The two drivers now store their callback observations in object properties.
The histories, model, and comparison use the same observations.

| Source | Git blob |
| --- | --- |
| `tests/query/ordered-source-loader-state-oracle.test.ts` | `3c03e72955a7021fd82c2a8a91d576b1dbdf13b2` |
| `tests/query/includes-temporal-oracle.test.ts` | `b83c392e67e5e2a22cf060b9721063342df2a48e` |

ESLint and the changed-file oracle lint passed. The rerun on Arca passed
all 1,031 tests across both files.

## Joined refill after root replay

[Atomic window publication and ordered recovery](../../../packages/db/src/query/live/ARCHITECTURE.md#atomic-window-publication)
require the preceding complete window to remain public until the replacement
is ready. The repair also revalidates every demand it issues. A real
Collection published row 11 while its post-replay refill was pending, then
published rows 11 and 15 after settlement. The Effect retained rows 1 and 2
under the same schedule. The existing laws decide both results.

`ordered-work.joined-replay-refill` independently joins and sorts the complete
provider tables. It compares public reads and publications after the raw
truncate, after the root replay installs rows while the joined answer is
held, while a root refill is held, and after that refill settles. A complete
replacement prefix can publish after the joined answer settles. A short
prefix must wait for an authoritative refill. A rejected refill keeps the
preceding result and exposes the same error object. The Collection move
histories also compare the promise outcome, settled options, and the rows
visible when the move fulfills.

- **Reach.** The property enumerates 124 histories. The original axes are the
  consumer, index, width, truncate trigger, joined answer timing, and
  replacement outcome. The additional Collection histories move to zero, a
  smaller or wider window, or a different offset. The held joined replay
  followed by a held root refill is reached in 40 Collection and 16 Effect
  histories. An active Collection move is pending at both held answers in
  24 histories.
- **RED.** With the loader from `53770d6b5`, the command below rejects
  36 histories at `held refill reads`, including 12 with a window move.
- **GREEN.** The same command passes 124 histories and two runner checks.
  The loader stages the joined-window check for the next graph pass, which
  registers the next acquisition before reentrant graph work can publish
  it. Replay still retires superseded leases. The production change adds
  no retained state. Compared with `53770d6b5`, the package changes by
  +31 gzip and −25 Brotli bytes, and the typical app by +31 gzip and
  +29 Brotli bytes.
- **Mutant.** A refill that keeps the publication hold but accepts a cached
  answer is rejected at `repair refill revalidates its demand` in the
  unindexed retirement schedule with a held joined answer and width two.
- **Limits.** One root source, one lazy joined filter, ascending distinct
  numeric ranks, one truncate replay, controlled adapter answers and at
  most one Collection move. These histories cover the scheduled graph pass
  after real replay settlement. The blocked reentrant pass is checked in
  the controlled request ledger.

```sh
cd packages/db
pnpm exec vitest run --coverage.enabled=false --maxWorkers=2 \
  tests/query/ordered-work-oracle.property.test.ts \
  -t ordered-work.joined-replay-refill
```

### Request-ledger calibration

The bounded-work comparison applies independently to each ordering epoch and
source snapshot. The earlier comparison charged six reads to one chain.
The first shrunk witness, fixed seed `20261016`, path `0:1:2:2`, shows a
prefix, tie and refill before truncate and the same three demands against
the replacement snapshot. The fixed replay now runs through the shared
comparison. The generated fixed and random campaigns reached authoritative
reads on both sides of a truncate in 60 and 68 of 10,000 histories. Adding
one duplicate read to that fixed replay fails at
`ordered-source-loader-state-oracle.test.ts:2258`.

The blocked-pass comparison uses a successful prefix and tie from the current
epoch and snapshot to identify a later request that grows the same repair.
The same request must revalidate. The fixed and random generated campaigns
reach that comparison in 17 of 200 and 38 of 400 histories. Each constructed
campaign reaches it on all five bases. On the original loader the five fixed
bases pass. Dropping the staged continuation on reentry makes all five
request a larger prefix without revalidation and fail at
`repair refill after replay retirement`. On the repaired loader the replay
also stages the joined-window check. Dropping only the staged continuation
gave the same observed refill on this schedule. Dropping both ways of
resuming failed the request-authority progress comparison.

### Effect diagnostics

The production error owner runs the real Effect callback error path in
16 combinations of entry or batch, synchronous throw or asynchronous
rejection, development or production, and missing or throwing `onError`.
The comparison freezes the development line and preserves both the
callback error and the handler's own error identity at their destinations.
All 16 histories and the runner check pass. The suppression mutation
`query/effect.ts:M616` fails the four development cases with no error
handler.

| Source | Git blob |
| --- | --- |
| `src/query/live/ordered-source-loader.ts` | `00cc9e0bf1d02a51ce8c640074388603920ab504` |
| `tests/query/ordered-joined-replay-driver.ts` | `253d741c04f8507814d718ce7787eb6681cec0b5` |
| `tests/query/ordered-work-oracle.property.test.ts` | `2730bc776db9a95af8221327628a43ea72e8110f` |
| `tests/query/ordered-source-loader-state-oracle.test.ts` | `4b7102947ec746f28ad5eff44f113992c0360fdf` |
| `tests/production-error-messages-oracle.test.ts` | `9250650ed7ad3ac61e06b2a9a380a45b72123d85` |

Paths in the table are relative to `packages/db`.

## Supersession of an aborted refill

[Replay participants and failure](../../../packages/db/src/query/live/ARCHITECTURE.md#replay-participants-and-failure)
requires an aborted acquisition to stop holding publication. A newer
truncate replays its logical demand without waiting for the old transport.
Both Collection and Effect formerly retained rows 1 and 2 after the newer
replay installed rows 21 and 22. The old refill still owned an ordered
participant. An ordered participant now ends when its acquisition aborts.
The Effect resets the ordered cursor on truncate and resumes its loader
when the current replay succeeds.

- **Reach.** The same joined-refill property now enumerates 188 histories.
  Sixty-four start a second truncate across both receivers, index settings,
  initial widths, first-truncate triggers, current replay outcomes, and
  obsolete fulfillment or rejection. There are 32 histories per receiver
  with a real abort and unresolved old transport. The second replay installs
  rows before its controlled fulfillment or rejection. After success, the
  history delivers a new ordering change and checks bounded repair.
- **RED.** On `c522d2ff8` the joined-refill command rejects all 32 histories
  where the newer replay succeeds. The first differences are the settled
  window in 24 histories and reads after the obsolete result in eight.
- **GREEN.** The joined-refill command passes all 188 histories and two
  runner checks. Nine related files passed 2,783 tests before the final
  test-only expansion of the second replay outcome and later write. The
  replay manifest checks also passed with both new properties registered.
- **Mutants.** Keeping the participant pending on abort fails all eight
  selected unindexed width-two cases. Omitting the Effect's call to settle
  the loader on replay success fails three selected explicit cases at
  the held-refill checkpoint. Allowing the aborted transport to reach
  loader settlement passes all 64 repeated-replay cases before the later
  write. With the write it fails all 16 successful-replay histories with
  late rejection at `next repair starts bounded`.
- **Size.** Compared with `53770d6b5`, the production package adds
  235 gzip and 121 Brotli bytes. The typical app adds 154 gzip and 96
  Brotli bytes. Resolving the participant on abort alone made 24 Effect
  cases lose their refill. Those cases need the replay's own settlement
  to resume ordered loading. The repair reuses the loader's existing
  pending slot and the subscription's replay completion.
- **Limits.** The second successful replay supplies a complete prefix.
  The receiving histories exercise two truncates and one lazy join.
  The second-truncate cases use a fixed window. The earlier histories
  exercise the public window-move path separately.

| Source | Git blob |
| --- | --- |
| `src/query/effect.ts` | `b768c40df333e3160bf56dedccf10c9accd16c60` |
| `src/query/live/ordered-source-loader.ts` | `d1026285f5805ac5a4455e118c601a2fa48db7e1` |
| `tests/query/ordered-joined-replay-driver.ts` | `11be25224b36610e4b7be32b216fdba81978f8c4` |
| `tests/query/ordered-work-oracle.property.test.ts` | `3b3875687a51ad0b113db70c374c1d755718acc4` |

Paths in the table are relative to `packages/db`.

## Literal adapter answers and review calibration

The adapter can apply a root refill and return literal `true` while the
next repair acquisition still needs to run. Atomic window publication
requires the old complete window to remain visible through that continuation.
The Collection previously dropped the hold for a literal answer. Its loader
still returned a pending ordered participant. The subscriber now tracks that
participant without inspecting how its adapter answered.

The joined-refill property reaches a literal first refill followed by a held
repair in 16 Collection and 16 Effect histories, across both index settings,
truncate schedules, joined answer timings, and refill outcomes. On
`6d5331e51` all 16 Collection histories fail at `held refill reads`.
The Effect controls pass. The repair passes all 32 and keeps the existing
asynchronous witnesses green.

The driver records the Collection's array in its public order. Reversing that
observation fails the prior-window comparison. The driver also records every
post-replay root acquisition. Changing only the second request's revalidation
flag fails all 32 literal-answer histories. The completed-prefix control
allows one bounded prefix and its tie when replay invalidates the old repair.
Of 32 complete prefixes without a move, 24 made those two reads and eight
made none. Inserting a larger prefix into the recorded control fails all 32.
The replay manifest already rejects a property with no named owner. Its
two new owners passed the final manifest checks.

A later write after successful replay can now also delete the leading row.
Leaving the retirement flag set after its release pass fails the bounded
repair comparison in 16 of 32 delete histories. The unmodified flag passes
all 32. The complete joined-refill property now enumerates 252 histories
and passes 254 selected checks, including two runner checks.

## Initial demand whose transport ignores abort

[Initial readiness and replay participants](../../../packages/db/src/query/live/ARCHITECTURE.md#replay-participants-and-failure)
give current demand authority over the first ordinary Effect callback. A
direct or lazy joined acquisition may be aborted while the adapter keeps its
transport pending. The Effect must suppress the initial replay and then
deliver the first ordinary matching write once the current replay settles.

The temporal oracle reaches an aborted, unresolved original and a settled
replacement in 12 direct and 12 joined histories. It varies an initial
delivery, the source readiness transition, and the original transport's
later outcome. The ready-at-start twin uses the same history. On
`6d5331e51`, all 24 miss the first ordinary callback. Binding the acquisition
observer to the signal makes both receivers pass, including controls where
the old transport later rejects. The abort transfers readiness to the
current replay. Removing the signal handling for either the direct or joined
path fails all 12 histories for that receiver. The 12 existing same-turn
fulfillment histories also pass.

Compared with `53770d6b5`, the production package adds 320 gzip and 171
Brotli bytes. The typical app adds 195 gzip and 161 Brotli bytes. The
literal-answer fix removes the transport timing flag from the loader's
receiver contract. Direct and joined initial demand share one signal
observer and reuse their existing replay and readiness tracking.

| Source | Git blob |
| --- | --- |
| `src/deferred.ts` | `aa0116d40d0787592932b4d820d230cced33bde9` |
| `src/query/effect.ts` | `4d3d0b5f2d3445bb0e9b7c8a90adc47e53adaca2` |
| `src/query/live/collection-subscriber.ts` | `b7fba9a2a72929b87022e8b8a9e029b46a475723` |
| `src/query/live/ordered-source-loader.ts` | `94474021096ac8a632644dd38d847f95d4b91b21` |
| `src/query/live/subset-demand-controller.ts` | `92a24a318c8858545b919f92d403d8dbcb4f7930` |
| `tests/query/includes-temporal-oracle.test.ts` | `cd52a935af33f85a8ce69f8c8bd2af8f8b770d99` |
| `tests/query/ordered-joined-replay-driver.ts` | `46bf37e25c7aaaa3466a1cfbda959480c97f1696` |
| `tests/query/ordered-work-oracle.property.test.ts` | `1308ea9134d2e6cd8b47e57810f9e77a6aa4d0e0` |

Paths in the table are relative to `packages/db`.
