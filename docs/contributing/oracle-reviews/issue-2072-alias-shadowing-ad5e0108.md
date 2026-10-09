# PR #2079: alias scope review at ad5e0108b

This audit evaluates the ten source-order claims in the external review of
`ad5e0108be85d221d4061a303da8fac47ce2d312`. The repair is a follow-up
diff on that head. The authority is `packages/db/src/query/live/ARCHITECTURE.md`
§Identity and law 1: aliases are lexical, captured references retain their
source, and compilation addresses Collection inputs by `SourceId`.
The primary executable owner is
`packages/db/tests/query/includes-alias-shadowing-oracle.test.ts`; the
generated scope campaign is `includes-oracle.property.test.ts`.

## Law, experiment, inference

| Law and authority | What the owner previously proved | Decisive experiment | Inference and repair |
| --- | --- | --- | --- |
| A captured source and a child source remain distinct under ancestor shadowing (§Identity, law 1; items 01–05). | Existing direct, QueryRef, union, grouping, and spread cases covered selected placements, but did not combine an inner FROM alias with a later outer join, merge a joined QueryRef's inherited parent context beside a same-named local child, combine two same-name spreads, spread a grandparent's whole row, or select a captured alias directly. | At the public live Collection row after preload, the original implementation returned zero rows for an eager self-join, lost the child's title in a joined include, dropped parent spread fields, and read a child's row for direct parent selection. Renamed controls distinguished name collisions from ordinary joins. An adjacent unmatched LEFT join read the parent ID as the missing joined ID. | The missing dimensions were sibling source placement, matched and unmatched joined sides, simultaneous spread keys, whole-alias depth, and direct alias selection. The repair resolves the lazy source by ID, retains the local row when joining inherited context and clears a missing joined alias, makes temporary spread keys unique, collects binding-bearing whole-row refs, and lowers direct alias selection to its expression. |
| A keyed lazy demand reaches the exact lexical Collection source (§Identity and law 12; item 06). | The prior finite demand cases covered direct and wrapped includes, but not the outer join's self-join target with an inner source of the same alias and Collection. | The eager self-join was RED at the first public row. Replacing exact source resolution with the old recursive alias search in a temporary hostile mutant made that same assertion fail; the renamed control passed. | Alias text selected the inner source before the outer joined source. The target now follows a binding-aware ref to a `SourceId`. Other lazy join topologies remain an owner gap. |
| An include cannot reuse one builder's source declaration across ancestor and descendant scopes (§Identity, law 1; item 10). | Existing direct, QueryRef, union, and nested-include rejection cells exercise this rule; sibling reuse remains legal. | The reported `new Query().from({ x: base })` still embeds `base` and its ancestor source declaration, so it must reject. | The guard is correct under the approved API rule. Error 233 now says to start the child from the Collection rather than pass the ancestor builder. |

The new finite model joins plain source rows by role and applies ordinary
object spread order. It does not use binding IDs, alias maps, compiler
metadata, or the optimizer to predict rows. The driver builds public `Query`
plans, preloads live Collections, and compares values and multiplicity at
initial publication and the named source writes. The self-join crosses eager
and controlled on-demand sync; the joined child and spread cases have a
renamed control. The direct alias case crosses shadowed and renamed children.
These are bounded witnesses, not a claim that every alias-scope path is closed.

The original implementation's public-row failures were captured before the
production edits in `/private/tmp/pr2079-selfjoin.log`,
`/private/tmp/pr2079-join-red2.log`, and
`/private/tmp/pr2079-red2.log`. The first merge repair still failed the
adjacent unmatched LEFT join's initial public-row comparison: `joinedId`
was 1 instead of undefined. Clearing the absent joined alias passed initial,
insertion, and deletion checkpoints. The source-ID hostile mutant failed the
eager self-join public-row assertion in
`/private/tmp/pr2079-alias-mutant.log`. The review's particular on-demand
self-join failure did not reproduce with the finite source adapter: the
on-demand cell passed before and after the repair. This does not refute a
different provider schedule.

## Lossless review ledger

The source review labels two items “7”; IDs 07 and 08 below preserve their
source order.

| ID | Claim and technical verdict | PR action | Durable value and destination |
| --- | --- | --- | --- |
| 01 | Inner FROM/outer JOIN alias reuse returns empty rows. **Confirmed** for the eager public path; the claimed on-demand failure was not reproduced with this controlled adapter. The flat alias maps are a plausible mechanism, but the demonstrated wrong target was recursive alias lookup. | **Fixed-now** for the reproduced topology using exact source resolution. No general alias-scope closure claim. | Self-join and renamed controls, eager/on-demand cells, source write: primary alias oracle. Other join-subquery and provider schedules: coverage map. |
| 02 | Joined parent context overwrites a same-name local child. **Confirmed** at the initial row; a renamed child passed. An unmatched LEFT join exposed the inverse error: the parent ID appeared as the absent joined ID. | **Fixed-now** by preserving local main-row aliases, adding the actual joined source, and clearing it when absent. | Child title after preload and update; missing/present/missing joined side: primary alias oracle. |
| 03 | Captured and local spread sentinels collide. **Confirmed** at the first child row; a renamed child passed. | **Fixed-now** using unique temporary keys and deterministic select-local rekeying. | Both fields after parent/child writes and repeated-build identity: primary alias oracle. |
| 04 | Grandchild whole-row spread loses a grandparent. **Confirmed** at the first public row. | **Fixed-now** by collecting binding-bearing single-segment external refs. | Grandparent row after preload and update: primary alias oracle. |
| 05 | Direct `.select(() => capturedParent)` reads the child. **Confirmed** under shadowing; renamed child returned missing data. | **Fixed-now** by retaining the captured expression under the spread sentinel. | Shadowed/renamed initial and post-write rows: primary alias oracle. |
| 06 | Lazy target search can choose the nested source by alias text. **Confirmed** as the wrong target behind 01's eager trace. The broad claim about all subscription shapes is unproved. | **Fixed-now** for this target path with binding-aware traversal and exact `SourceId`. | Primary alias oracle and lazy-target unit; other lazy topologies: coverage map. |
| 07 | A user-declared pure wrapper is retained and costs another stage. **Structurally true.** | **Accepted-design** for now: flattening its distinct binding would violate the approved identity rule; no binding-preserving flattening design is established. | The wrapper identity cell remains in the primary oracle. A future optimizer design must prove both identity and work. |
| 08 | Local refs perform parent-context metadata checks per row. **Confirmed** by the compiled closure and the earlier two-row/two-ref spy (four lookups); no elapsed-time or throughput conclusion follows. | **Design-decision:** whether a compile-time local/parent split earns its code and compatibility cost needs a work target. No correctness law is violated. | Performance opportunity in this record; `compiler/evaluators.ts` is the implementation owner. |
| 09 | Full-tree cache comparison and function-form misses. **Confirmed**: a temporary same-source work probe recorded two compiled entries for a shared structured child and three for the same child with `fnWhere` (including the outer query). The existing cache comparison test shows function-form plans return false. | **Design-decision:** whether to add an identity-safe function-form equivalence and how to bound comparison work. Reusing plans by path alone previously conflated lexical bindings. | Cache tests and `compiler/query-equivalence.ts`; preserve this work count before changing equivalence. |
| 10 | A fresh wrapper around an ancestor builder is rejected. **Refuted as a product bug** by the explicit ancestor/descendant source-declaration rule. The old error wording was misleading. | **Accepted-design** for the guard; **fixed-now** for error 233's instruction. | Existing rejection oracle and updated error fixture/docs. |

Items 07–09 are work observations. No elapsed-time contract was inferred from
them, and none justifies weakening source identity or cache equivalence.

## Oracle guide audit

- **ORC-001:** The architecture's lexical-binding and source-ID rules authorize
  the expected rows and demand target. The owner comments and this record bound
  the finite histories and excluded paths.
- **ORC-002:** Expected rows come from plain source-role joins and JavaScript
  spread order, independent of the compiler's alias and binding machinery.
- **ORC-003:** The executable owner states the law before mechanics and places
  the model, legal axes, public driver, and checkpoint explanations beside the
  tests. The new lazy-target unit is supporting code, not a second oracle.
- **ORC-004:** The new cells are a finite matrix, not a new generated property.
  The eager/on-demand and shadowed/renamed controls ablate source mode and
  alias collision. The source IDs, two-level and three-level nesting, and
  initial/post-write cuts bound range. Same-scope duplicate aliases remain
  invalid in the existing validation owner. The unchanged generated campaign
  retains its own reconstruction, ablation, range, and exclusion audit.
- **ORC-005:** `createLiveQueryCollection` and public `toArray` reach the
  claimed paths. Row comparisons preserve missing values and multiplicity;
  the lazy demand owner also compares provider requests.
- **ORC-006:** The original implementation failed the new first-row
  comparisons for 01–05. The alias-only hostile mutant failed 01's public-row
  assertion, not a setup or timeout gate. No mutant is claimed for every
  additional topology.
- **ORC-007:** The new cells are finite, so fixed/random campaign and replay
  obligations do not trigger for them. The existing generated owner still runs
  its fixed and random scope campaign.
- **ORC-008:** The new models recompute from plain Maps or fixed rows; they do
  not add a stateful reference machine.
- **ORC-009:** “Parent,” “child,” “manager,” and “joined source” denote source
  roles. Model rows do not encode production binding IDs or `SourceId`; those
  identify the production source implementing each role.
- **ORC-010:** `withHistoryCleanup` retains the primary mismatch and cleans
  live queries and Collections. The RED evidence is assertion failure at the
  stated row cut. The tests do not shrink histories.
- **ORC-011:** No named model/production shared semantic classifier remains:
  the role model never resolves aliases. Renamed-query controls add a separate
  metamorphic comparison, but do not replace the plain row model.
- **ORC-012:** This exact-head record provides each applicable outcome and the
  non-applicable trigger reasons. It claims bounded repairs, not closure of the
  entire alias-scope class.
- **ORC-013:** Shadowed and renamed controls distinguish lexical role from
  alias text; the alias-only mutant proves the public comparison detects the
  wrong boundary on the eager self-join. The on-demand schedule claim remains
  bounded to the controlled fixture.
- **ORC-014:** Controlled on-demand sources establish this adapter's preload
  and write cuts only. A real-provider receiving witness for the review's
  on-demand schedule remains with the alias-scope coverage owner.

## Remaining boundary

The covered contract × history × path × observation is lexical source identity
for the finite self-join, joined include, two-spread, grandchild spread, and
direct-alias selection histories at their public-row cuts, plus exact source-ID
lazy targeting for the eager self-join. The coverage map retains arbitrary
join-subquery topologies, deeper captured refs, RIGHT/FULL joins, temporal
demand, and real-provider scheduling. Flat alias-keyed metadata remains in the
compiler; the tested lazy path no longer relies on its alias-only target search.
This record does not claim that every remaining metadata consumer is safe.

The reviewer found five real public-row errors and a related source-target
error, with small distinguishing examples. That is high technical signal.
The broad attribution to flat alias maps was incomplete, the on-demand claim
was not reproduced in this fixture, and item 10's proposed guard removal
conflicts with the approved contract. The performance items correctly identify
work but do not establish a performance budget or safe replacement.

For reviewer quality, this is a **hire** recommendation: the review found
several distinct public failures that the existing suite missed and supplied
useful renamed controls. The reviewer should check approved API rules before
proposing guard removal, and use work counts rather than timing claims for
performance findings.

## Verification of the repair diff

- The bounded alias and lazy-target suite passed after the unmatched-join
  addition. The complete query runtime run passed 108 files and 4,490 tests
  with Vitest's integrated type check disabled; the separate TypeScript
  project check passed. The earlier integrated run passed 4,717 test
  assertions but could not write Vitest's temporary type-build file through a
  read-only dependency symlink. This is a tool-location failure, not an
  assertion failure.
- The production error-message oracle passed 19 tests. The generated
  error-doc check, ESLint, Prettier, and `git diff --check` passed.
- The final source simplification and unmatched-join fix were followed by the
  full query run above. The temporary cache work probe was removed; it is
  evidence of work, not a permanent performance law.
