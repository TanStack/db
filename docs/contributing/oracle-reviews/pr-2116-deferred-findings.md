# PR #2116: earlier findings and guarantee decisions

This record separates findings discovered during the unit-test retirement
workflow from the bounded fixes retained in PR #2116. The transfer ledgers
remain the authority for retired assertions. The
[confirmed-fixes review](pr-2116-confirmed-fixes.md) records the baseline and
hostile evidence for fixes that this PR now keeps. A finding below is not
closed by passing a neighboring transfer oracle.

| Finding | Authority and evidence | Next owner and witness |
| --- | --- | --- |
| R29: two valid `Temporal.Duration` values can have the same display text but different fields. A changed field can be suppressed as an equal Collection value. | Closed in this PR for the tested direct and Collection paths. The Duration field model checks all ten fields; a same-display replacement and adjacent-unit histories make the former `deepEquals` and change-event behavior fail before the repair. The query equality owner and `in` evaluator owner separately check Duration field identity. | General multirow and live-query publication histories remain outside these owners. Add them to the relevant owner if a new failure reaches those paths. |
| R16: an indexed Collection can admit a valid Temporal row whose index comparator has no public order, then throw after partial state changes. | Earlier PR revisions recorded RED admission and publication traces for Duration, PlainMonthDay, and mixed-kind rows. A paired probe on `origin/main` `bbbf017ef5` and PR head `0c10ae8e8` found no failure: 190 valid Temporal pairs per index type and revision passed direct insertion; 24 two-row sync and optimistic Collection histories retained both public rows, exact memberships, ordered storage, ready status, and both insert publications at the second write return. The earlier RED traces establish an intermediate-branch failure, not a current-base or current-head defect. Public query comparison errors remain separate from internal index storage order. | No admission repair follows from this evidence. If a valid current-head admission history fails, extend the direct-index and Collection publication owners with exact membership, ordered storage, stored rows, and subscriber observations before changing production. The probe does not cover all valid Temporal values, native-host implementations, updates, builds, or longer histories. |
| Mixed-kind indexed order and custom-index query selection may disagree with public query results. | The source-Map owner closes the mixed number/string direct-index key loss. The new scan-versus-index owner rejected the frozen PR's wrong mixed-kind public prefixes, and the current guard makes the tested eager paths use the query's order. A retained on-demand BTree history checks visible prefixes after a number/bigint transition, a missing-row finite request, and a later cursor request that still traverses the index; all settled public windows match independently sorted provider rows. A reverse manual index produced a wrong direct prefix on an earlier branch revision; the current three-rank owner checks direct, eager, and prepopulated on-demand public results. The reviewer withdrew its claimed live-query failure after fixing a cross-checkout `@tanstack/db-ivm` resolution error. The maintainer withdrew a per-row custom callback position guarantee for comparator-equal exact values. | Other retained on-demand paging sequences, different incomplete-source patterns, and later live updates need public-result witnesses. The owners do not define a universal precedence among unlike kinds. |
| Indexed ordering can suppress a required Temporal comparison error. | Changelog #1519 requires `TypeError` for mixed or unordered Temporal values. On clean `origin/main`, indexed direct reads returned rows for `PlainDate` beside `PlainDateTime` and for two distinct `PlainMonthDay` values while the scan threw. The new Temporal exception lane fails on those four baseline indexed reads and passes on this branch; eager live queries already threw on main. | The bounded direct-read repair is complete for these pairs. On-demand acquisition, later updates, and other mixed Temporal pairs need separate witnesses before claiming the whole exception class. |
| R17: an equal-time Date removal left an ordered ghost under added index machinery. | The recorded RED trace depended on code introduced during this PR. It does not establish an `origin/main` defect. The stronger rule for a substituted old row with a different callback position was withdrawn. | If ordinary direct remove/update still has a current-base counterexample, add a source-Map history to the direct-index owner before changing production. |
| PlainDate extended-year order under lexical string collation can diverge between scans and indexes. | On `origin/main`, a ready scan returns `-100000-01-01` first while BasicIndex and BTreeIndex direct public reads return `+010000-01-01`. The new Temporal owner checks calendar order from the supplied years and fails on those two baseline direct reads. Both direct indexed reads pass on this branch. Baseline eager live queries already returned the right first row. | The fixed ready-source direct-read history is closed. Other extended-year pairs, later updates, and on-demand publication remain outside the current witness. |
| Cross-realm native equality was asserted by a surviving request-transport unit test. | PR #1797 captured the then-current `instanceof` result. No public realm-distinctness promise was found. The maintainer questioned that distinction. This PR removes that incidental test expectation and makes no cross-realm equality claim. | A future public contract decision needs a host-boundary witness before either equality policy becomes an oracle law. |

The 2026-10-13 review expanded the custom-index owner to three ranks and a
two-row window. The reported `[20,30]` public result came from a scratch test
that resolved `@tanstack/db-ivm` from another checkout; with the correct
package, both frozen PR head `16b219224` and `origin/main` returned `[10,20]`
at the reviewer's read checkpoints. The reviewer withdrew that finding. A
separate paged-provider witness now reaches a retained
on-demand mixed-kind index after its domain changes. It checks public rows
after a finite request fills a missing prefix row and after a later cursor
request traverses the retained index. Wrong-provider controls that withhold
either requested row fail the public comparison. Other provider histories
remain untested; this witness does not establish general safe traversal of an
ineligible retained index.

Captured `inArray` list-entry refresh and whole-live-query reconstruction were
explored as new features. The pre-PR evaluator and live graph did not already
deliver the whole-result behavior. The maintainer withdrew that expansion for
this PR because of its production-code and query-planning cost. A separate
proposal must define its dependency and invalidation boundary before adding
an oracle or production graph machinery. In-place edits to a Date or byte
item, unsigned default byte ordering, and guarantees after callers alter
standard objects are also outside the accepted contract.

Earlier experiments and RED/GREEN records remain in published commits on
`codex/oracle-test-retirement-2-blocks`. This PR restores the confirmed,
bounded fixes described above. The R16 and R17 rows still distinguish
earlier-branch observations from a current-base failure; neither justifies
new production machinery without a baseline witness under the accepted law.
