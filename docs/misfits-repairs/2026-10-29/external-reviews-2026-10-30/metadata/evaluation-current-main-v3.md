# PR #2303 external review: current-main result

No metadata law decision is needed. The accepted law says that keeping
metadata is not writing it (D9/D18). The candidate restores the serializer on
current main and strengthens its oracle and native receiving instrument.
There is no net production-source change against main `9cfa11fc`.

The repair is complete within the declared bounded metadata scope. One
optional P3 campaign-runner extraction remains unapproved and unapplied.
Whole-PR readiness is **unproven**: this is an uncommitted integration candidate,
the prep-pr user gate remains, and no final pushed head or its CI was assessed.

## Identity and evidence

- Active checkout: `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-metadata-review-current-main`.
- Published HEAD: `ea769ec8d3b4c1bffc286e1d88b1b0c553c5cc5f`.
- Ordinary uncommitted merge: `9cfa11fc712866f8f276e85762865ebb8bd49cbe`.
- Final freeze: `current-main-candidate-freeze-v3.json`.
- Net patch: `current-main-candidate-v3.patch`, SHA-256 `3b82a8471cae91982e0085dade060804354904ffa839405856eef7c50ca243a9`.
- Historical checkout, published history and original review records preserved.
- Main's serializer/source-progress fields, compact issue #2281 document and
  unrelated source-progress changeset are byte-identical to that main commit.
- No install, dependency manifest/lockfile workaround, commit, push or PR mutation.

The in-branch versioned evidence record is
`docs/contributing/oracle-reviews/2026-10-30-kept-metadata-durability.md`.
The coverage map links it. Raw review, historical traces, corrections,
experiment commands/source hashes and lossless events remain in this task-local
directory. V3 changes only evidence documentation and its coverage link after
the independently reviewed v2 source freeze; semantic source hashes match.

## Law, experiment, inference, remaining enforcement

| Law and authority | Decisive experiment | Inference and repair |
| --- | --- | --- |
| D9/D18: a local metadata keep does not write durable metadata; explicit writes persist | I01/I02 pre-repair composition RED; I03/I04 GREEN; I07 original serializer rejected on both hosts; I09 dropped explicit writes rejected | Wrong model rule and missing durable observation hid tab-seed promotion. Separate durable metadata from source reads; remove PR materialization. |
| D11/D15: named current-run writes and unknown-authorship storage observations differ | E12 records actual successful response crossing row version 0 to 2 without deltas; I08 ignoring that model input fails source reads at commit; restored I10 passes | An initial production recovery suspicion was a model-input gap. Apply existing D15 to independently held model storage after actual correlated processing; no production recovery change. |
| Reach must establish the distinguishing premise | E11 old random seed reaches bare-key-1 completion 0/40; I03/I04 each constructive state reaches 8 per campaign | Add all 12 write-kind/seed/metadata cases per batch across three lanes. Preserve old 40-run campaigns and guards. |
| Receiver must establish transaction admission and completed-input premises | E03 old SQL fixture admits an uncommitted row; I03 serialized helper and native campaign GREEN | Serialize root calls with transaction admission; replace quiet-time inference with notices, ensure replies and accepted apply-lock barriers. |

Source reads are checked after authored actions and correlated native recovery.
Asynchronous consumer rows/receipts and direct durable rows/metadata are checked
after settlement. Shared model storage supplies expectations; production
metadata or reload classifiers do not. The model, grammar, recorder and
comparison fully encode the declared bounded obligations. No known reachable
in-scope counterexample remains. This is finite evidence, not a universal proof.

The declared native scope is one process, two Browser coordinators, native
SQLite, BroadcastChannel/Web Locks, partial/full/on-demand lanes, and a bounded
source-commit-to-notice/recovery schedule. Arbitrary response/application
interleavings, expiry/cancellation/cleanup during recovery, transport/leadership
loss, Chromium OPFS, Electron IPC, restart semantics and necessity of gap
detection remain outside it. The native constructive receiver uses core holds;
the broader controlled owner retains store/read holds. Broader #2272 receiving
coverage is not claimed closed.

## Lossless item dispositions

All six raw metadata items were rechecked against the pasted source, final diff,
contract and evidence. Original claims/proposed fixes remain verbatim in
`claims.jsonl`; the table below does not replace them.

| ID | Technical verdict | PR action and durable value |
| --- | --- | --- |
| META-EXT-2303-001 | Confirmed emitted write amplification and unconditional map copy | **fixed-now**. Remove materialization, not selectively store seeds. Preserve direct durable comparison and 2/100/10,000-row work controls. Counts measure emitted mutations, not elapsed SQLite time. |
| META-EXT-2303-002 | Proposed missing-update fix refuted under D18/D15 | **refuted**. A full update without explicit metadata intentionally stores none; unknown reload can expose differing cached metadata. Preserve useful update dimension and measured recovery-input coverage. |
| META-EXT-2303-003 | Confirmed conflict with D18 | **fixed-now**. Same serializer removal as 001, distinct raw ID retained. Local seed presence/absence remains separate from durable metadata. Actual restart and every peer-path behavior are not claimed from a durable snapshot alone. |
| META-EXT-2303-004 | Confirmed scarce completed bare-seed premise | **fixed-now**. Constructive successful reach on both hosts; no older budget or guard removed. Sampled notices are not a Cartesian guarantee. |
| META-EXT-2303-005 | Confirmed SQL fixture isolation and quiet-time premise flaws | **fixed-now**. Root/scoped SQL admission and actual correlated processing cuts; original fixture rejected. One legal serialized schedule does not represent all independent-connection schedules. |
| META-EXT-2303-006 | Valid P3 maintenance suggestion | **confirmed-open**, optional user gate. Fresh patch/metrics preserve a narrow shared runner, unapproved/unapplied. No demonstrated behavioral defect. Alias META-EXT-006 is the same item. |

Sibling records remain separate:

- **META-SIB-2303-001 — refuted production diagnosis.** E07/E08 initially
  suggested a native recovery bug; E12 established the actual D15 input.
  Original traces and correction are retained.
- **META-SIB-2303-002 — fixed-now model gap.** Actual no-delta recovery input
  was absent from the model history. It is now recorded and compared using
  independent model storage, calibrated by I08 and reached 96 times per native
  campaign.

Prep review findings **META-PREP-CR-001** (stale executable-oracle prose) and
**META-PREP-CR-002** (withdrawn behavior in the inherited release note) are both
**fixed-now**. Their v1 source reports and IDs are retained. The v2 independent
review found no new issue; the v3 narrow documentation audit required no change.

Raw-item accounting: **6 = 4 fixed + 1 refuted + 1 confirmed-open optional
maintenance item**. No raw duplicates, deferrals or unresolved law decisions.
Separately: two prep findings fixed; one production sibling diagnosis refuted;
one sibling model-input gap fixed. Item accounting is complete. The optional
user decision and any resulting refactor validation remain outstanding.

## Verification on the current-main composition

| Evidence | Result |
| --- | --- |
| I01 native / I02 controlled, before serializer removal | Intended durable metadata assertion RED on composed original PR |
| I03 native, SQL helper and work files | 12 passed |
| I04 complete controlled persisted file | 74 passed, 306 seconds |
| Fixed/random durability | Each of 36 case/lane states reached 8 times per campaign on both hosts; native recovery state 96 each |
| I05 scoped TypeScript | Passed |
| I06 `pnpm --dir ../.. lint:changed` | Passed, no reports |
| I07 original composed serializer | Intended durable assertion rejected on both hosts |
| I08 ignore model recovery input | Intended source-read assertion rejected at commit |
| I09 drop explicit durable metadata | Explicit-write controls rejected |
| I10 native / I11 controlled direct replay | Seed 2220031, path `0:0:0`, GREEN after exact restoration |
| Whitespace and protected main-file identity | Passed |

All calibration outcomes were inspected as assertion mismatches, not inferred
from nonzero exits. `current-main-mutant-restoration-v2.json` records restored
serializer/model hashes. Historical E-series checks remain labeled historical;
E14's interrupted run is credited with no verdict. The earlier resource
concurrency mistake and correction remain in `resource-concurrency-correction-v1.json`.
All current-main heavy commands used slot 3 serially, one worker per Vitest.

There is zero production-source difference against main, so no shipped-byte
increase requires a package build. Test/docs growth is reported separately in
the final patch. No release note is needed for the final test/model/fixture
scope; the withdrawn original release note is removed as an ordinary follow-up.

## Reviewer assessment

**Hire recommendation: yes for review work, with contract verification before
applying fixes.** The reviewer found a decisive D18 violation, a real fixture
integrity flaw, scarce reach and useful maintenance work. That is good depth
and signal. Prioritization would improve by leading with D18 and fixture
integrity. The conditional seed-materialization cure for item 001 and the
update-materialization cure for item 002 conflict with accepted law. The latter
still exposed valuable missing history coverage. Useful counterexamples do not
validate those proposed repairs.

The independent prep reviewer supplied two accurate documentation/versioning
findings and kept source review distinct from unexecuted runtime evidence.
The simplifier preserved host-specific premises and supplied a complete narrow
patch with measured source cost; it did not apply it without approval.

## Remaining prep-pr gate

The only surviving optional suggestion is **P3: share the existing
seed/re-insert/reload campaign runner**. It removes 1,321 raw test-source bytes
and eight net lines, adding one 99-line support module and one callback
boundary. It changes no production code. Registration/replay filters, original
40-run budgets/guards, new 8-run durability campaigns and native-only recovery
reach remain in place. Recommend Add for the maintenance benefit.

Root can now present that suggestion one at a time under prep-pr's
"Add it or skip?" gate. If accepted, apply
`prep-simplification-meta-ext-006-current-main-v2.patch`, then rerun the complete
host files, direct replay, scoped types, lint and serializer sensitivity before
moving on. That patch predates only documentation additions, so verify exact
source applicability first. Earlier reach-helper approval does not approve it.

After the optional choice is resolved, root owns the later user confirmation,
commit, changeset/PR-body and published-head/CI gates. No such action occurred
in this delegated task. Current metadata evidence is ready for that walkthrough;
whole-PR merge readiness remains unproven.
