# Native PowerSync active predicate union

The native adapter narrowed an unrestricted demand when a filtered demand
joined it. A missing `where` passed into `or()` became a literal SQL `NULL`,
so tracking used `NULL OR predicate`. A persisted ordered demand with a
rank-boundary sibling consequently kept `saved-1` while accepting `online-2`.
Both actual SDK demands were active and fulfilled without cancellation.
The provider read and diff trigger omitted the first row; persistence did
not discard an already delivered source update.

The existing overlapping-demand example used only concrete predicates. Its
separate absent-predicate case had one owner. Neither combined unrestricted
support with a filtered sibling and then changed a value outside that filter.
The hook oracle explicitly excludes concurrent owners; eager replacement and
persisted-demand readiness judge different boundaries. The new owner supplies
the missing concurrent predicate-union judgment.

## Law and authority

The PowerSync guide's **On-Demand Mode** and **On-Demand Mode with Sync
Streams** promise rows satisfying any active query predicate. An absent
predicate therefore supports every row. A finite demand limit does not
narrow the native adapter's predicate support; individual live-query window
membership is a separate observation.

The independent owner is
[`demand-union-oracle.ts`](../../../packages/powersync-db-collection/tests/demand-union-oracle.ts).
It recomputes support using literal integer membership, without production IR,
SQL, trigger logic or demand classifications. Its complete cut schedule comes
from authored histories. The receiving production driver uses actual SDK
SQLite and public direct Collection subset subscriptions.

When a third owner retires while unrestricted support survives, the union
before and after retirement is identical. The provider performs no write in
that interval. Every source publication must retain those complete rows;
unchanged state may produce zero callbacks. This law does not require atomic
publication for a retirement that actually narrows the supported union.

## Oracle-first evidence

The immutable [pre-edit evidence](2026-11-17-native-demand-union-pre-edit-evidence.json)
records source `7781cf0834530b48cd7be9db052261964866bf92a6a44adb2c15fe0aa6e282de`,
model `77f76c8e…`, production driver `2a1afd60…`, and suite `679f8246…`.
Independent enforcement approved this gate before the production edit.

- **Reach:** each host's fixed-seed and random campaigns ran sixteen
  original constructed histories. Every one of the eight then-declared states
  reached at least twice. Original generated reach observations are retained
  separately from reduced failures; successful-unit reach completes the
  counts where Vitest suppresses successful console output.
- **RED:** actual Node and Chromium each reported 38 failures and 34 passes.
  Twenty-five failures were intended source-row comparisons. Thirteen bound
  calibrations had an already failing clean baseline and earn no calibration
  credit in this RED run. There were no setup failures or timeouts.
- **Replay:** the recorded seed and shrink path select one requested history
  directly. The first differing cut belongs to the violation's law identity,
  so framework shrinking preserves `acquired all` versus `changed values 1`.
  Independent broad-last replay failed at `acquired all`.
- **Repair:** source `80ce907bea803b76cb5270071aff48636122e58cb6b758ff9744dbf1a927cb55`
  imports `IR` and maps an absent predicate to `new IR.Value(true)`.
  Both union consumers remain structurally unchanged. Explicit expressions
  containing null or undefined remain distinct from an absent predicate.
- **GREEN:** the original approved instrument passed all 72 checks per host.
  An independent unchanged shared persisted-demand receiver passed 30 checks
  per host, including the saved-row/changed-value history and its now-valid
  calibration. All thirteen shared declared states were reached.

## Closing the retirement observation gap

A release-only mutant dropped unrestricted support only while computing
eviction. The original settled observation passed all 72 checks per host:
the rebuild restored a row that an earlier publication had deleted. This was
an instrument survivor, not an equivalent implementation or an allowed limit.

The production source stayed unchanged. The oracle then added an
observation-only source subscription, starting before third-owner release and
ending after actual trigger rebuild and SQLite lock drain. Every copied public
snapshot is compared with the unchanged independently modeled union. A bound
calibration injects a row-loss publication even when correct production emits
none. The ninth declared state records the actual observed retirement window.

Correct production first passed **81/81 Node and 81/81 Chromium** with this
amendment. The isolated release-only mutant then failed **17 semantic
comparisons per host** at `third retirement publication`. Seven other failures
per host were invalid clean calibration baselines, reported separately. One
recorded callback omits `row-2`; the next restores all five rows. The settled
cuts match, showing exactly why the earlier instrument missed the violation.
Independent enforcement reproduced this publication failure and restored
canonical-source GREEN.

The final [evidence manifest](2026-11-18-native-demand-union-final-evidence.json)
records exact final instrument hashes, source transforms, logs, commands,
campaign reach and the independent receiving evidence. Each final campaign
has eighteen fresh constructed histories plus eight generated histories.
All nine states reach at least twice on each host and campaign. Both builders
for every state have missing-state controls. The final instrument also rejects
the original mapper fault through its shared fixed history on each host.

Restoring only the exact old release expression is a separate result:
**81/81 per host remain GREEN**. With universal remaining support,
`departing AND NOT(NULL OR P)` selects no eviction rows, as
`departing AND NOT(TRUE)` does. This is equivalence of the tested eviction
effect, not of three-valued expressions in general. It supplies no equivalence
claim for positive tracking, where the original expression demonstrably loses
rows and values.

## Guide outcomes and limits

| Requirement | Evidence |
| --- | --- |
| ORC-001 authority | Public native on-demand predicate-support guide; source and live-query-window roles distinguished above. |
| ORC-002 independence | Integer-set membership and authored full cut schedule; no production semantic helpers in expected results. |
| ORC-003 literate responsibilities | Owner prose, model, grammar, receiving production driver and shared suite remain directly linked and distinguishable. |
| ORC-004 grammar controls | Acquisition order distinguishes broad joins; overlap distinguishes shared support; fixed-id values reject membership-only checks; limited demand preserves universal predicate support. Integer pivot spans -4 through 4, with below/equal/above and outside-sentinel rows. Unique scope acquisition and legal retirement exclude release-before-acquisition. The fixed regression reconstructs the original composition. |
| ORC-005 path and cuts | Installed Node/browser SDK SQLite; actual raw unrestricted predicate/limit forwarding, load settlement, callback completion, trigger rebuild, lock drains and source callback snapshots. No expected-row polling or fixture replacement writes. |
| ORC-006 sensitivity | Original mapper and release-only narrowing produce semantic failures at named cuts; injected stale values, row-loss publications and missing states fail bound controls. Exact-old release equivalence is classified separately. |
| ORC-007 campaigns/replay | Same fixed seed 2377 and random campaigns, generators, receiving production driver, comparison and budget. Checked seed/path/unit replay selects only the requested history. |
| ORC-008 minimality | Active scope identity distinguishes a surviving sibling from retiring support. Provider revision distinguishes unchanged keys with fresh values. The model retains no production queues or trigger revisions. |
| ORC-009 vocabulary | Predicate support abstracts source membership; source rows are distinct from finite live-query window membership. Retirement window names an observation boundary, not a new product lifecycle. |
| ORC-010 fidelity | First differing cut participates in the failure law, preserving it during shrinking. Native receiving cleanup retains the completed observation and separate cleanup diagnostics. Original construction reach and reduced histories are separate evidence. |
| ORC-011 second formulation | No unresolved shared semantic machinery hypothesis: literal set membership is structurally different from SQL/IR union. No second model is claimed. |
| ORC-012 review record | This record and exact manifests retain pre-edit approval, amendment chronology, independent reproductions and bounded results. |
| ORC-013 distinguishing boundaries | Universal-plus-filtered versus filtered-only sentinel; disjoint versus overlapping surviving support; inclusive pivot and adjacent rows; third-owner retirement versus broad-owner retirement. |
| ORC-014 receiving handoff | Both installed SDK hosts run the same law/model/grammar/comparison. The separate unchanged persistence owner receives the original interaction independently. No deployed-service claim follows. |
| ORC-015 reach | Nine final states, two fresh constructed builders each, both-builder missing-state controls and explicit per-host campaign counts in the final manifest. |
| ORC-016 law-only files | Registrations use `oracleProperty`; the fixed regression and calibrations share the model, receiving production driver and comparison. |

The generated source has fixed rank membership and same-key value changes.
This evidence does not cover inserts, deletes, predicate-membership changes,
arbitrary predicates, remote transport, persistence readiness, reload, pending
hooks, optimistic holds or intermediate publications while only filtered
support survives. The coverage map assigns this bounded judgment to the new
native union owner. No production behavior beyond predicate normalization
changed while closing the publication gap.

Final native neighbor validation passed **1,684/1,684 checks across all nine
registered package oracle files**, with no type errors. The existing ordinary
on-demand suite passed **74/74**. Package TypeScript, scoped ESLint,
`pnpm lint:changed` and scoped `git diff --check` passed. These are fresh Node
neighbor results; no fresh complete browser-neighbor run is claimed beyond
the exact receiving runs recorded above.

Independent secondary law and information review approved source `80ce907b…`,
model `73c14242…`, production driver `798703e5…` and suite `d70bed25…`.
It confirmed the unrestricted-demand forwarding premise and publication
window. The primary enforcement review independently reproduced the mutant's
transient row loss and the restored canonical GREEN.
