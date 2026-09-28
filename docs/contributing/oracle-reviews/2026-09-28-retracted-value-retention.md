# Held publication retracted-value review

## Reviewed state and contract

Baseline: `33a194941c8d51f8f98babb999fef2987dd6ff8b`.
Reviewed change: the Git tree containing this record, the builder fix, and the
expanded includes publication oracle. The final commit identifies that tree.
The audit source is DEC-02 in
`scripts/code-weight/BUGS_AND_ORACLE_GAPS.md` in the local code-weight audit
worktree. PR #1917 covers other optimizer and IR-shaped-value findings.

The maintainer chose the last subscriber-visible value and position as the
comparison baseline for a held publication. The authority is the coherent
publication and atomic ordered-window contract in
`packages/db/src/query/live/ARCHITECTURE.md`. The primary executable owner is
`packages/db/tests/query/includes-publication-oracle.test.ts`. Effect callbacks
use the same held source history. Their update event's `previousValue` is also
specified by `packages/db/src/query/effect.ts` and the existing
`packages/db/tests/effect.test.ts` multi-step update case.

## RED, fix, GREEN, and limits

The oracle starts with two public parent rows in rank order `[1,2]` and one
inline child for row 1. An ordered repair holds publication while the source
writes row 1 with rank 2.5 and values `A → B → A`. The final public order is
`[2,1]`; the payload returns to `A`. On the baseline, the subscriber receives
no callback. The new exact test failed at the final callback comparison:
expected one layout-only callback with the final rows, actual `[]`. Its
single-step `A → A` reorder and `A → B → C` value-change controls passed in
the same RED run (1 failed, 2 passed, process exit 1).

The builder had retained the last retracted value and position, `B` at the
new position. It now retains the first pair, `A` at the old position, in the
same existing accumulator. No new lifecycle state was added. The same three
tests passed after the change (3 passed, process exit 0). The complete includes
publication file passed 63 tests; the complete Effect file passed 74 tests.
The production diff in the builder is net zero lines. The architecture states
the decided rule.

The Effect side of the new oracle observes no value callback for `A → B → A`
and one update from `A` to `C` for `A → B → C`. A hostile combined Effect
design that retained the last private retraction and used it instead of the
callback-visible row failed at those callback assertions: it emitted a false
`B → A` update and reported `B` as the previous value for `C`. These were
assertion failures at the intended checkpoint. Changing `deleteValue ??=` to
assignment *alone* survived the existing one-transaction Effect test and a
separate two-source join probe. Those paths emitted only one relevant
retraction. The compound mutant proves the public-state rule; it does not
prove that each internal branch is independently necessary.

This claim covers the bounded in-memory ordered repair with two parent rows,
one inline child, three source writes, root Collection reads and subscriber
callbacks, and an ordered Effect's callbacks. It does not prove every ordered
repair schedule, Collection-valued child facade layout, or concurrent
optimistic overlay. The coverage map names the receiving owners and witnesses.
No reachable counterexample remains in the tested grammar.

## ORC-001 through ORC-011

| Requirement | Outcome | Evidence |
| --- | --- | --- |
| ORC-001 authority and limits | Pass | The architecture now states the last subscriber-visible comparison rule. The oracle header, this record, and the coverage map bound the claim. |
| ORC-002 independent judgment | Pass | A plain source-row Map sorts by rank and derives child IDs. It does not inspect D2 output or call the builder's order detector. Effect event expectations follow initial and final values. |
| ORC-003 distinguishable responsibilities | Pass | The held-publication block states the law and bounded grammar, defines the Map recomputation, drives real Collections and an Effect, and checks reads and callback observations before and after release. |
| ORC-004 generated grammar controls | Not applicable | The added cases are a bounded three-cell matrix, not a generated-history claim. The existing generated properties in the same file are unchanged. |
| ORC-005 production path and observation | Pass | A real on-demand ordered source holds `loadSubset` while three sync transactions reach a compiled include query. The test asserts that a hold exists, no intermediate callback appears, public rows remain old during the hold, and final callbacks match the model. |
| ORC-006 checker calibration | Pass | The unchanged builder failed the final subscriber assertion. A last-private-retraction Effect design failed its callback assertions. The single-step and final-value controls distinguish an always-quiet result from the intended repair. |
| ORC-007 fixed/random replay | Not applicable | This change adds deterministic bounded cells, not an important generated property. Existing generated campaigns and replay wiring remain unchanged. |
| ORC-008 model-state minimality | Not applicable | The model is a plain current source-row Map. It introduces no new stateful reference lifecycle or state merge. |
| ORC-009 vocabulary mapping | Pass | The model Map represents source rows only. It does not claim to represent acquisitions, private D2 relation rows, or publication state. “Held repair” is the adapter's pending ordered acquisition; “public snapshot” is the last subscriber-visible Collection state. |
| ORC-010 failure fidelity and cleanup | Pass | `withHistoryCleanup` releases every held request and disposes the Effect and Collections. It preserves the primary assertion separately from cleanup errors. No shrinker or serializer rewrites the failing history. |
| ORC-011 independent second formulation | Not applicable | The named fault is last-versus-first retraction retention. The sorted source Map and observed public callbacks already distinguish it. No different query formulation is needed to adjudicate this bounded rule. |

ORC-012 is this versioned, baseline-identified record and its coverage-map
link. The final commit and PR identify the immutable reviewed change.

## Review finding audit

The DEC-02 review made four distinct claims or proposals. The task-local
ledger preserves their original wording, source order, and probe details.

| ID | Final disposition | Evidence and durable destination |
| --- | --- | --- |
| DEC02-01 | Fixed now | The baseline's last-retraction rule lost the layout callback in the held `A → B → A` case. The builder now retains the first retraction. The publication oracle checks the resulting callback. |
| DEC02-02 | Already fixed | Effect already keeps the first retracted value. The new Effect callback checks observe the final value against the last callback-visible value. The separate assignment mutant survived, so the record does not claim that this line alone is calibrated. |
| DEC02-03 | Deferred | The facade map uses `serializeValue` for key identity, but its accumulator does not retain a prior value or position. A facade-held reorder needs its own witness in `includes-collection-oracle.property.test.ts`, as the coverage map now states. |
| DEC02-04 | Fixed now | The maintainer chose the last subscriber-visible comparison rule. The held three-write history was RED on the baseline and GREEN after the builder repair. The architecture now states the rule. |

Loss audit: four raw items equal two fixed now, one already fixed, and one
deferred. No item lacks a disposition. The facade witness remains outside this
PR's bounded root Collection claim.

The reviewer identified a real difference between the builder and Effect and
proposed the right multi-step history. The review marked the builder bug as
tentative and did not specify a public failure or an authority for the rule.
Its technical accuracy and signal were high, while its proof depth was
limited. I would hire this reviewer for code review with an expectation that
behavioral findings include a failing public observation.

A separate PR review found that the new Collection callback check initially
kept only each change type and key. A stale update payload could have passed
that check. The oracle now also asserts that the `A → B → C` update reports
`previousValue: A` and `value: C`. The two focused suites passed 137 tests
after this review fix. Changed-file ESLint and formatting checks passed.
