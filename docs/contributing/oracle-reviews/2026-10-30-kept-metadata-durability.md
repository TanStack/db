# Kept metadata: local reads, durable writes, and receiving evidence

This record evaluates PR #2303 at published commit
`ea769ec8d3b4c1bffc286e1d88b1b0c553c5cc5f`. The final candidate is that
commit plus an ordinary merge of main
`9cfa11fc712866f8f276e85762865ebb8bd49cbe` and the review repairs below.
It has no production-source difference against that main commit. In
particular, `persisted.ts` retains main's source-progress fields and serializer.
The original metadata-materialization change and its release note are withdrawn.

## Law and repair location

Keeping metadata is not writing it. An update or equal re-insert without
explicit metadata must not copy a tab's hydration seed into durable metadata
or a peer metadata write. Authority: decisions 9 and 18 in the
[sync metadata review](2026-10-22-sync-metadata-session.md). Decision 14 fixes
insert kind at commit; it does not authorize another metadata write.

Cached metadata M0 and a later hydration seed M1 can therefore coexist: this
tab reads M1 while storage retains M0. An explicit metadata write is the
neighboring control and must reach storage. A named current-run notice has
source authority under decision 11. When authorship is unknown, decision 15
permits differing stored metadata to become source-written. Restoring M0 in
that case is not evidence that M1 should have been stored.

The original oracle conflated a local keep with a durable write, omitted a
direct durable-metadata comparison, and sampled the distinguishing bare-seed
premise too rarely. The repair changes the independent model, grammar and
observations, then restores the serializer already present on main. It does
not add a production recovery algorithm.

The native path also exposed a model environment-input gap. A successful
`pullSince(0)` response returned row version 2 without transaction replay details. The
shared model now records that response input and applies the existing D15 rule
to its own storage. It derives no expected metadata from production output or
the wrapper's reload classifier. Earlier suspicion of a production recovery
bug was withdrawn after this input was measured.

## Histories, receiving path, and checkpoints

The primary owner remains
[`sync-metadata-session-oracle.ts`](../../../packages/db/tests/sync-metadata-session-oracle.ts).
Each constructive batch includes all 12 combinations of update, equal
re-insert or inner equal re-insert; bare or non-bare seed; and implicit or
explicit metadata. Partial, full and on-demand lanes give 36 declared
successful case/lane states on each host. Seed shape, timing, repeat count and
the final named/full-reload/no-notice choice vary. Notice choices are sampled;
the property does not guarantee every notice choice for every case.

The controlled persisted driver and native SQLite/coordinator driver use the
same model, histories and comparison. Source metadata reads are compared
after authored actions. Asynchronous consumer rows, receipts, durable rows
and durable metadata are compared after settlement.

The native driver uses two real Collections and Browser coordinators, Node
BroadcastChannel/Web Locks, and native SQLite. It finishes each source
commit's correlated notice and recovery before admitting the next authored
action. Actual response inputs are consumed before comparison. Accepted empty
source commits drain delivered handlers through the apply lock without
changing rows or metadata. This selects one legal schedule.

Every root SQL call shares transaction admission on the physical connection;
scoped calls remain inside their owning transaction. A focused rollback/read
isolation test rejects the earlier fixture, whose unscoped calls could join
another adapter's transaction. Actual notices, ensure replies and apply-lock
barriers replace the former quiet-time heuristic.

## Evidence

The extended comparisons ran on unchanged PR production before removing
materialization. They also ran on the merged current-main composition before
that same repair. Both controlled and native comparisons failed at the durable
metadata cut: expected cached M0, actual tab seed M1 or absent metadata. These
were assertion failures, not setup failures or timeouts.

Current-main verification, with one worker and coverage/type checking disabled
inside Vitest:

| Experiment | Result |
| --- | --- |
| Native receiver, SQL fixture and work files | 12 tests passed |
| Complete controlled persisted session file | 74 tests passed |
| New durability fixed/random campaigns, each host | 8 batches per campaign; every one of the 36 case/lane states reached 8 times |
| Native prior-cache version crossed without replay details | 96 successful histories in each campaign |
| Original seed/re-insert/reload campaigns | Fixed/random 40-run budgets and existing fixed completed-branch guards retained |
| Direct durability replay, both hosts | Seed `2220031`, path `0:0:0`, passed; each case/lane reached once |
| Scoped TypeScript check | Passed on the combined tree |
| Unchanged refresh work | 0 implicit metadata mutations for 2, 100 and 10,000 rows; original PR emitted 2, 100 and 10,000 |

The work count measures emitted mutations, not native SQLite elapsed time or
a universal performance bound. Original generator sampling measured zero
completed bare-key-1 premises in 40 inputs at seed `-704889444`, and two at
fixed seed `527962096`. Constructive batches now supply the bare implicit
premise independently of seed while preserving the older campaigns.

Calibration on the combined tree used the same seed/path and comparison:

| Wrong account | Rejection |
| --- | --- |
| Restore the original PR materialization on top of current main | Both hosts reject M1/absence in durable metadata where M0 must remain |
| Ignore the measured unknown-authorship recovery input in the model | Native source metadata comparison fails at commit; actual response input remains in the trace |
| Drop explicit durable metadata writes too | Native explicit-write controls reject cached M0 where explicit metadata must persist |
| Earlier unscoped SQL fixture | Focused isolation/rollback test observes an uncommitted row and rejects it |

The model-input control is a wrong model, not a production mutant. The original
serializer and explicit-write controls are production mutants. Every temporary
edit was restored, then direct replays passed on both hosts. The final serializer
SHA-256 is `1a3bc05bbf10646c8d75fb062799c8335a181a8d3a5e91d61a9244c1a4f5027a`;
the shared model is `584d767b43aa7a9f4661c65fa431ac579d0037e5e1fa8415e693817b0dae635c`.
The controlled and native driver hashes are respectively
`0a568a76809363068f885c132ed66ecea74bbbc984d5d27116ec852b9d83bac0` and
`a6387073a9cd3fa08c2d553d0e30f949a0df53c11644080985e2113698b1c47c`.
These identities bind this evidence to the uncommitted combined candidate;
later semantic edits require affected checks again.

## Oracle review and limits

Independent code review found contradictory retained prose and an obsolete
release promise. Both were corrected, then the combined candidate was reviewed
again with no new actionable finding. A separate optional campaign-runner
extraction remains unapproved and unapplied; none of these results validate it.

| Requirement | Outcome for the changed scope |
| --- | --- |
| ORC-001 | D9/D14/D18 authority and D11/D15 neighbors are explicit. |
| ORC-002 | Independent storage/events compute expected metadata. |
| ORC-003 | Contract, model, grammar, receiver and comparison prose agree. |
| ORC-004 | Original witness reconstructs; update/flat/inner, bare/non-bare and implicit/explicit axes distinguish competing rules. Existing legality rejects transactionless writes. Notice coverage stays bounded. |
| ORC-005 | Real entry points, measured receiving inputs and direct durable comparisons reach the named cuts. |
| ORC-006 | Wrong serializer, missing model input, dropped explicit writes and bad SQL admission have distinct rejecting witnesses. |
| ORC-007 | Matching fixed/random properties and budgets; direct seed/path replay verified on both hosts. |
| ORC-008 | A subsequent unknown storage observation distinguishes local metadata from durable metadata, so both remain modeled. |
| ORC-009 | Recovery input explicitly abstracts a successful response without authorship. |
| ORC-010 | Shared mismatch reporting retains recovery inputs and primary failure; cleanup diagnostics remain distinguishable. Broader setup/host teardown is outside this evidence. |
| ORC-011 | No remaining concrete shared semantic-fault hypothesis requiring a second expected-value model was identified. |
| ORC-012 | This record binds contract, witnesses, calibration, review outcomes and limits to exact source identities. |
| ORC-013 | Explicit writes and bare seeds distinguish keeping, materializing and never-writing rivals. |
| ORC-014 | Native receiving reuses the controlled owner's model and comparisons; actual transport input supplies its own premise. |
| ORC-015 | All 36 successful case/lane states and the native recovery state have enforced reach. |
| ORC-016 | Fixed histories use the shared judgment. Supplemental SQL/work examples remain in ordinary test files. |

The evidence covers one process, two coordinators, partial/full/on-demand
lanes, and the bounded commit-to-notice/recovery schedule. It does not cover
arbitrary response/application interleavings, cleanup/expiry/cancellation during
recovery, leadership turnover, transport loss, Chromium OPFS, Electron IPC,
restart semantics, every shared grammar, intermediate durable cuts hidden by
later writes, or the necessity of gap detection. The native constructive
campaign uses core holds; the broader controlled owner retains store/read
holds. These results do not close the broader receiving scope of #2272.

Run the two host files from `packages/db-sqlite-persistence-core`:

```sh
pnpm exec vitest run --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false tests/sync-metadata-session-persisted.test.ts
pnpm exec vitest run --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false tests/sync-metadata-session-sqlite.test.ts tests/sync-metadata-sqlite-driver.test.ts tests/sync-metadata-write-work.test.ts
```

For direct replay, set `TANSTACK_DB_ORACLE_PROPERTY` to
`sync-metadata-session.persisted-kept-metadata-durability` or
`sync-metadata-session.sqlite-kept-metadata-durability`, plus
`TANSTACK_DB_ORACLE_SEED=2220031` and `TANSTACK_DB_ORACLE_PATH=0:0:0`.
Select `-t 'tab-local and durable metadata distinct'` in the matching host file.
The fixed campaign stands aside. Local runs use
`pnpm_config_verify_deps_before_run=false` with existing dependency bindings;
no install override or lockfile change belongs to this repair.
