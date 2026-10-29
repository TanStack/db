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
