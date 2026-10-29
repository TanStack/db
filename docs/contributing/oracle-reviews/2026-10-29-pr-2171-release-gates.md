# PR #2171 release gates and deferred investigation

Recorded on 2026-10-29 after chunk 21 R2 acceptance. Production baseline:
`858b174a65f160d13d01f0324c7481cc8e4eba3a`. The maintainer requires a merge
in about eight hours from 04:50 UTC: approximately 12:50 UTC / 06:50 Denver.
This is a prioritization record, not release approval or a green test report.

The existing Version Packages action is connected to the custom version and
publish commands. The independent version owner passes 86 histories. The
first-RC changeset inventories 23 candidate packages and the two accidentally
stable adapters, Query and Offline, with their approved minor releases.
Generated API docs remain owned by the separate CI-created PR.

## Required before merge

- Integrate current main. At this audit, GitHub reports merge conflicts and
  has no full test CI on the current published head. Latest main includes the
  Vitest and Zod security upgrades. A read-only merge forecast identifies
  conflicts in the root manifest, lockfile and React source-ID test.
- Repair demonstrated publisher failures using the accepted release owners:
  P01 permits the wrong candidate dist-tag; P05 attempts duplicate uploads on
  retry or an already-current release. These are concrete defects in the
  release process, not undefined product behavior.
- Repair PR-introduced cached-server admission and hydration replacement
  claim gaps, and restored-sibling transaction cleanup. Their accepted oracles
  already demonstrate the failures on unchanged production.
- Complete the Query mutation migration at the documented confirmation path
  (G01) and the persisted test handler returning an object (G08).
- Check clean Offline installation and build ordering (G05). Its DB workspace
  build edge is absent; an actual fresh-build failure remains unmeasured.
- Validate clean installation/build, initial packed exports and same-release
  Query/Offline consumers, then run required CI on the final intended head.
  Current workspace links and source-public type tests do not supply packed
  consumer evidence. A dependency fetch/setup failure is not a product RED.

No executable production repair has begun during this campaign. Relevant
oracle checks and real receiving paths remain the gate before each repair.
This deadline does not authorize weakening comparisons to obtain green CI.

## Preserve separately from the release gate

Chunks 1–21 are independently accepted as instruments; many deliberately
expose product defects. Acceptance does not mean production passes. The chunk
record and coverage map retain each exact law, boundary, evidence and limit.

P11 (raw selected undefined becoming null) and P12 (selected empty records
disappearing) have current failing witnesses and source paths unchanged from
the merge-base. Their broader literal-value work is a follow-up candidate;
no baseline runtime campaign has yet established historical behavior.

P09 (Effect LEFT-join startup publication) and P10 (callback reserved metadata)
are confirmed current failures. Their baseline causality still needs bounded
checking. P10 also spans an explicitly approved callback contract. Keep these
open until that check determines their release disposition; do not label them
undefined merely to defer them.

Broader literal/type grammars, additional native UI histories, declaration
portability, diagnostic-baseline reconstruction, recorder improvements and
static/work investigations remain separately tracked. The immediate order is
main integration and release-critical gates. No test has been removed or
relaxed by this record, and no follow-up PR has yet been created.

## Evidence at this checkpoint

The versioned [chunk record](2026-10-28-pr-2171-oracle-chunks.md) and
[review matrix](2026-10-28-pr-2171-review-coverage-matrix.md) remain the detailed
inventory. Chunk 21 R2 manifest SHA256 is
`da237233542b78a0de9eb836ecbeed12b6b14c2e80f91837eb577c8813bcf0a7`.
Its independent result is 115 passes / 280 intended native type REDs, all
2,550 reach states once, 55 shipped controls and 20 independent controls.
Root independently verified the frozen input/evidence hashes and parsed the
395 unique test titles; root did not rerun that native campaign.

Scratch audit details, without claims of additional execution:
`/private/tmp/rc2171-oracle-challenge/o22-release-readiness-audit.md` and
`/private/tmp/rc2171-oracle-challenge/release-critical-triage.md`.
All campaign work remains uncommitted at this checkpoint.

### Main integration checkpoint

Main `95460bc875a2259b34eea534e5592a9d0394e73f` is integrated in normal merge
commit `5fa6eca05530bb9e1f4748b7c00ae60976da2808`. The root manifest and
lockfile retain the release dependencies alongside Vitest 4 / Zod 4. The React
resolution preserves this branch's removal of legacy dependency-list tests.
The merge commit's lint hooks pass. That is not a full test-CI result.

Before merging, all 82 dirty/deleted/untracked campaign paths were saved in
an independent hashed file archive and Git stash
`2570e0bd0980f6db12cbdfe58d9a13a0b743779c`. The stash was applied after the
merge and retained as a backup. Restoration checks find all 82 paths present
or deleted as intended. Eighty retain their exact saved bytes; DB's package
manifest takes main's coverage-tool upgrade and the Electric oracle takes
main's constructor-compatible mocks. No library source differs between the
pre-merge and merged commits. Campaign evidence from the older toolchain
remains labeled with its original provenance; it is not silently credited to
Vitest 4. A disposable clean-install/build check is the next receiving gate.

### Executed clean setup and build gate

The standalone stage is
`/private/tmp/rc2171-oracle-challenge/gate-a-merged-5fa6eca05/source`.
Its manifest freezes 3,400 source files at the merged commit plus the restored
campaign overlay. The independent reviewer verified every hash, the captured
tracked diff, the absent inherited build/install trees and the confined DB
workspace links. No source/config/lock input changed during execution.

Two offline frozen attempts failed for missing cached
`@changesets/apply-release-plan@7.0.14`: first in the default temporary store,
then in the explicit existing source content store. These are setup failures.
The exact online frozen install then passed, adding 2,035 packages. It uses
Vitest 4.1.12, Zod 4.6.7, TypeScript 5.9.3 and Changesets 2.29.8. UUID 13.0.2
installed; no dependency override or downgrade was needed. The original
worktree's installed dependencies remain untouched. Node 24.19.0 differs from
the repository's 24.8.0 declaration, so exact Node parity remains unclaimed.
An example postinstall intentionally treats a missing native build command as
nonfatal; this is not native-host validation.

The actual `pnpm run build` is RED. Its first topological tier builds DB-IVM
and Offline together; Offline fails with TS2307 for DB's absent declarations.
The measured `ivm-offline` dependency closure contains only DB-IVM and Offline,
despite Offline's installed DB link resolving correctly inside staging. This
is G05's clean-build failure, rather than an installation failure.

`typecheck:tests` also fails on the missing DB declarations and resulting
cascades. SQLite-core's actual source typecheck independently reproduces G08:
the persisted receipt test's handler returns `Promise<{}>` where
`Promise<void>` is required. Convex's source typecheck and Svelte's native
source check pass; Svelte reports zero errors and warnings. Neither pass
establishes a complete successful build or packed declarations.

Both executor and independent reviewer accept this evidence classification.
No production repair, versioning or packing ran. Final result and hash records
are in the stage's `evidence/gate-a-final-results.json` and
`evidence/gate-a-evidence-hashes.json`; the latter SHA256 is
`a52ef757bc31346f043f59fee11b72762f808f5bddf84535913c4126eceeab33`.

### Bounded baseline attribution

The retained accepted Effect history fails at the same initial phantom-update
comparison on current code and frozen main `95460bc875a2259b34eea534e5592a9d0394e73f`.
The bounded inline-child / QueryRef / structured-projection metadata lane also
produces the same seven assertion failures and one compatible control pass on
both graphs. The execution verifies coherent DB/DB-IVM source resolution and
all loaded source hashes. Whole-matrix reach errors from targeted selection are
recorded separately from the actual law failures.

These witnesses establish that the concrete P09 and runtime P10 failures are
present on main; they do not attribute every related type or runtime path.
P10's explicitly approved callback law remains distinct from that historical
attribution. No comparison or product law changed. Exact commands, outputs,
source graphs and earlier setup failures are retained under
`/private/tmp/rc2171-oracle-challenge/bounded-main-disposition/`.

### Deadline scope checkpoint, 2026-10-29 06:00 UTC

The release is not ready yet. Current main is merged and pushed, all 25 public
packages are represented exactly once in the first-RC changeset, and the
version owner passes. The existing release action invokes the intended version
and publish commands. The migration guide is present in navigation. These
verified parts do not establish successful publication or final release CI.

The remaining merge gates are the demonstrated publisher failures, introduced
cache/hydration and Offline settlement defects, incomplete mutation migration,
clean-build dependency ordering, CI migration/tooling failures, and final
packed-package and CI checks. Current CI run 40821046528 is red. Its seven
diagnosed groups are retained under
`/private/tmp/rc2171-oracle-challenge/ci-5fa6eca05-40821046528/diagnosis.md`.
Chunk 23 repairs the SortedMap reach sampling failure with independent review;
it has not yet been committed or tested in CI. The mobile deadline receiver's
failure still needs causal diagnosis.

Finish the active bounded static-metadata chunk 24, then limit further oracle
work for this release to the receiving/recorder checks necessary for these
merge gates. Broader grammar expansion and investigations are follow-up scope
candidates. Preserve their owners, exact counterexamples and evidence; no
comparison is relaxed or silently excluded. In particular, baseline-present
P09/P10 and source-unchanged P11/P12 are not reclassified as undefined behavior.
P10 also implements an explicitly approved law, so any deferred implementation
must identify the omitted promise and preserve its failing receiving witnesses.

No follow-up split has been applied yet. Before shipping, the final diff must
separate deferred evidence from the release's green comparisons and state the
remaining limitations. Reserve time before the approximately 12:50 UTC merge
deadline for a clean build, packed consumers and required final-head CI;
completion of the oracle work alone is not release readiness.

The completed read-only audit and dependency-aware split proposal are retained
as `readiness-after-chunk23.md` and `release-followup-partition-proposal.md`
under `/private/tmp/rc2171-oracle-challenge/`. The latter classifies all 85 dirty
paths at its capture and explicitly holds the three actively authored chunk 24
files. It is a proposed partition, not an applied split or accepted final freeze.
Keep the already-green descriptor/schema receiving improvements if splitting
their shared files would add integration risk. Current mutation-guidance P02
and P04, plus editorial G07/G11, remain part of the authored migration cleanup.

Pinned Changesets Action `e0145edc7d9d8679003495b11f87bd8ef63c0cba` source was
retrieved and independently inspected. It captures all custom-command stdout,
scans every `New tag:` line and rereads package manifests after the command
returns. The proposed split publisher preserves those source-level conditions.
No Action execution or final published-package output has been observed.
The proposal remains unexecuted production; the accepted HTTP REDs still block.

One unchanged CI07 covered-demand history passes locally with exact merged
sources, Vitest 4.1.12, BetterSqlite 12.8.0 and Node 24.19.0 on macOS: one
selected pass, five unselected, 1,121 ms. This is non-reproduction on that host,
not a repair or closure of the original Linux/Node 22 CI assertion. The timing
premise remains unmeasured. Evidence is retained under
`ci07-unchanged-retry-5fa6eca05-kqu_7670/` in the same scratch directory.
All 3,400 Gate A source hashes, prior evidence and critical tool-package hashes
remain unchanged. Vite created an empty borrowed-tools `.vite-temp` directory;
the record explicitly withdraws any claim of zero tool-cache writes.


### Oracle phase checkpoint, 2026-10-29 06:55 UTC

All 26 planned oracle chunks are independently accepted as instruments. This
includes the native Solid/census corrections and generated-error command
receivers; no executable production repair has begun. Chunk 26 R3 preserves
all previous results and adds a calibration rejecting anchors inside fenced
message examples. Its old-tooling result is 27 PASS / 12 assertion RED. The
freeze is `2baf81b3904bf1f8005dee31aef2b0c7b2d46bb2b758825ee59ecffaa3fbce7f`;
independent review is `cf7cc0ca73dd7805df42392213a8f1371fd95fd20b702525bc29eb1b78cb35b6`.
Root verified the frozen source and protected inputs before authorizing repair.

GitHub still reports the published head mergeable with failing CI. The release
remains blocked by the concrete repair and receiving gates above. Preserve the
full accepted campaign before separating the broader baseline discoveries.
Keep already-green framework receiver improvements to avoid risky shared-file
splitting. Later four-cut artifact campaigns remain unexecuted; the immediate
artifact gate is the actual first-RC CLI and all 25 initial packed artifacts,
with installed Query/Offline consumers. No publication or final-CI success is
claimed by this checkpoint.


### Applied release/follow-up partition, before executable repairs

The complete accepted 93-path campaign is preserved on local branch
`codex/rc-oracle-followup` at `db38b4e009146af53e46aeeef3206269f5968af8`.
The independent archive is `accepted-campaign-20261029T065509Z`, manifest
SHA256 `7eb801592ddc3f5041f7db862052800e86523403784827552ad683c8eb40f0aa`.
The archive includes tracked changes, new owners and deleted-path status.
No generated API docs or generated errors page entered this snapshot.

Independent inspection verified every archived path against that Git tree,
all 21 proposed transformations and the inverse patch, and 1,701 retained
code paths for imports of deferred files. The applied partition moves 15
complete broader RED files and their two appended shared-file slices.
Seventy-three dirty paths remain byte-identical; already-green framework
receivers stay intact. Forward patch SHA256 is
`85825e99a43a2d5d05a4e205d54c2893c2cfa2875375e883dca662f8b9743cc3`;
inverse is `aba2a751ffa2038f5e1826b427585461345e44c1cc9543fc35b3687cdd41b044`.

The retained 505-line public-output type owner preserves all 24 generated
campaigns and nine controls, including existing structured-union-spread
precision laws. Deferring the appended receiver does not retire those laws
or establish that the nullable repair alone makes every retained check green.
The [deferral record](2026-10-29-pr-2171-deferred-oracles.md) identifies each
open class, accepted law and historical RED. The architecture states the
correlated callback limitation. No comparison was weakened or skipped.

Only after the 26th independent acceptance and this recoverable partition
did executable production repairs begin. They are confined to demonstrated
publisher, cache/hydration, Offline caller/build, nullable facade type,
mutation-guidance and generated-doc ownership defects. Each repair still
requires its unchanged accepted comparisons, GREEN and hostile-mutant evidence.
