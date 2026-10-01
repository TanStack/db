# PR 1977 residual-convergence oracle review

The reviewed baseline is origin/main at
`18abceee48ebde712e120cbc541289bb83f35d77`. The contributor's supplied
patch corresponds to proposed head `e6a1e2924d4acb5bb41b0478df1bbbe7171498a9`.
The reviewed candidate is that baseline plus the uncommitted changes whose
optimizer file has SHA-256
`fee8078ebdfc40d9a431a7c48f7061dd1afbc0f7383a95a13f7d87507248bfc3`
and oracle file has SHA-256
`bd5b06605814d3f1c190455438974f9112a53219930ec7d8b92673917d3dc56c`.
The separate task-local external-feedback ledger preserves all 13 PR and bot
items; this record preserves the oracle and repair evidence.

## Contract and checked boundary

The optimizer's predicate-pushdown contract permits a predicate on a
nonnullable outer-join source to enter that source. The joined row still needs
the predicate, so its outer copy is residual and must not be pushed again.
A predicate on a nullable source stays regular. One logical predicate should
enter each eligible source once, including when optimization runs again.
The public-row contract requires the same result as applying predicates after
the join. These rules follow the optimizer's documented pushdown behavior and
the established outer-join tests.

The finite structural grammar crosses LEFT, RIGHT, INNER, and FULL joins with
separate or AND-combined clauses, both clause orders, and one or two active
predicates. Fixed extensions cover a LEFT/INNER chain with two pushed sources,
same-source OR, cross-source equality, greater-than, nullable-field
`isUndefined`, and an already residual outer clause. The checkpoint is the
returned `optimizeQuery` IR, both initially and after re-optimization.
The oracle counts each predicate in its source and outer WHERE and checks the
outer residual marker and clause count. Plain-array LEFT, RIGHT, and
three-source join models separately check the first public snapshot of a
live-query Collection, with matched and unmatched source rows.

## RED, GREEN, and code weight

| Subject | Result at the intended checkpoint |
| --- | --- |
| Original optimizer, full expanded oracle | 21 failed, 28 passed. Source copies multiply and outer residual markers disappear; the new greater-than witness alone fails at source predicate multiplicity. |
| Contributor's supplied patch, full expanded oracle | 1 failed, 48 passed. A later pass with an existing residual leaves three outer WHERE clauses, while the law expects one regular and one residual group. Predicate multiplicities and markers pass that case. |
| Candidate partition-and-combine repair, full expanded oracle | 49 passed. The candidate combines each regular/residual group once inside `applyOptimizations` and removes caller-side residual reassembly. |
| Candidate, optimizer, join, and join-subquery suites | 247 passed after the predicate-kind case was added. |
| Wrong-design controls | Marking regular clauses residual fails on `member.userId`'s marker. Keeping only the first residual fails on the missing `tag.region` predicate. Both are assertion failures at the structural checkpoint, not setup failures or timeouts. |

The production change adds 20 lines and removes 28, net **minus eight**.
The expanded executable oracle adds 533 lines. This separates the cost of the
repair from the broader test and documentation coverage.

## Oracle guide audit

| ID | Outcome |
| --- | --- |
| ORC-001 | The contract above states the optimizer and outer-join law, authority, finite grammar, and observations. The coverage map owns omitted expressions, join chains, and publication histories. |
| ORC-002 | The structural expectation is an explicit relational-side table, not the optimizer's nullable-source classifier. The public result models join and filter plain arrays; they import neither optimizer analysis nor compiler evaluation. |
| ORC-003 | The oracle opening states the contract, model, grammar, driver, and checkpoints. The table and array models give the answer; `optimizeQuery` and `createLiveQueryCollection` are the production drivers; assertions are adjacent to each case. |
| ORC-004 | Not applicable: this is a finite, enumerated grammar, not a generated-history property. Its named cross product and fixed extensions are the claim's bound. |
| ORC-005 | Structural work is observed at the `optimizeQuery` return and after a later pass. The public driver observes exact projected rows at the first synchronous Collection snapshot. The recorder preserves duplicate predicate terms and result rows. |
| ORC-006 | The original implementation and two wrong designs fail at the intended assertions. The contributor's partial fix also fails the later-pass clause-count assertion. |
| ORC-007 | Not applicable: there is no important generated property or random campaign. Every enumerated case runs in the package oracle test file. |
| ORC-008 | Not applicable: the structural table and public array models are stateless; no model state is merged or split. |
| ORC-009 | Source Collection, live-query Collection, public row, public snapshot, and checkpoint use the glossary meanings. The model's `teamPush` and `memberPush` booleans describe expected source placement, not production states. |
| ORC-010 | Not applicable: the fixed tests do not shrink, record mutable traces, or perform cleanup that could replace an assertion failure. |
| ORC-011 | The plain-array public result is a different formulation from the structural predicate-count law. It checks the plausible shared fault that a plan with fewer predicates changed joined rows, including unmatched rows. It does not independently prove optimizer work cost. |
| ORC-012 | This record scores every applicable requirement and identifies non-applicable triggers. The closure claim is limited to the stated grammar, paths, and checkpoints; remaining cells are assigned in the coverage map. |
| ORC-013 | The original ten-copy result and the repaired one-copy result distinguish the once-only law from repeated pushdown. LEFT and RIGHT active-side cases distinguish the relational-side boundary from a LEFT-only rule; FULL is the no-push control. The existing-residual case rejects a plausible partial grouping. |
| ORC-014 | Not applicable to the structural path, which has no controlled provider. The public driver uses synchronous in-memory source Collections and claims only their first snapshot; it does not claim an external-provider handoff. |

This closes the reported repeated-pushdown class for the finite structural
grammar and initial public-result paths above. Arbitrary expression trees,
more complex join chains, and incremental source changes or publication
histories remain open cells for the optimizer-semantics owner. The current
tests give no wall-clock runtime guarantee.

## Package-wide validation

After building the isolated candidate package, the parent audit ran
`pnpm exec tsc --noEmit -p packages/db/tsconfig.json --pretty false`
successfully. The full `packages/db` Vitest suite then passed 229 files and
7,937 tests with no type errors using `--testTimeout=120000`. This resolves
the earlier self-package declaration setup errors. The structural and public
history bounds above remain unchanged.
