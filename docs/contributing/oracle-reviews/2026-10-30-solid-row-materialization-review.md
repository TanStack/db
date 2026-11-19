# PR 2307: Solid materialization review

This record evaluates the ten-item external review of published commit
`1d619bb672b500099d05459927c10d21ba08fcb6`. The repaired code and executable
coverage are commit `bcbab51355b87a37fc9ab3c8c73887972be2fde8`.
Documentation-only commits can follow that code commit. This record supplements
the [earlier snapshot record](2026-10-30-solid-row-snapshot-isolation.md), whose
historical results remain intact.

The external reviewer executed Node probes with Solid 1.9.11 for findings F1
and F3. It did not execute the other findings or package suites. This evaluation
uses installed dependencies and the real framework test hosts.

## Law, experiment, and inference

Materialization borrows source Collection rows. It must preserve their values,
including retained `get()`, `previousValue`, and actual mutation `original`
references. Current consumers must follow current selected values. Authority:
[immutable updates](../../guides/mutations.md#update),
[PendingMutation.original](../../reference/interfaces/PendingMutation.md#original),
[ChangeMessage.previousValue](../../reference/interfaces/ChangeMessage.md#previousvalue),
and the [framework contract](../../../packages/db/tests/conformance/contract.ts).
Existing Solid fine-grained tests supply the unchanged-value identity promise.

The maintainer made two explicit decisions during this evaluation: preserve live
getters, and support shared acyclic graphs efficiently while deciding cycles
separately. Getter liveness applies when a getter actually reaches the adapter.
Core can evaluate a root getter before that boundary. The receiving histories
therefore exercise nested getters.

Two independent judgments cover these interacting laws:

- The shared [snapshot owner](../../../packages/db/tests/conformance/row-snapshot-oracle.ts)
  records admitted source facts before framework materialization. It compares
  current results and retained references with immutable trees of own keys and
  scalar or opaque leaves. Core supplies the premise. The adapter must preserve
  it. This owner does not prescribe Core draft normalization.
- The Solid [materialization owner](../../../packages/solid-db/tests/row-materialization-oracle.test.tsx)
  predicts consumer admissions from source identity, getter values from scalar
  signal versions, and array consumers from admitted scalar sequences. It also
  compares deterministic enumeration work with distinct admitted containers.
  It does not reproduce the materializer's cache or reconciliation algorithm.

The whole-review plan grouped source ownership, identity and lifetime, getter
liveness, and graph work before production edits. Required real-host paths ran
at the RED gate. Later independent findings received the same oracle-first
sequence before their repairs. The final suite then exposed one more array
notification defect. Its new grammar also ran RED before the production repair.

The repair keeps private graph copies and skips unchanged source rows. It reuses
copies of unchanged nested elements across edits and reorder. Native store reads
stay outside the binding's dependency set. Getter cells remain live and use
private result copies. Reconciliation separates conflicting aliases, prepares
replacement store wrappers once, and lets Solid setters admit array indices
before restoring descriptors. This preserves notifications without expanding
shared graphs by path count.

## Histories, receiving paths, and measured reach

The snapshot grammar crosses eight common shapes, one or two keys, three hook
inputs, and sync or optimistic writes. Shapes are ordinary records, hidden
string data, arrays, later object admission, null-prototype records, aliases,
accessors, and array subclasses. Solid adds actual native stores. Each key gets
three updates. Two-key starts share a nested source object. Odd alias splits
retain the actual previous right node while the left changes.

Every receiving group asserts exact reach counts:

| Receiving group | Histories | Each shape | Cross-row alias | Retained previous value | Retained original | Source reference reuse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Common driver, each input/sync | 16 | 2 | 8 | 16 | Not required | 2 |
| Common driver, each input/optimistic | 16 | 2 | 8 | 16 | 16 | Not required |
| Solid, each input/sync | 18 | 2 | 9 | 18 | Not required | 2 |
| Solid, each input/optimistic | 18 | 2 | 9 | 18 | 18 | Not required |
| Solid local-only, each input/sync | 18 | 2 | 9 | 18 | 18 | Not required |

Input, write, later admission, root omission, and nested own-undefined states
also reach every history in each group. The current and retained comparisons
run after each update. Optimistic histories also compare while the mutation
handler remains held. Local-only histories retain the returned transaction's
actual originals, independently of `get()` and event values.

All six real adapters receive the shared judgment. React runs both ordinary
and DbClient drivers. Common drivers run 96 histories each. Solid runs 108
shared histories plus 54 local-only histories. Together these are 738 receiving
histories across 45 registered group tests. Each group has its own reach guard.

The Solid-specific finite grammar has 85 histories:

| Law | Histories and declared reach |
| --- | --- |
| Identity and binding lifetime | 24 histories reach peer edit, same-row scalar edit, element replacement, and source-only write. Twelve have actual native-store payloads. |
| Reorder | 12 histories reach source reorder without admitting new elements. |
| Array resize | 12 histories reach growth, shrink, repeated growth, and emptying with reactive map and rendered `For` consumers. |
| Live getters | 24 histories reach initial or later getter admission, source replacement, signal-only writes, retained getter reads, omission, and readmission. |
| Shared graph work | 13 histories reach admission, replacement, and branch divergence. Three also reach crossed old/new sharing topology. |

Each Solid history has a separate asserted reach guard. Inputs cross callback,
config, and supplied Collection. Graph work uses supplied Collection input to
isolate the adapter from query hashing. Graph depths are 0, 1, 4, 8, and 12 for
linear and shared controls. Crossed sharing uses depths 4, 6, and 8.

## RED, GREEN, and hostile calibration

All commands use `--maxWorkers=2 --coverage.enabled=false`. The following
selectors reproduce the owning comparisons:

```sh
pnpm --filter @tanstack/solid-db exec vitest run tests/row-materialization-oracle.test.tsx --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/solid-db exec vitest run tests/conformance.test.tsx -t 'row-snapshot-isolation|local-only row snapshots' --maxWorkers=2 --coverage.enabled=false
pnpm --filter @tanstack/db exec vitest run tests/conformance/row-snapshot-calibration.test.ts --maxWorkers=2 --coverage.enabled=false
```

Before the first production edit, all six adapters passed the expanded snapshot
premise checks. Solid's extended identity, lifetime, reorder, and getter grammar
failed 34 of 48 cases. The initial graph extension failed 3 of 10 cases. A depth
12 shared graph caused 24,573 enumerations for 13 distinct source containers.

The old expected-source profile rejected a legitimate source that preserved
prototypes and removed omitted keys. The relational replacement accepted that
source without changing its law. A mutant corrupting only local mutation
originals passed all three old local-only groups and failed all three extended
groups at the `local mutation.original` comparison.

Independent review exposed getter omission, hidden string fields, and crossed
sharing. Before their repair, repository extensions failed 24 getter cases,
nine Solid snapshot groups, and two crossed graph work cases. The other five
adapters passed the hidden-field extension on unchanged production. A first
repair still failed crossed work because Solid recursively unwrapped raw
replacements. The final wrapper preparation pass removed that remaining work.

The final full-suite gate exposed stale rendered array membership: 210 tests
passed and the array include test failed. Twelve new resize histories then
failed on unchanged production. Letting setters admit indices repaired that
notification law. All 223 Solid tests now pass, including the actual include.

Temporary mutants were restored after execution:

| Wrong design | Executed outcome |
| --- | --- |
| Reviewed materializer at `1d619bb67` | 45 failures in the then-current 70-history owner. Identity, lifetime, getters, and graph work distinguish it. |
| Only a row-level source guard, without nested reuse | Identity/reorder assertions fail. |
| Tracked native source reads | Two supplied-Collection/native lifetime assertions fail. |
| Frozen enumerable getter values | Live getter assertions fail. |
| Getter result copies shared with ordinary data | Three retained-getter assertions fail when ordinary aliases diverge. |
| Persistent copy cache shared across rows | Old owner passes nine groups. Extended two-key owner fails nine groups. |
| Missing alias conflict separation | Nine snapshot groups fail current-value assertions. |
| Missing protected reused-node marking | Three controlled-sync groups fail: right value becomes 1 when its retained source value is 0. Six other groups pass. |
| Hidden fields omitted from reconciliation | Nine snapshot groups fail exact current values or own-key sets. |
| Missing replacement wrapper preparation | Crossed depth 8 fails: 140,316 enumerations exceed the unchanged 98,496 budget. Twelve graph controls pass. |
| Getter omission without writable conversion | All 24 getter cases throw after setup. This is a runtime failure, not an assertion kill. |
| Premature array-index definition | All 12 resize histories fail the current-membership comparison. |

An early attempted shared-getter transform changed no source and passed. It
receives no calibration credit. The later real getter-alias RED supplies that
evidence. Earlier selector mistakes and nonexistent test-file paths also
receive no coverage credit. Corrected commands executed the intended tests.

Final local verification at the code commit:

- Complete Solid package: 223 tests, nine files, no type errors.
- Other five adapters: 36 snapshot group tests pass, including React DbClient.
- Shared checker calibrations: 13 tests pass.
- Solid TypeScript check, ESLint on changed TypeScript, `pnpm lint:changed`,
  Prettier, `git diff --check`, and Solid build pass.

A consistent esbuild comparison bundles only the hook and its helper, with all
package dependencies external. The reviewed version is 3,988 minified bytes
and 1,797 gzip bytes. The repair is 6,825 and 2,714 bytes: +917 gzip bytes over
the reviewed cut. This is an isolated hook comparison, not the repository's
release-size scenario. The approved getter-cache simplification removes two
captured variables and saved 18 gzip bytes in its isolated helper comparison.

The earlier row-guard prototype benchmark measured materialization only. With
10,000 rows and eight tags per row, it measured 294.60 to 34.99 milliseconds.
It does not measure this final algorithm or total application performance.

## Lossless finding dispositions

IDs retain source order despite repeated numbers in the original review.
Locations below refer to the reviewed cut.

| ID | Original claim and proposed repair | Technical validity and PR action | Durable value and destination |
| --- | --- | --- | --- |
| F1, Solid 1, `useLiveQuery.ts:423` | Fresh copied nested-array elements make `reconcile(key:null)` replace identities, remount `For`, and rerun reference effects on unrelated updates. | Confirmed P1. `fixed-now`: per-row guard plus nested source-identity reuse, including reorder. A root-only cure fails the receiving oracle. | Missing source-identity dimension and actual consumer observations now live in the Solid owner. |
| F2, Solid 2, `:415` | Every event copies and reconciles every row. Remember each key's last immutable source reference. | Confirmed P2. `fixed-now`: unchanged sources return before copying or reconciliation. The main result iteration still scales with row count. | Single-row stream workload and bounded benchmark preserved above. No constant-time whole-hook claim. |
| F3, Solid 3, `:61` | Tracked native-store reads add payload dependencies to the main effect and later rebind the hook. Use `untrack` or `unwrap`. | Confirmed P1. `fixed-now`: untracked admission/update plus backing-store reads. Blind recursive unwrap of borrowed ordinary trees would itself mutate inputs. | Real native-store lifetime histories and tracked-read mutant. |
| F4, Solid 4, `:54` | Cycle memo adds bytes although cyclic updates overflow. Drop it or fail fast. | Partly confirmed. Initial cyclic admission works at the reviewed cut, but its first update overflows. Removing memo also makes admission overflow. `accepted-design` for this PR's explicit acyclic boundary, per maintainer choice. The efficient graph repair needs memoization for a different reason. | Cycle support remains a separate policy decision in the coverage map. No cyclic-update support claim or silent size cutoff. |
| F5, Solid 5, `:82` | Deleting ancestor entries expands shared acyclic graphs exponentially on every event. | Confirmed P1 at growing depth. `fixed-now`: one owned copy per source graph plus conflict-aware linear passes. Source reads grow from 16 to 65,536 over depths 4 to 16 in the reviewed helper. | Distinct-container work judgment, aligned/crossed sharing, and value checks in the Solid owner. |
| F6, Solid 6, `:74` | Enumerable signal-reading getters become frozen values. | Confirmed P2. `fixed-now` under the explicit live-getter decision. Private getter copies also protect retained source objects. | Nested scalar/object getters cross signal writes, source replacement, aliases, removal and readmission. Root getters evaluated by Core are outside this claim. |
| F7, Oracle 4, `row-snapshot-oracle.ts:95` | `draftSource` hardcodes own-undefined deletion and lost prototypes without authority. A Core fix would fail it. | Confirmed test-integrity defect. `fixed-now`: relational admitted-source facts replace expected Core normalization. The alternative legal source passes. | Explicit trusted base and calibration keep adapter preservation separate from Core policy. |
| F8, Oracle 5, `conformance.test.tsx:392` | Local-only histories never observe actual mutation originals, so original-only corruption passes. | Confirmed test gap. `fixed-now`: retain transaction receipts and compare originals throughout later updates. Old/new owner discriminator executed. | Actual local-only source path uses the same shared model and comparison. |
| F9, Oracle 6, `row-snapshot-oracle.ts:126` | One key misses cross-row shared defaults and accepts cross-row copy caching. | Confirmed test gap. `fixed-now`: one/two-key dimension with shared initial containers and alternating updates. Old owner accepts the cache mutant, extended owner rejects it. | Cross-row aliases and exact reach in every receiving group. |
| F10, Oracle 7, `conformance.test.tsx:372` | Virtual-field list and symbol filter duplicate `selectedRow`. | Virtual-field duplication confirmed. The claimed duplicate symbol filter was inaccurate: the old source driver did not contain that filter. `fixed-now`: both use `selectedRowKeys`. | One selected-value boundary, with hidden host symbols excluded by the existing contract. |

Additional findings remain distinct:

| ID | Source, gap, and disposition |
| --- | --- |
| S1 | Simplifier proposed removing redundant getter `lastSource` and `lastCopy`. Private WeakMap already handles repeat values. User approved. Applied and verified. `fixed-now`. |
| R1 | Independent reviewer found getter omission throws. Missing present-to-omitted transition. Added omission/readmission and shape observers before repair. `fixed-now`. |
| R2 | Independent reviewer found hidden string data stays stale. Added hidden update, own-undefined, and omission dimensions to the shared owner before repair. `fixed-now`. |
| R3 | Independent reviewer found crossed sharing creates old/new pair work. Added independently varying sharing topology and stronger enumeration recorder before repair. `fixed-now`. |
| R4 | Final package suite found array growth misses length notification. Added 12 real-host resize histories before repair, then killed the premature-admission mutant. `fixed-now`. |

Loss audit: **10 original items = nine fixed-now + one accepted-design**.
The accepted boundary is explicit and does not decide universal cycle support.
**Five additional items = five fixed-now.** No raw item, proposed cure, runtime
qualification, testing idea, or newly found sibling was dropped. No confirmed
in-scope counterexample remains in the declared finite boundary.

## Oracle conformance audit

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | Source snapshot authority and explicit live-getter/acyclic decisions appear above and beside executable laws. Limits remain explicit. |
| ORC-002 | Captured immutable source facts, scalar identity/getter inputs, admitted resize sequences, and distinct-container work are independent judgments. Core admission and selected-value metadata policy are declared trusted premises. |
| ORC-003 | Both owners explain contract, model, grammar, actual driver, and checkpoints beside executable code. |
| ORC-004 | Reconstruction includes cross-row aliases, later admissions, getter/data aliasing, omission/readmission, resizing, hidden fields, and crossed sharing. Removing an axis loses its corresponding mutant or receiving path. Bounds are listed above. Absent-key writes are illegal and excluded. Cycles are an explicitly separate decision. |
| ORC-005 | All six real hooks run at documented settled cuts. Solid also records actual `For`, effect, getter, and subscription observations. Source subscribers capture premises before materialization. No unresolved missing-input hypothesis arose at these cuts. |
| ORC-006 | The hostile table distinguishes assertion failures, post-setup runtime failures, and no-op or selection mistakes. |
| ORC-007 | Not applicable: these campaigns exhaust declared finite grammars. They introduce no random property or reduced run budget. Group selectors directly replay each input/write cell. |
| ORC-008 | Retained facts stay versioned because later writes can expose corruption of any earlier reference. Removed Core profiles impose no adapter obligation. Alias identity remains an input premise, not an output alias promise. |
| ORC-009 | Model facts represent selected Collection values. Consumer admissions and enumeration budgets are model-only observations, not new production lifecycle states. Shared glossary terms name binding, Collection, mutation, and checkpoint boundaries. |
| ORC-010 | `ScenarioLifetime` releases scopes, handlers, subscriptions, spies, and Collections. Existing cleanup calibrations preserve primary and distinct cleanup failures. Finite enumeration needs no shrinker. |
| ORC-011 | The named shared-fault hypothesis was expected Core normalization copied into the adapter model. Relational preservation replaces that dependency, and a legitimate alternate source is an executed discriminator. Other adapters supply corroboration, not independent Core policy proof. |
| ORC-012 | This versioned record names the exact code commit, every applicable requirement, closure boundary, and remaining limits. |
| ORC-013 | Unchanged/changed identities, same/different aliases, initial/later getters, present/omitted/readmitted fields, growing/shrinking arrays, and aligned/crossed graphs distinguish plausible narrow repairs. The work budget remains a bounded regression judgment. |
| ORC-014 | The same snapshot model/check receives six actual framework hosts and Solid's real local-only source. Native-store and getter premises use actual Solid APIs. No browser-engine or external-database claim follows. |
| ORC-015 | Each receiving group and Solid history asserts declared reach. Exact measured counts appear above. |
| ORC-016 | Owners contain reusable judgments and finite histories through shared drivers. Calibration examples remain in the ordinary calibration file. No standalone concrete type assertions were added to an oracle. |

## Reviewer assessment and readiness

**Hire recommendation: yes.** The external review found valuable correctness,
reactivity, work, and test-integrity issues beside green tests. It separated
runtime evidence from unexecuted analysis. Prioritization was mostly useful.
The cycle recommendation needed correction because memoization also preserves
initial admission and efficient acyclic sharing. Its proposed root guard alone
would not preserve nested identity. The duplicate symbol-filter claim was too
broad. Independent review later found missing omission, visibility, and topology
interactions, so the original ten items were not complete closure evidence.

The independent prep reviewer verified the three repairs it reported: 73 then
current materialization tests and three original hidden-field receiving cases
passed. The final resize finding came afterward and is covered by the additional
RED, GREEN, and mutant evidence above. No claim of an independent review of
that later repair follows.

Local enforcement is complete within the stated finite boundary. Whole-PR
readiness still depends on current CI and review of the pushed head. The older
published head has a separate Core publication mismatch, independently replayed
on clean main and recorded in [issue #2310](https://github.com/TanStack/db/issues/2310).
The maintainer requested separate tracking. This PR does not change Core
production, its publication model, expectations, or run budgets. A green retry
cannot close that known counterexample.

Limits: arbitrary cycles, deep recursion beyond the finite graphs, arbitrary
getter bodies or setters, hidden symbol fidelity, all descriptor-visibility
notification combinations, callback-time atomicity, other settlement schedules,
and real browser rendering are not established. Native Solid proxy assignment
through Core drafts remains a separate support-policy question. The coverage
map retains its owner and required receiving witness. No wall-clock SLO or
universal graph-complexity proof follows from the bounded counters.


## Subsequent oracle-review correction

A later four-agent review found that the React registrations described above
as ordinary and DbClient drivers actually execute the same derived-identity
API. Neither supplies DbClient receiving evidence. The former alias counts also
credited the later-object history whose initial config is null. It supplies no
mutable cross-row alias. These historical claims are inaccurate. The current
coverage map and [native revision record](2026-10-30-solid-native-store-review.md)
correct them and preserve the later findings. Earlier closure statements apply
only to their recorded comparisons and do not establish the newly expanded
root-field boundary, which has a known Core counterexample.

## Final native and Core correction, code `2e962b1797e69066de52344fad9ea71811bc843e`

The maintainer authorized fixing Core here. The pending-scope status above is
historical. The final native helper replaces custom recursive reconciliation,
and Core now preserves enumerable own source fields and accepted inherited-name
destinations. The final [native review](2026-10-30-solid-native-store-review.md)
records all new O1-O12 dispositions, valid RED/GREEN/mutant evidence, exact code,
and accepted limits. Both React registrations remain derived-identity paths,
with no DbClient credit. Core draft symbol-write policy and lifecycle #2310
retain their separate owners.
