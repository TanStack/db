# P6 publication CI: missing-row metadata

This repair preserves source metadata that exists only in one sync run when a
nested commit deletes its row and an enclosing keeping update recreates it.
An unrelated named peer notice must not replace that value with absent stored
metadata. Same-key peer replacement, unknown-write observations, source deletes
and source truncates retain their accepted meanings.

Parent publication: `88641f0847975ed920fc44eb48e48f5a602c5206`.
The source identities below bind the tested repair. This is a self-review,
not independent review. The user authorized the production repair after the
preliminary investigation, and retained the merge-when-green instruction.

## Findings and repair locations

**META-CI-051 — fixed reference model.** SQLite core CI job `125530540619`
failed `sync-metadata-session.persisted-peers` at seed `1581505626`, path
`18:3:0:3:9:9:12:11:11:7:7:8:8:8:8:8:8`. The original replay fails its durable
metadata comparison at commit step 13. Source metadata still agrees.

The model retained metadata for a missing row in its storage entry, then
incorrectly made it durable when a later keeping update recreated the row.
`SessionModel.store` now preserves prior metadata only if its prior durable
row existed. Its session events still retain the source-only value. Under D16,
source read M and durable absence are both required. A later explicit metadata
write instead makes M durable. These predictions come from the accepted law,
not production output. The original replay passes after this correction.

**META-CI-051-S001 — fixed production retention within the boundary below.**
The corrected model exposes a nearby source-read defect on controlled and
native receivers. Starting with cached row 1:

```text
begin
  update row 1 without metadata
  begin
    delete row 1
    set row 1 metadata M
  commit
commit
peer writes row 2 and delivers its named notice
```

The inner delete precedes the metadata set. The inner commit has no durable
row 1, so M remains nondurable. The outer update recreates only the row.
This sync run must still read M, and storage must still lack metadata.
An on-demand reload instead replaced M with the absent durable value.

The wrapper previously tracked only whether metadata had a source writer.
It now tracks the latest local or named peer writer. A known storage read
retains local metadata, including nondurable values. A named same-key peer
write replaces it. Unknown peer writes still use D15 and per-key knowledge.
A local source truncate does not turn later local metadata writes into unknown
peer writes. No public API, protocol, law or stored format changes.

## Authority and class boundary

Authority: decisions 9, 11, 15, 16 and 18 in the
[accepted session record](2026-10-22-sync-metadata-session.md).
D16 keeps missing-row metadata in the run until a source deletes the row.
D9/D18 distinguish keeping from writing. D11 admits named current-run peer
replacements. D15 judges differing storage observations after unknown writes.

The declared class is D16/D9/D18 retention after independent nested commit
order, across partial/full/on-demand persisted receiving paths, observed at
completed source commits, core-held application cuts and completed peer
notices. Source reads, consumer rows, receipts, durable metadata and final
stored rows use the shared session model and comparisons. This bounded claim
includes the adjacent replacements and clears below. It is not universal proof
for every metadata history or transport.

## Grammar, receiving paths and pre-edit gate

`missingRowMetadataHistoriesArbitrary` constructs twelve cases per batch:

- Immediate and core-held application, each with keeping and explicit writes.
- The keeping history after a source truncate, immediate and core-held.
- Same-key peer row and metadata replacement.
- An unknown-write reload.
- Peer delete, source delete and source truncate.

Each case executes across `persisted-peers`, `persisted-peers-full` and
`persisted-peers-on-demand`: 36 states per host. Both controlled storage and
native SQLite use the same model, histories, recorder contract and comparison.
Each batch varies one to three missing-row metadata writes. Every authored
action must execute. A skipped action fails the campaign.

The native receiver supplies actual SQLite rows with absent metadata, two real
Browser coordinators, and Node BroadcastChannel/Web Locks in one process.
Metadata-only and delete peer actions now use real source commits. Source
truncate commits correlate their actual reload notices. The pre-edit inventory
required this receiver as well as the controlled adapter.

`repair-pre-edit-native-red.log` records the final gate on unchanged production:
all four fixed/random campaigns fail at the intended source-read comparison.
The four on-demand implicit states fail, including the source-truncate prefix.
The other 32 states pass in the reached batches. No setup, timeout or
legal-action error supplies this RED. The ledger records the satisfied gate
before the production edit.

Earlier attempts remain in scratch evidence without RED credit. One had an
unregistered replay name, one accidentally passed a non-arbitrary argument,
and one exposed unsupported native metadata/delete/truncate driver paths.
The final pre-edit run supersedes those setup failures. The old model also
fails earlier at the intended durable comparison; it cannot explain the later
source-read defect away.

## Executed results

Commands use Node 24.19.0, pnpm 11.1.0, Vitest 4.1.12, and
`--maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
--disableConsoleIntercept`. Logs live under
`/private/tmp/tanstack-db-p6-2026-11-02/`.

| Evidence | Result |
| --- | --- |
| `ci-51-replay-red.log` | Original CI seed/path fails durable metadata on the parent model |
| `repair-pre-edit-native-red.log` | Unchanged production fails all four receiving campaigns at the intended source read |
| `repair-missing-row-green.log` | Four repaired campaigns pass; every one of 36 states reaches eight times per host/campaign |
| `repair-ci-replay-green.log` | Guarded original CI replay passes 39 tests, exact seed/path, one nonzero selected execution |
| `repair-new-replay-green.log` | Guarded native seed 2220037/path 0 passes directly; one selected execution, all 36 states reached |
| `repair-core-green.log` + `repair-registry-green.log` | 162 core/registry tests pass initially; literal-owner registration guard then passes after correcting the wrapper's property spelling |
| `repair-helper-green.log` | 20 recorder, replay guard, native SQL conformance and deterministic work tests pass |
| `repair-primary-green.log` | 1,256 passed, 49 existing expected failures, one todo across the five requested owner/receiving/control files |
| `repair-types.log`, `repair-eslint-final.log`, `repair-format.log`, `repair-lint-changed.log`, `repair-budgets.log` | Source-mapped types, scoped ESLint (seven changed TypeScript files, zero errors/warnings), formatting, changed-file oracle lint and unchanged run budgets pass |

The new campaigns use identical fixed/random budgets of eight, with fixed seed
2220037. The normal random seeds were  -861738368 (controlled) and -836725301 (native).
No existing budget, guard, comparison or test is removed or weakened.

## Hostile controls and replay

An isolated tree starts from the parent and overlays the candidate sources.
Its unmodified fixed baseline passes both hosts with eight batches each.
Three production mutations fail assertions at the shared source-read comparison:

| Wrong design | Distinguishing case |
| --- | --- |
| Restore the original written-key retention rule | On-demand immediate/core-held keeping, including after local truncate |
| Treat a named peer writer as local | Same-key peer row replacement |
| Always retain local metadata despite unknown writes | Unknown-write reload |

All three fail on both receiving hosts. These are assertion failures, not
setup errors, runtime exceptions or timeouts. The original-policy mutant
replays native seed 2220037/path 0 with the same source-read mismatch; restoring
the repair makes that replay GREEN. Scratch `repair-mutants/results.json`
records exact commands, exit codes and reach. These are author-generated
sensitivity challenges, not independent held-out validation or a mutation score.

Reproduce the original CI replay from `packages/db-sqlite-persistence-core`:

```sh
TANSTACK_DB_ORACLE_PROPERTY=sync-metadata-session.persisted-peers \
TANSTACK_DB_ORACLE_SEED=1581505626 \
TANSTACK_DB_ORACLE_PATH=18:3:0:3:9:9:12:11:11:7:7:8:8:8:8:8:8 \
node --import tsx ../db/tests/oracle-replay.ts \
  tests/sync-metadata-session-persisted.test.ts \
  --maxWorkers=1 --coverage.enabled=false --typecheck.enabled=false
```

For the native sibling replay, select
`sync-metadata-session.sqlite-missing-row-metadata`, seed `2220037`, path `0`,
and `tests/sync-metadata-missing-row.test.ts` with the same wrapper and flags.
The `node --import tsx` form avoids the tsx CLI's sandbox-blocked IPC listener.

## ORC audit of this repair

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | D9/D11/D15/D16/D18 above authorize each expectation and bound the receiving claim |
| ORC-002 | The event-fold model imports no production metadata classifier or authority map |
| ORC-003 | Owner opening prose, the storage rule comment, new grammar prose and receiver opening comment explain the five responsibilities |
| ORC-004 | The original captured witness remains directly replayable. The sibling template reconstructs all twelve cases. Removing explicit writes loses the durable distinction, holds lose applied separation, the truncate prefix loses local/unknown discrimination, and replacement/clear tails lose the named boundaries. Repetition spans 1–3, including both margins. The grammar starts peer metadata/delete only after a durable row exists. Any illegal/skipped authored action fails. Permanent calibration independently requires all twelve case names exactly once per batch |
| ORC-005 | Both hosts invoke the persisted source API and compare source/durable metadata at each completed cut. Native notices correlate real source transaction IDs. No missing-input hypothesis remains for this boundary: named notices identify the changed key, and storage supplies its row and metadata by the comparison |
| ORC-006 | Three classified assertion-rejected production mutants and an unmodified isolated baseline |
| ORC-007 | Same fixed/random property and budget eight. Both captured seed/path replays execute the requested random campaign directly with nonzero witnesses |
| ORC-008 | Durable row absence and presence can share source metadata M, yet a keeping recreation must distinguish their durable outcome. The model now retains that distinction rather than inferring durability from source reads |
| ORC-009 | Session events abstract accepted/open source writes. Storage entries separately model durable rows and metadata. Local/peer writer bookkeeping belongs only to production, not the reference model |
| ORC-010 | Mismatches retain case/lane, history step, expected/actual observation and replay coordinates. Shared runner cleanup preserves the primary mismatch. The same source-read violation reproduces after shrinking and direct replay |
| ORC-011 | No remaining named common semantic fault requires a second interpreter. Independent authority reasoning requires source M/durable absence for a keep and durable M for an explicit write. Both hosts deliberately share one judgment and do not count as independent formulations |
| ORC-012 | This versioned self-review names the class boundary, adjacent witnesses, controls and remaining scope. Source identities below bind the evidence |
| ORC-013 | Keeping versus explicit metadata, known unrelated versus same-key peer notices, and unknown-write reloads distinguish wrong consequences at the same checkpoints |
| ORC-014 | Controlled absent durable metadata and named notices have native SQLite/coordinator receiving witnesses before the production edit. OPFS/Electron handoffs remain unresolved under the existing owner |
| ORC-015 | All 36 declared case/lane states reach eight times in each normal fixed/random campaign on each host, enforced by createOracleReach |
| ORC-016 | New registration runs the shared model/driver/comparison. Ordinary grammar calibration remains in an ordinary test file. No per-example metadata expectation enters an oracle |

## Review, merge gate and remaining limits

Existing formal reviews cover `9eef6525d` and `adf6a07f9`; mutable summary
6507648970 last covers `ef5c66ed2` and automatic review remains paused.
At poll 53 all formal reviews, inline comments and conversation comments are
unchanged. They do not cover semantic instrument commit `60ace06b` or this
production repair. The user authorized merge with that known review limit.
Previous review dispositions remain in the earlier versioned reports and the
append-only ledger. CI on a prior head does not certify this repair.

This evidence covers one sync run, serialized authored actions, controlled
storage and one-process native SQLite/Node messaging. It does not cover
arbitrary overlapping recovery, cache claim expiry/generation rotation,
leadership/transport loss, restart, Chromium OPFS or Electron IPC.
Read-hold/abandonment still lacks the peer/store-held lanes' direct durable
transaction trace; the coverage map names its owner and needed witness.

The withdrawn P6 production diagnosis stays withdrawn. This newly reproduced
retention defect does not establish a common cause with #2281, #2272,
#2317/P8 or #2298. Their broader obligations remain open. There is no known
counterexample left inside the bounded class above. Final publication-head CI
and fresh review enumeration remain required before the authorized ordinary
merge. No branch protection bypass is authorized.

## Tested source identities

| Source | SHA-256 |
| --- | --- |
| `packages/db-sqlite-persistence-core/src/persisted.ts` | `96d8ed9ff3ef38e9c8862ff576e8bc16c8977daef492778e1a102eaddd542f04` |
| `packages/db-sqlite-persistence-core/tests/sqlite-fixture-conformance.ts` | `8c4c6d9d28f42d9e8b461233fbbe3d48d84c0582d9decc9abb935d2c85883ba9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-calibration.test.ts` | `f90536a86c3efe345faa812c62ed3877cb1c786e2aa0185d6e440e96f7966805` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-campaign-result.test.ts` | `f75952c705f60519b783cf86887ada61c41c2eca86db98daa773fabc494775b9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-campaign-result.ts` | `66f2447c1116f3d10bdcee8d6a97192f81bd5e855afc3a69fbee163a75cca7cb` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-missing-row.test.ts` | `1b473feeed413ff86fa37bcf3a8f4c4551c6f8202a015627f20f68683aa5f23e` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery-recorder.test.ts` | `a318b173252956b8a7424817d371c1aa2ad5ce3152ad1c40d43fc1bc27259971` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery-recorder.ts` | `591206dbde1605b306bcd62b65ff2f5a9d1a001befc648d076ca052138e11a69` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-recovery.test.ts` | `880e40bd7f6aaf452dd2f3512a4ed0eb027feadaac221e1846dd9cfe0354dbfb` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-campaign.ts` | `b1de1ba24d79db954a4d85d6d7da18422ac29480d7175893d90b1ab07b24f1ae` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted-driver.ts` | `908ae60996e225757c7f6db8ab8408a5c44d7efd6ae1000188ced6588a133240` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-persisted.test.ts` | `3296a963a8737f84c72b6897817c44fd5c9b57d3fb723307115d78b3df03ded9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-sqlite-driver.ts` | `62aeef7a47df6b17a8e17485bd129a895846f879862c1dd30f9da2cbf1392583` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-session-sqlite.test.ts` | `7d4d547c70cd370dab328ef289689bb85c7e4c223907ba508f71158672af181d` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-sqlite-driver.test.ts` | `7582a61d10a944dd9bd794d5deb76bca3c6996158f3c9ef229493b98cc1ca2e9` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-sqlite-driver.ts` | `e5ef179a2a50d5e42f8b0ee51872885141056e2eef029a620f4ccd53a5512e53` |
| `packages/db-sqlite-persistence-core/tests/sync-metadata-write-work.test.ts` | `4dfa36304b65ffc17a1876eb780d23ea567e2b8c35e98bc3c588f0e926da980e` |
| `packages/db/tests/oracle-config.ts` | `f71356276ba2b1558ed6cb2af273fb57a792e76574eb88e2f8135c74e0926e1d` |
| `packages/db/tests/oracle-replay-manifest.ts` | `4023c661149ac6e3fb889db3e5b2bb35dcdfa498a8118ec1f340e90c84899009` |
| `packages/db/tests/sync-metadata-recovery-oracle.ts` | `ed05738b4d44411e617b82eccdd62ca51d4e5749ad4f698be9fd86f582976e13` |
| `packages/db/tests/sync-metadata-session-oracle.ts` | `0a60a92f234f138c7bfcf6a37b8ec3b9aeb473246c0b5ae751734f9c9a2ecb55` |
| `packages/db/tests/sync-metadata-session.test.ts` | `48778b83127e6c2e3c846fcae535d0273f3dcb709da716726c1a36bebd5ddd6f` |
