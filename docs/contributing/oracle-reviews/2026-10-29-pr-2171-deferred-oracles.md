# RC release scope: retained broader oracle failures

This release deliberately defers the broader production discoveries below.
Their laws remain accepted and their failing comparisons remain preserved.
No GREEN, retirement, or complete metadata/literal closure is claimed.

The exact original sources and deletion status are recoverable from the full
campaign snapshot `accepted-campaign-20261029T065509Z` (manifest SHA256 `7eb801592ddc3f5041f7db862052800e86523403784827552ad683c8eb40f0aa`). Its tracked patch, complete new/modified source
archive and per-file manifest are retained together. The accepted chunk records
and independent evidence remain in the original campaign evidence directory.
The complete accepted source tree is also preserved on local branch
`codex/rc-oracle-followup`, commit `db38b4e009146af53e46aeeef3206269f5968af8`.
No follow-up PR is claimed until one is actually created.

- P09: Effect LEFT-join startup emits a phantom update. The accepted owner has
  152 passes / 64 intended REDs and 5,512 reached cells; its concrete witness
  also fails frozen main.
- P10: reserved metadata leaks or is spoofed before correlated-child functional
  callbacks. The approved callback law remains normative. The accepted runtime
  owner has 377 passes / 203 intended REDs and all 2,153 cells; the bounded
  concrete lane has the same seven failures and one compatible pass on main.
- P11/P12: raw undefined becomes null and selected empty records disappear.
  Their root/QueryRef runtime owner retains 18 REDs, correlated receiver 72 REDs,
  and source-public type receiver 280 REDs. Every declared receiving cell and
  accepted calibration remains preserved. These paths are source-unchanged;
  a full main-baseline campaign was not executed.
- The appended chunk-24 type receiver retains 672 ordinary-metadata leak REDs
  and 12 discriminant-specific union-spread REDs, all 6,240 declared states and
  its corrected actual-callback observation/43-control evidence. Static and
  runtime observations remain distinct.

The original 24 nullable-facade/public-output type campaigns and nine controls
remain active on the release branch, as do root/union/join/timeline/facade
metadata regressions, their shared grammar/source/interval models, and the
already-green descriptor/schema/source-ID improvements. The release's cache,
Offline, mutation, publisher, CI and packed-artifact gates remain required.

The following complete files travel together to follow-up. The appended literal
slice of `subquery-user-value-oracle.test.ts` and appended receiving slice of
`virtual-row-fields-types-oracle.test.ts` are also preserved in that snapshot.
No skipped tests or narrowed expected comparisons implement this partition.

- `packages/db/tests/query/virtual-row-fields-effect-oracle.test.ts`
- `packages/db/tests/query/virtual-row-fields-input-oracle.ts`
- `packages/db/tests/query/virtual-row-fields-input-driver.ts`
- `packages/db/tests/query/virtual-row-fields-input-oracle.test.ts`
- `packages/db/tests/query/subquery-literal-value-oracle.ts`
- `packages/db/tests/query/subquery-literal-value-driver.ts`
- `packages/db/tests/query/subquery-literal-correlated-oracle.ts`
- `packages/db/tests/query/subquery-literal-correlated-driver.ts`
- `packages/db/tests/query/subquery-literal-correlated-factories.ts`
- `packages/db/tests/query/subquery-literal-correlated-oracle.test.ts`
- `packages/db/tests/query/subquery-literal-types-oracle.ts`
- `packages/db/tests/query/subquery-literal-types-support.ts`
- `packages/db/tests/query/subquery-literal-types-oracle.test.ts`
- `packages/db/tests/query/virtual-row-fields-receiver-types-oracle.ts`
- `packages/db/tests/query/virtual-row-fields-receiver-types-support.ts`

The coverage map and architecture point here so historical full-campaign claims
below those entries cannot be mistaken for current release registrations.
Before follow-up repair, restore the exact dependent owner/driver/model slices,
reproduce their retained RED and reach, and then supply GREEN/mutant evidence.

## Further retained receiving and guidance gaps

P06/P07/P13/P14 prose conflicts are corrected on the release branch. Two
coverage obligations remain separate from that correction: P08 needs the actual
custom-adapter fenced callback to hold an establishing applied receipt before
load settlement; P14 needs the actual lazy child-ready call outcome compared
with the existing source-health model, instead of catching and discarding a
throw. Preserve the accepted owner, fresh-run neighbors and omitted-callback
reach controls before any follow-up production repair.

Installed declaration emission also exposes an unchanged-main portability gap.
The exact initial RC artifacts and strict installed main `95460bc875` both fail
in ESM and CommonJS for an exported inferred live-query factory (TS2742 twice,
TS4058) and an exported inferred Collection value (TS2742 twice, TS4023).
Private compiler/live types and `LIVE_QUERY_INTERNAL` cannot be named. This
affects libraries emitting declarations for these inferred exports, rather than
ordinary runtime use. Handler admission passes in both formats; it cannot prove
this separate portability law. The release does not repair this broader gap.

The following original factory witness is preserved verbatim so follow-up does
not depend only on temporary artifacts. Compile its `.mts` and `.cts` forms
with strict NodeNext declaration emission against actual installed tarballs.
Keep the original export unannotated. A separate named public view containing
only readonly `toArray` emits on both cuts, but is not a full-Collection
annotation workaround. Add legal generated row/key shapes and both factory and
inferred-value emission paths to the public-type owner before production repair.

```text
import { IR, Query, createLiveQueryCollection, eq, include, materialize, toArray } from '@tanstack/db';
import type { Collection, QueryResult } from '@tanstack/db';
type LiteralSourceRow = {
    id: number;
    version: number;
    optional?: string | null;
};
declare const source: Collection<LiteralSourceRow>;
declare const parents: Collection<{
    id: number;
    group: number;
}>;
declare function consume(row: object): void;
declare function consumeChild(row: object): void;
declare function consumeParent(row: object): void;
type __ArrayBase = Array<unknown>;
export function receiver() {
    const selected = new Query()
        .from({ row: source })
        .select(({ row }) => ({ id: row.id, version: row.version, value: 0 }));
    const __observedQuery = selected;
    const __observedCollection = createLiveQueryCollection({
        query: __observedQuery,
        getKey: (row) => row.id
    });
    type __Observe_finalQuery = QueryResult<typeof __observedQuery>;
    type __Observe_finalCollection = typeof __observedCollection.toArray[number];
    return __observedCollection;
}

```

Original source SHA256 is
`c6c8c1da415901f4935f611387e7f6a3234b5f9753544256f0680038dcc1b50d`.
Current/main final receiving receipts are
`eb157fdc5f567fc04647d206762d794455a998620adc3d9383abf74e0bfc503c` /
`2987feb2620ba1699869b12dbe51c811b6b0e6c389d06a176bf9a417d1827495`.
The original strict emitted factory/value REDs remain required follow-up
receivers. An agent-added narrow `Collection<Row, number>` annotation was an
invalid control on both cuts and supplies no product-failure credit.

## Live-query mutation input and full-handler receiving types

The release also defers a public read/write type conflation. Independent source
checking compared current `180b920edd6c88a7024ed407cd04934678c7d5bf` with main
`95460bc875a2259b34eea534e5592a9d0394e73f` using TypeScript 5.9.3. Both already
carry required virtual metadata from a no-select query's published result into
its default mutation input and invariant full handler Transaction/Collection.
The nullable-facade and union-brand repairs do not change this path. Required
readonly metadata on published read rows remains the accepted law; this record
does not authorize removing it.

A stable public witness configures `onInsert`, then calls
`collection.insert({ id: 'one', label: 'new', rank: 1 })` on a live-query
Collection of that ordinary row. Both revisions reject the business row with
TS2345 because computed virtual fields are missing. Separately, a reusable
`UpdateMutationFn<Row>` on explicit live-query configs, core creation and React
config hooks passes when a fresh Program requests diagnostics first, but fails
with TS2322/TS2769 after observing its context/published aliases. This checking
order sensitivity reproduces on both cuts; it is not a stable CLI RED. Ordinary
source handlers, contextual live handlers and the free-result options factory
are positive controls. All 26 final independent Programs have no setup errors.

Root explicitly retained this public defect for follow-up while permitting a
type-only structural recorder annotation in the JavaScript runtime schema
receiver. That receiver still checks every ordinary handler field and makes no
public mutation-type claim. Its green histories cannot close this separate gap.

Extend the public metadata type owner and mutation-handler admission owner with
the same authored business row through live-query factories and framework
configs. Compare plain mutation input and reusable full-handler admission while
read results retain required metadata. Add source-public, built/installed and
framework receiving checkpoints; retain ordinary diagnostics and observed-type
checking orders, or a stable source discriminator, before production repair.

The exact source/diagnostic matrix SHA256 is
`3aac69adf834870f402e3334cdfe372f6f07b924ff5f67fd54e406eba69ef14d`;
the classification report is
`2e60e015e5f42b24027eb53d13863d76c2b2530c01a49616cc746c70952906ab`.
Both remain under the original campaign evidence directory as
`metadata-mutation-classification-matrix.json` and
`metadata-mutation-type-classification.md`. No production repair or bug-class
closure is claimed.

## Shared-source replay with late include demand

The release defers a replay publication defect confirmed on release head
`d9911f17b5e9de872cac5c9fd745c656ff50d3ad` and exact main
`95460bc875a2259b34eea534e5592a9d0394e73f`. The primary owner is
`packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`.
Its native named property `replay.ordered-failed-replay`, seed `521312968`,
path `255:3:3:8:11:9` fails on both cuts at `checkRetention`, after the final
settle: row1 is public while the retained complete window is `[]`. An
independent reviewer reproduced both failures and accepted this classification.
The owner is byte-identical on both cuts (SHA256
`27f76be612a3058235953e5b984b77ba9274f1aab073035543161b71d4d14e48`).

The accepted authority is `packages/db/src/query/live/ARCHITECTURE.md`,
“Replay participants and failure,” and normative law 9. A live query's join
and include subscriptions to one source share one publication barrier; demand
started while that source replay remains open must hold the prior complete
result until its current acquisition settles or aborts. Here the include has
no demand at truncate. It acquires and replaces marker demand while the join
replay remains open. Its failed acquisition retires, but its replacement for
key1 is still pending and nonaborted when the final join load settles. The
model has no retained failure at that cut. Publishing row1 therefore violates
the shared-source barrier; a stale model failure does not explain the RED.

The preserved seven-command witness is:

```json
[
  { "type": "hold" },
  { "type": "truncateMarkers" },
  { "type": "settle", "ok": true, "keepHolding": true, "newest": false },
  { "type": "settle", "ok": false, "newest": true, "keepHolding": true },
  { "type": "settle", "ok": true, "keepHolding": true, "newest": false },
  { "type": "mark", "id": 1, "on": false },
  { "type": "settle", "ok": true, "keepHolding": false, "newest": false }
]
```

Its scenario is descending, offset1, limit2, no ties, no peer, `joined: none`
(anti-join), on-demand markers, includes enabled, aborted marker loads resolve,
and history starts after preload. From each frozen snapshot's `packages/db`,
the actual noninstrumented replay command was:

```sh
TANSTACK_DB_ORACLE_PROPERTY=replay.ordered-failed-replay \
TANSTACK_DB_ORACLE_SEED=521312968 \
TANSTACK_DB_ORACLE_PATH=255:3:3:8:11:9 \
../../node_modules/.bin/vitest run --config ../../replay-db.config.mts \
  --coverage.enabled=false --typecheck.enabled=false \
  tests/query/load-subset-replay-refinement-oracle.test.ts \
  -t 'keeps the last publication through a failed replay'
```

Both runs used Node 24.19.0, Vitest 4.1.12 and fast-check 3.23.2. The scratch
config merges each cut's DB config and aliases DB/IVM to that cut's own source;
tools alone are borrowed. Independent verification compared all 154 DB/IVM
source files with their Git objects, with no differences or foreign source.
This reproduces the named assertion failure, not CI's entire environment.
The original CI log remains under the campaign evidence directory at
`ci-head-d9911f17b/failed-123338231520.log`; the frozen cuts, exact logs,
diagnostic logs and independent review remain in `ci-replay-521312968/`.
The independent report
`independent-retention-review.md` has SHA256
`a36d5793c87495efb5516ca42ee4adeede867da462bc2e869e6c3698a44b63db`;
its source verification receipt has SHA256
`7385d6a029caa6daeab3b1d285164df7a8dd3c4598c1e892b4bba0f944b51bde`.

Before production repair, preserve this replay and add measured reach for a
receiving subscription with no demand at truncate, late demand while a sibling
replay is loading, failure retirement followed by a held replacement, and
success/abort neighbors across multiple subscriptions to the same source.
Then demonstrate the retained-publication comparison before replacement
settlement and after it. The original oracle remains active and unchanged;
there is no skip, narrowed comparison, retry-away, GREEN, or bug-class closure
claim. Its CI RED remains an open baseline defect under this explicit release
scope deferral.
