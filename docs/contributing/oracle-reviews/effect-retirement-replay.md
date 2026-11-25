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
