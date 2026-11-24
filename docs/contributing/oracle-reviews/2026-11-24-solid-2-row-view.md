# Solid 2 row view receiving evidence, 2026-11-24

This record covers `@tanstack/solid-db` on Solid 2.0 in
[PR #1728](https://github.com/TanStack/db/pull/1728): the row view that
replaces the Solid 1 read view, the adapter's bridge to the host, and the
receiving oracle that judges both. It records bounded observations, not merge
readiness. The nine properties of the Solid row-materialization owner keep
their laws, statements, histories and budgets.

## Reviewed revision and environment

**Production commit: `022a694f0`.** The fingerprints below identify
the implementation in that commit. Do not substitute a later head without
checking them. Three of the examples the mutant table names were added
afterwards, in `f6bae352e`, which changes no production source.

| Reviewed source | SHA-256 |
| --- | --- |
| `packages/solid-db/src/row-view.ts` | `3a19268a809d6faba7b86a07fc3b54031d110102314b4ba16be9d40c06178939` |
| `packages/solid-db/src/useLiveQuery.ts` | `bc190dd8f6ad14778e0148de38abf9452b86066eab2906b1b12df06fd556f22c` |

The host is `solid-js` 2.0.3 with `@solidjs/signals` 2.0.3, on `main`
`5448f3850`, with Vitest 5.1.0, `oracleProperty` from `@tanstack/oracles`
`6d05f05` and `oracle-gaps` from `@tanstack/oracles` `e2af13a`. The "before"
reports are `main`'s own adapter and this branch's earlier row store, each
under the same oracle build and seed. Scratch logs are under `/tmp/opencode`;
the verdict-critical results are kept here.

```sh
pnpm --filter @tanstack/solid-db test
pnpm gap-report --package packages/solid-db \
  --source src/row-view.ts,src/useLiveQuery.ts \
  --seed 2291 --contexts 8 --out <dir>
pnpm size:compare --packages solid-db --no-scenarios --files
```

## Law and authority

The laws are the nine properties of
[`row-materialization-oracle.test.tsx`](../../../packages/solid-db/tests/row-materialization-oracle.test.tsx):
nested identity, binding lifetime, current array membership, native parents,
descriptor visibility, live getters, shared graphs, callable fields, array
methods and reserved fields. Their authority is the maintainer decisions of
2026-10-30 recorded under [Framework row snapshot isolation](../oracle-coverage.md#framework-row-snapshot-isolation).
Borrowed rows are the shared
[`row-snapshot-oracle.ts`](../../../packages/db/tests/conformance/row-snapshot-oracle.ts)
law: framework materialization borrows Collection rows and cannot edit them.
No law, statement, history or budget changed in this migration. Each
property's `owns` names `src/useLiveQuery.ts#useLiveQuery` and
`src/row-view.ts#createRowView`.

## What changed in production

`row-view.ts` serves the Collection's own row through one stable view per
result row and copies nothing, as the React, Vue and Svelte adapters serve
their rows. The view is a Proxy whose target is a small state object carrying
the row's prototype; one handler serves every row, and each trap is a named
function the handler refers to, so the reference tree of `createRowView`
reaches all of them. A field read outside a tracking scope is served from the
row. A field read in one gets a signal for that field, made by the first such
read; membership and enumeration are followed through lazily made key-list
signals. A publication reads every tracked field of a changed row, then
switches the view and writes each field's signal; the signal's own comparison
keeps an equal value from notifying anybody. An unchanged row costs one
identity comparison.

`useLiveQuery.ts` walks each publication beside the previous one and looks a
key up only when the order shifted. The result array is one Proxy for the
life of the query: a read of a slot, of the length, or an enumeration of the
array follows one signal, turned only when membership or order changes,
because a view keeps its identity while its key is in the result. The public
keyed view `state` is created by its first read.

`vite.config.ts` inlines `@solid-primitives` into the test module graph. The
Solid plugin inlines Solid's runtime there and leaves the primitives to Node,
which loads a second copy, so a `ReactiveMap` notified no computation of the
first: in tests `state` was inert to every tracked reader, and no test read
it that way. Inlined, it is reactive in tests as it is in an application.

## Facts about the host that the design rests on

Each was read from the source or measured here.

- `createSignal(fn)` makes a computed value, not a signal holding a function,
  and the setter takes a function as an updater.
- A signal write is staged and commits at the next flush. A setter given an
  equal value returns before staging anything.
- A reactive write throws inside an owned scope, a component body or a
  computation, except in an effect's writable phase.
- A memo made inside a scope is that scope's child and dies with it; a later
  read of it is stale.
- A read is tracked if and only if `getObserver()` is not `null`.
- In a development build Solid wraps each event-handler expression in a
  strict-read window: a reactive value read untracked while an event is being
  handled is reported (`STRICT_READ_UNTRACKED`).
- Core publishes to its subscribers synchronously at `commit()`; the
  adapter's work lands one microtask later.
- Core admits every root row as a plain object: the reserved-fields law
  pins `Object.prototype` on the row for all three public inputs, and the
  correctness review's probe found a Solid store given as a row served back as
  a plain copy.
- A proxy may report a field its target does not hold only as configurable;
  an array target's `length` must keep the target's shape; and once the target
  is not extensible, `ownKeys` must report exactly the target's keys. The view
  therefore reports a fixed field as configurable and refuses a freeze.

## Design decisions that no law required

- **A function field** takes the function form of `createSignal`, a read-only
  signal that a setter may still write, with a function that reads the field
  from the row the view serves. Its first value is then the row's own.
- **An own accessor** is refused where a signal would hold its value, at the
  first tracked read and on a publication to a tracked field, and is served
  live to every other read. Core evaluates a row's own accessors before it
  admits it, so one can only be a contract breach.
- **Writes** through a view, a freeze and a new prototype are refused: a trap
  that returns `false` is a `TypeError` in strict mode and ignored otherwise,
  as for a frozen object. A nested object is the Collection's own.
- **The array's readers** follow membership and order together rather than
  slot by slot: a reader of `query()[i]` re-runs when any row joins, leaves or
  moves.
- **A publication does not read a signal.** It writes each field and lets the
  signal's comparison decide. Reading first was equivalent and one line
  shorter, and in a development build it drew the strict-read report from
  every event that published.
- **Each update keeps its own values.** A read of a tracked field can run the
  code of an inherited getter, and that can update another row; one shared
  buffer across rows let the inner update's values be written into the outer
  row's signals.

## Limits of the design

Two follow from the view's shape. Neither is reachable through the hook,
where every root row is a plain object with `Object.prototype`.

- The view keeps the prototype of the row it was made from.
- Membership follows the row's own names. A name a later row inherits is read
  as it is, but a reader of it in a tracking scope is not woken while the own
  names stay the same.

## Reach

The owner's histories are enumerated and unchanged. The five
`framework.solid.*` properties of `useLiveQuery.test.tsx` print a fixed-seed
reach report; under the same oracle build, all thirteen fixed-seed lines are
byte-identical to `main`'s. That compares histories walked, not adapter
internals: the Solid 1 and Solid 2 adapters reach the same states on the same
seeds.

## RED, GREEN and mutants

| Execution | Result and classification |
| --- | --- |
| Receiving checks on the branch's earlier `createProjection` adapter | 100 failed, 178 passed: live-getters 24, callable-fields 12, reserved-fields 39, descriptor-visibility 25. Its reconcile copied plain data and lost or froze what the laws protect. |
| A first draft of the row view: a function made a plain signal's first value | Rejected by the full suite: `solid.callable-fields` at the root, `current.format is not a function`. Solid made the function a computed value. |
| A second draft: the value set inside the reading scope | Rejected by the full suite: `[REACTIVE_WRITE_IN_OWNED_SCOPE]` halted four test files. |
| A third draft: the value set with no owner | Rejected by `solid.callable-fields` at its initial checkpoint: the staged write had not committed, so the first read was `undefined`. |
| The candidate before review, in a browser | The example worked, and its console carried `STRICT_READ_UNTRACKED` four to seven times a route: the publication read a signal. |
| An enumeration of the result array, before review | A reader of `Object.keys(query())` stayed at its first value after rows joined and left. |
| A re-entrant update, before review | A getter that updated a second row mid-read wrote that row's value into the first row's signal: `x` held 999. |
| Final package, typecheck on | 578 passed in 11 files. |
| Coverage of the two production files | `row-view.ts`: 69 of 69 statements, 38 of 38 branches, 21 of 21 functions. `useLiveQuery.ts`: 142, 66 and 34 of each. |

Each of the three reviewed defects is closed by its reviewer's probe. The
review reports those probes failing on the code it reviewed; the same twenty
tests across six files were re-run here on the reviewed sources and pass.

Twenty-eight hand-written mutants, seventeen of the row view and eleven of
the adapter, each applied to the reviewed sources and run against the
smallest test that should reject it. All were rejected; none survived.

| Mutant | Rejected by |
| --- | --- |
| A read in a tracking scope never tracked | `row-view.test.tsx`: 7 examples, at `expected 'b' to be 'B'` |
| The two zeros compared equal | `solid.reserved-fields`: 6 histories, at `tracked own data follows its admitted stage` |
| Membership untracked; an own-key change untracked | `row-view.test.tsx`, at `expected false to be true` |
| Enumeration untracked; enumerable keys never written | `row-view.test.tsx`: 2 examples each, at `expected ['id'] to deeply equal ['id', 'secret']` |
| Own keys never written | `row-view.test.tsx`: 2 examples, at `expected false to be true` |
| An array's `length` reported configurable | V8: `'getOwnPropertyDescriptor' on proxy: trap returned descriptor for property 'length' that is incompatible with the existing property` |
| A fixed field reported fixed | V8: `trap reported non-configurability for property 'fixed'` |
| A write accepted; a freeze allowed | `row-view.test.tsx`: `expected function to throw an error, but it didn't` |
| A row released before its fields are validated | `row-view.test.tsx`, at `expected 'never' to be 'a'`: the refused row leaked |
| A function made a plain signal's first value | `solid.callable-fields`: 34 histories |
| A function written without an updater | `solid.callable-fields`: 33 histories |
| An accessor held | `row-view.test.tsx`: `expected [Function trackTitle] to throw an error` |
| No identity guard in `update` | `result-array.test.tsx`, at `expected 2 to be +0`: two descriptor reads for an untouched row |
| The prototype not kept | `row-view.test.tsx`, at `expected { …(12) } to be null` |
| The array's readers unfollowed | `result-array.test.tsx`, at `expected 2 to be 3` |
| The array always relaid | `result-array.test.tsx`: 2 examples, at `expected { length: 2, first: 2 } to deeply equal { length: 1, first: 1 }` |
| Order not followed | `result-array.test.tsx`, at `expected { id: 'b', … } to be { id: 'c', … }` |
| The keyed view recreated on each read; never kept | `result-array.test.tsx`, at `expected 2 to be 3` |
| A departed row retained | `result-array.test.tsx`: 2 examples, at `expected true to be false` |
| The array's enumeration untracked | `result-array.test.tsx`, at `expected [3, '012', 3, 3, true] to deeply equal [3, '012', 3, 4, true]` |
| A slot's descriptor untracked | `result-array.test.tsx`, at `expected true to be false` |
| A replaced Collection's views not reset | `result-array.test.tsx`, at `expected { id: 'b', … } not to be { id: 'b', … }`: the view of a key present in both Collections was reused |
| The keyed view not cleared for a replaced Collection | `result-array.test.tsx`, at `expected ['a', 'b', 'd'] to deeply equal ['b', 'd']` |
| A move that keeps the row count not laid out | `result-array.test.tsx`: 2 examples, at `expected 'abc' to be 'bca'` |

Two of these were equivalent until an example made the difference observable.
The identity guard is behaviourally equivalent and exists for its cost: it
survived every example until one counted the descriptor reads of a row a
publication left untouched. The array's `ownKeys` trap overlaps with its
descriptor trap for every enumeration of an array, whose own keys always
include `length`; it is load-bearing for `Reflect.ownKeys` alone, and an
example reads it that way. One candidate is equivalent and is not in the
table: a `preventExtensions` trap that answers `true`. V8 lets such a trap
succeed only on a target that is already non-extensible, so the attempt
throws either way.

Supplemental examples live in two ordinary files. `row-view.test.tsx` pins
the view's own boundary: the reserved name and a null prototype, the accessor
rule, an Array row, a hidden field, an own `undefined`, a fixed field, a
re-entrant update and the refusals. `result-array.test.tsx` pins the two
public surfaces the laws read but do not judge: the array indexed, reordered,
replaced and enumerated, and the keyed view.

## Gap report

Same tool, harness and seed on all three. The owner is the only oracle file
that names these functions; ordinary tests are not credited as kills. The
scan on the reviewed sources passed its baseline and is not provisional, and
no function is unowned.

| | `main` | row store | row view |
| --- | ---: | ---: | ---: |
| Mutants | 481 | 446 | 359 |
| Killed by a law | 169 | 193 | 107 |
| Survived | 138 | 153 | 124 |
| Crashed production | 95 | 42 | 35 |
| Unreached | 56 | 50 | 84 |
| Timed out | 23 | 8 | 9 |
| Gaps | 312 | 253 | 252 |

| Law | Kills on `main` | Kills, row store | Kills, row view |
| --- | ---: | ---: | ---: |
| `solid.callable-fields` | 2 | 4 | 9 |
| `solid.descriptor-visibility` | 45 | 73 | 15 |
| `solid.live-getters` | 10 | 13 | 18 |
| `solid.native-parent-materialization` | 12 | 0 | 0 |
| `solid.reserved-fields` | 14 | 31 | 5 |
| `solid.row-materialization` | 76 | 55 | 46 |
| `solid.shared-graphs` | 2 | set aside | set aside |

The row store's column is the branch's row store as scanned before its last
edits. In the final scan `row-view.ts` has 136 mutants, 78 killed and 58 gaps
(29 survived, 8 crashed, 21 unreached); `useLiveQuery.ts` has 223, 29 killed
and 194 gaps (95, 27, 63 and 9).

**No kill was lost where the code is shared.** Mutants are paired by stable
key. On the adapter 125 pairs with the row store's scan: the 17 killed before
are killed now, none lost, none gained. Against `main`, 13 pairs: 6 killed on
both sides, none lost, 3 gained. Of the adapter's 194 gaps, 108 are the same
mutants that were gaps in the row store's scan; 86 are new or moved, 47 of
them in the rewritten publication loop and 20 in the body of the hook.

**Kills per law fell for three laws, because there is less code to kill.**
The materializer has 136 mutants against 287 on `main` and 270 in the row
store: the copying machinery that `descriptor-visibility`, `reserved-fields`
and `row-materialization` killed there does not exist. Of its own mutants the
row view has 57% killed by a law, against 48% on `main` and 60% for the row
store.

### The tool credits laws only

A mutant that an ordinary example rejects still counts as a gap here. So
that the report can be read, each gap was also applied to an isolated copy
and run against the example files.

**Of the row view's 58 gaps, 50 are rejected by examples.** Each was run
against `row-view.test.tsx` and `result-array.test.tsx`: 25 that the tool
calls survived, 18 unreached and 7 crashed fail there. Seven pass and are
equivalent changes: five make a read track even when nobody tracks it, which
allocates and changes no behaviour; one always uses the setter's updater
form; one returns `undefined` where `false` was returned, which a proxy trap
treats alike. One is a crash the report's text did not let us reconstruct.

**Of the adapter's 194 gaps, 105 are rejected by examples.** Eighty-one pass
them, 1 loops forever and 7 could not be reconstructed from the report. Of
the 86 new or moved gaps, 70 are rejected. The 81 are where the examples do
not read: 52 in the body of the hook, among them its status flags, error
paths and `loaded` gate, which other ordinary test files cover; and hints of
the publication loop that change only its speed, such as its still-aligned
flag.

The sites that only examples reach are three: an Array as the row itself,
`in` on a root row view, and the read-only view. To close them by the tool's
count needs laws for those sites, or a maintainer's allowance.

### The tool cannot baseline `solid.shared-graphs` on this host

The harness's capture renders every value a test asserts on, which enumerates
it. The graph nodes this law asserts on are its own counting proxies, which the
row view serves by reference, so the capture's enumerations count against the
law's budget: 508 of a budget of 288 at shared depth 8, where a plain Vitest
run passes. The property was therefore set aside, locally and uncommitted, for
the scan above, and its mutants are unclassified by the tool.

### A nested copy and a nested reference are not told apart

No law of this owner distinguishes them: the branch's row store, which copied
every admitted container, and this row view, which serves the Collection's
container itself, both pass every law. The view follows the sibling adapters
and costs less; that is a design decision, not a law. A law for one design or
an allowance for the other is a maintainer decision.

## Independent reviews

Two reviews ran on isolated copies of the candidate before the last three
repairs, each told the design and the verified facts about the host.

The correctness review reported four findings, each with a failing probe. The
keyed view inert in tests, the untracked enumeration of the array and the
re-entrant update are repaired above. The fourth is the two limits stated
above: confirmed, unreachable through the hook, and now stated in the source.
It cleared, with probes, the order-tracking loop under insert, delete, reorder,
a replaced Collection, a single result and a disabled query; two readers of one
field across the first one's disposal; symbol and numeric keys; frozen rows;
and a row view held after its row left.

The performance review reproduced the shape of the cost on a more loaded
machine: the adapter's overhead over Solid's floor was 22 to 38 ms at 10,000
rows, its share of a publication at most about 1 ms with Core and the DOM
dominating, and retention bounded at 363 bytes per field signal with a flat
heap across 240,000 rows of churn. It tried two further optimisations: one
had no measurable effect, and one saves about 0.17 ms per 10,000 rows at a
cost in legibility, so neither was taken. It proved no correctness defect.

## Size and cost

Against `main`, for the whole migration, production bundle with dependencies
external: 261 fewer gzip bytes (9.8%) and 245 fewer Brotli bytes.
`row-view.js` is 2,029 minified bytes where the row store's
`store-materialization.js` was 3,359; the adapter's own module grew by 250.
Naming the traps so that the laws own them cost 37 gzip bytes.

Three adapters ran in one process, interleaved in a rotating order, twenty
counted rounds after a warm-up, each mounted the way its synchronous path
allows: React through `flushSync`, Solid and Vue synchronously, each followed
by its own settle. Every framework got its own Collection with the same rows
and rendered one `div` per row from two fields. Each row's text was checked
after every publication. The build each framework loaded was read from a stack
trace inside it. The machine is a 16-core Linux box under Node 24, shared with
other work during these runs, so the minimum is the figure to read. All
figures are min / median in milliseconds.

**Production builds** (`@solidjs/signals/dist/prod`, `react-dom-client.production`):

| | row store | row view | React 19.3 | Vue 3.5 |
| --- | ---: | ---: | ---: | ---: |
| mount 1,000 | 13.71 / 15.97 | 9.88 / 10.54 | 8.76 / 9.27 | 25.63 / 29.02 |
| adapter cost above the framework's floor, per row | 5.66 µs | 1.83 µs | 0.56 µs | 2.41 µs |
| mount 10,000 | 174.97 / 184.04 | 115.34 / 124.53 | 96.94 / 111.89 | 1667.70 / 1823.33 |
| adapter cost above the framework's floor, per row | 8.10 µs | 2.14 µs | 0.55 µs | 6.83 µs |
| update 1 of 1,000 | 0.88 / 1.20 | 0.54 / 0.72 | 1.35 / 1.58 | 1.02 / 1.23 |
| update 100 of 1,000 | 1.43 / 2.21 | 0.85 / 1.15 | 1.36 / 1.68 | 1.93 / 2.24 |
| update 1 of 10,000 | 7.99 / 11.29 | 3.82 / 4.85 | 12.80 / 17.00 | 11.89 / 13.95 |
| update 1,000 of 10,000 | 20.91 / 24.70 | 9.70 / 13.51 | 17.88 / 22.18 | 27.49 / 32.22 |

The floor is the same list rendered from a plain array with no live query. In
production Solid's floor equals React's: 8.05 against 8.20 ms for 1,000 rows
and 93.97 against 91.48 ms for 10,000. So the whole difference at mount is the
adapters': React's does nothing per row, and the row view costs 2.14 µs a row
against the row store's 8.10. Mounting 10,000 rows takes the row view 1.19
times React's time in this run and from 1.11 to 1.17 in three earlier runs of
the same design; the row store took 1.81 here and 1.65 in an earlier run. On
every update the row view is the fastest: 1.6 to 3.4 times faster than React
and 1.6 to 2.2 times faster than the row store.

**Development builds** (`@solidjs/signals/dist/dev-shared`, `react-dom-client.development`):

| | row store | row view | React 19.3 | Vue 3.5 |
| --- | ---: | ---: | ---: | ---: |
| mount 1,000 | 15.16 / 15.79 | 10.82 / 11.62 | 29.95 / 31.25 | 36.85 / 43.94 |
| mount 10,000 | 195.30 / 207.50 | 131.29 / 136.92 | 202.83 / 214.32 | 1797.13 / 1922.74 |
| update 1 of 1,000 | 0.94 / 1.17 | 0.58 / 0.69 | 19.51 / 20.28 | 1.19 / 1.50 |
| update 100 of 1,000 | 1.72 / 1.91 | 0.89 / 1.09 | 19.73 / 21.57 | 2.22 / 2.93 |
| update 1 of 10,000 | 7.47 / 8.96 | 3.69 / 4.48 | 72.38 / 83.18 | 13.08 / 15.43 |
| update 1,000 of 10,000 | 22.00 / 29.18 | 11.69 / 14.36 | 77.41 / 86.33 | 31.62 / 44.27 |

Development builds are not comparable across frameworks: React's does far
more work in development than in production, and its floor here is three
times Solid's.

**Why the array is not a store.** Before the redesign each mechanism was
added to the one above it, 10,000 rows rendered through `<For>`, production,
minimum of twenty interleaved rounds:

| Stage | Added per row |
| --- | ---: |
| a plain proxy per row | 0.06 µs |
| a signal per field, made on first tracked read | 0.57 µs |
| `markRaw` per row | 0.36 µs |
| held in a Solid store array | 0.50 µs |
| a keyed map entry per row | 0.10 µs |

The result array of a Solid store costs a raw mark and a store slot per row
before any field is read. One signal for the array removes both. What is left
per row is one object, one proxy and a signal per field read; the signals are
the reactivity itself, and the update figures are what they pay back.

Svelte 5.57 was measured apart, in its own package with its compiler, on the
same scenario: in production it mounted 1,000 rows in 47.9 ms and 10,000 in
2,212 ms, and updated one row of 1,000 in 7.3 ms. In a three-row probe every
row's reactive text was re-evaluated on each publication of one row. That is
an observation about that adapter, outside this change.

## Example

The todo example was driven in a real browser against a Postgres-backed API,
Electric and TrailBase on the reviewed sources: reveal, add two, toggle,
delete, and client navigation away and back on each route; a config row's
colour change reaching the screen and changing back; and rows shown at once on
return. No page errors. The console carried one message, Electric's own
advisory about HTTP, which the row store's run carried too.

## ORC-001 through ORC-016 disposition

| Requirement | Disposition and evidence |
| --- | --- |
| ORC-001 Authority and limits | The owner's laws and limits are unchanged. The limits of the design and three open items are stated above, each named for a maintainer decision. |
| ORC-002 Independent judgment | The models are unchanged. The driver's port changed host calls only. |
| ORC-003 Literate responsibilities | Unchanged. The row view's header states what it keeps and why, with the host facts it rests on. |
| ORC-004 Grammar controls | Unchanged: the histories are enumerated and exhaust their dimensions. |
| ORC-005 Production path and observation | Three public inputs plus the direct helper, at the same cuts. Core publishes synchronously and the adapter lands a microtask later; a helper example reads a plain value at once and a reader's re-run after a flush. |
| ORC-006 Calibration | The hand-written mutants above are rejected at named assertions. The shared-graph checker calibration is unchanged. |
| ORC-007 Campaigns and direct replay | These are finite enumerated families; the five generated `framework.solid.*` properties print identical fixed-seed reach to `main` under the same build. |
| ORC-008 Stateful-model minimality | Not triggered: no reference state machine changed. |
| ORC-009 Vocabulary mapping | The production code and this record both say row view, publication and keyed view, as the glossary does. |
| ORC-010 Failure fidelity and cleanup | Unchanged helpers. The three rejected drafts and the three reviewed defects above distinguish a law's rejection from a crash. |
| ORC-011 Independent second formulation | Not triggered by a shared fault. |
| ORC-012 Review evidence | This record: fingerprints, RED, GREEN, mutants, the gap report, two independent reviews, size, cost and the limits stated above. |
| ORC-013 Distinguishing boundary witness | A signed zero against an ordinary scalar, a reserved name against an ordinary one, a hidden against a visible field, a fixed against a configurable field, and a copy against a reference (open, above). |
| ORC-014 Controlled-premise handoff | The real Solid host supplies signals, proxies and scheduling. The example run supplies a real browser and real backends. |
| ORC-015 Declared reach | Every history asserts its own reach, as before. `solid.shared-graphs` reaches its states in a plain run; the gap tool cannot baseline it here. |
| ORC-016 Law-only oracle files | The oracle file registers only through `oracleProperty`. The examples are in ordinary files. |

## Remaining work

- A maintainer decision on nested copies against references (above).
- The gap tool's capture against `solid.shared-graphs`, in the tool or in the
  law.
- Laws, or an allowance, for the three sites only examples reach: an Array as
  the row itself, `in` on a root row view, and the read-only view.
- For a materializer written anew, no mutant-by-mutant comparison with the
  row store exists; the survivors are listed in the report.
