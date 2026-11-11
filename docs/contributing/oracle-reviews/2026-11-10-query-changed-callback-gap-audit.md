# Final Query changed-callback gap audit

Run `89f398bd4b86` completed with **24 kills and 11 survivors** from 35 selected
candidates, with zero nondeterministic and zero excluded tests. Both unmutated
passes completed all 1,747 tests. The authored original missing-value-fallback
defect is killed. This is a gap inventory, not a closure claim for survivors.

The immutable snapshot is `c0b65d926ca72ca04b96a205013845a42fbb21fb` at
`/private/tmp/tanstack-db-2394-query-delta-11d6ed3`. Query source SHA-256 is
`1a794774e60d3c1dbacd515d0350b048557714adf80d6e3b9d42e7250841754b`.
The selected scope is all 29 operators in the changed previously-owned-row
callback, five mapped previous targets, and the authored original-defect
control. It is not a whole-source mutation campaign. Exact commands, source
span offsets, operators, replacements, both contextual keys, outcomes, changed
test identities and kills are retained in the adjacent
[JSON evidence](2026-11-10-query-changed-callback-gap-audit.json).

## Surviving candidates and required work

| Candidates | Effect under investigation | Current disposition |
| --- | --- | --- |
| M1313, M1315, M1316, M1317 | Omit retirement of a settled ownerless direct-write position. | Open. Investigate scope-local omission followed by retained-cache reacquisition; the existing final-row checkpoint misses retired-key work and may miss the later public consequence. |
| M1314 | Force the direct-position presence guard true. Undefined then compares equal to an absent entry and deletes an absent key at retirement. A later numeric position remains protected. | Equivalent-behavior argument only; no allowance granted. Preserve the useful guard rather than add temporary undefined map entries solely for mutation score. |
| M1327 | Omit the removed-row tracking used to retire accepted row positions. | Open. Investigate retained-cache reacquisition followed by an earlier pending fetch that should replace the reacquired value. |
| M1328, M1330, M1332 | Write an update even when old and returned rows are equal. | Open comparison gaps. Commit-write diagnostics differ; final-row laws pass. Evaluate independent work or publication authority before changing comparisons. |
| M1334 | Omit the explicit update operation type from an adapter sync write. | Open comparison gap. The public SyncConfig.write input requires a declared operation; investigate protocol-boundary validation independently of final rows. |
| M1474 | Treat absence of the queryToRows.has result as true after negation, so later eager persisted results also take baseline reconciliation. | Open. Extra reconciliation remains observationally indistinguishable under this campaign; an equivalent-effect claim does not close the gap. |

The first four cleanup mutations have the same suspected missing distinction;
they need a shared generated lifecycle witness. The proposed public consequence
and the redundant-guard argument above are diagnoses to test, not verified
closure. Every survivor still needs an oracle kill or an explicit maintainer
allowance under AGENTS.md. Recording these traces does not grant one.

## Mapped previous targets

| Original ID | Current ID | Result |
| --- | --- | --- |
| M563 | M563 | Killed: direct row ownership |
| M1468 | M1469 | Killed: immediate eager materialization |
| M1469 | M1470 | Killed: immediate eager materialization |
| M1473 | M1474 | Survived; open |
| M1794 | M1795 | Killed: fetched cache authority |

The exact original-value-fallback control restores
`shouldUsePersistedBaseline ? persistedBaseline.get(key)?.value : currentSyncedItems.get(key)`
and is rejected by the direct-row-value law.

## Instrument and scope integrity

The run uses Node 24.22.1 with forks, seed 2367, and the isolated e1fb CLI copy
with the verified expected-failure, complete-capture and full-title-identity
repairs. The installed CLI remains unchanged. Independent verification found no
changes to 3,749 tracked snapshot files, 1,092 copied workspace build outputs,
the control, runtime or 13 instrument modules, and no live-checkout source
imports. The original 55-kill conversion-retention experiment is separate and
completed with all 55 stable operator kills retained; see the
[retention audit](2026-11-10-startup-property-gap-retention.md).

The initial delta snapshot accidentally included in-progress PowerSync batching
calibration changes. Its clean baseline refused before mutation because a
Query receiver without a batch-size history could not reject that calibration.
The refusal is preserved under `.retention-delta-work-tests-refused`; it is not
a product verdict. The completed c0b snapshot restores those five unrelated
pending-work files to c4 while retaining final Query source and its receiving
witnesses. It therefore establishes this Query delta, not final integrated
PowerSync/RxDB readiness.

There is also a key-identity caveat: the CLI final report can assign duplicate
anchor suffixes after selection, while the selection script assigns keys over
the whole source. For example M1313 is `~2` in the global selection and has no
suffix in this report. The evidence retains both strings and the exact source
SHA, original span offset, anchor, operator and replacement. Do not equate
contextual strings from different selections without those anchors.


## Additive scope-omission closure experiment (2026-11-10)

The original audit above remains unchanged at 24 kills and 11 survivors. The
[scope-omission receiving extension](2026-11-10-query-scope-omission-gap.md)
adds generated retained-cache next-use histories and rejects M1313, M1315,
M1316 and M1317 on controlled/native SQLite, plus M1313 on Chromium OPFS,
at the `acquired` row comparison. The clean integrated suites pass 36 Node
and 18 Chromium tests. These are additive executed results, not a replacement
CLI score. M1314 and the separate M1327 contract proposal are not claimed
closed by this extension.

## M1334 receiving comparison supplement

The later [sync-write protocol evidence](2026-11-10-query-sync-write-protocol.md)
closes M1334 by observing the actual raw operation at the adapter write boundary.
The exact field deletion fails the shared comparison on controlled storage,
native Node SQLite, and actual Chromium/OPFS; the same clean replays pass.
The original audit result above remains a record of the earlier comparison.
This supplement changes no production source and grants no allowance for any
other survivor.
