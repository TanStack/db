# Independent source review: metadata update preparation v2

**Verdict: accepted for the next separately reviewed native preparation step.** V2 closes R1's per-history enforcement gap. No additional blocking source-preparation finding remains within this bounded review. This verdict does not admit a native command, production change, receiving result, actual update reach or production-mutant kill.

Reviewed source root: `H/metadata-update-source-v2/sources`. Freeze SHA256: `4ae26549a4edc1565ef08ca7f1b096f7b644b32773fa520d688431335aa5bd8a`. Inventory SHA256: `c5cdea6b41d82b331435162ea06b9254be96acff7b7450be79e0c37690cb74b2`. `H` is `docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1` in the survey coordinator worktree.

The accepted plan/design review and preserved v1 source review still apply. V2 changes only the metadata checker and metadata test runner relative to v1; the driver, ordinary model, property registry and all other source members retain their v1 bytes. Both source epochs and the original receiving worktree remain preserved.

## R1 is closed at the instrument boundary

The shared metadata observer now owns `requireComparedPublications` and `finish()`. Its obligation comes from the authored history: any defined follow-up quarter requires `followupCompared`, even if no `followup-start` receipt arrives. `followupCompared` becomes true only after both output snapshots, exact accumulated message deltas and the actual positive update/full previous-value checks have completed. Quarter zero must also complete its no-op comparison.

The observer checks required publications before accepting `worker-cleaned`. Its unconditional `finish()` additionally requires normal worker cleanup. The native runner calls that finalizer after successful outcome validation for every history. Fixed inputs, each generated history and direct replay use the same path. Campaign-wide reach remains a separate measured-coverage check; it cannot supply another history's missing comparison. Earlier observation or outcome failures remain primary because finalization follows successful outcome validation.

The author's pure helper now invokes the same finalizer instead of adding a stronger per-history all-states assertion. It retains the original previous-value controls and adds whole-stage, missing-final and missing-worker controls. Source inspection therefore supports calibration-path alignment.

An independent bounded pure challenge confirms the distinction. It loads only allowlisted pure models/checkers with a Node strict-assertion adapter, reproduces the streamed root/downstream/metadata observer and outcome-check order, and uses no aggregate reach. It accepts 12 lawful original/positive/no-op controls in each epoch. For four cache/key lanes and quarters zero/two, it then removes the entire contiguous optional stage, only its final comparison, or worker cleanup: 24 wrong observations per epoch.

| Pure instrument epoch | Lawful controls accepted | Wrong terminal observations rejected | Failure cut |
| --- | ---: | ---: | --- |
| Preserved v1 | 12 | 0 of 24 | All missing obligations were accepted without aggregate reach. |
| Corrected v2 | 12 | 24 of 24 | Missing stages/finals fail `declared follow-up publication was not compared`; missing cleanup fails `metadata worker cleanup was not observed`. |

These are authored-observation instrument results, not production RED/GREEN or receiving results. Exact corrected probe outputs are `metadata-update-terminal-probe-fixed-v1.json` (SHA256 `8541ddb2babfadadd76b56d8b052eb037fdca26109dab5c9f693cba13f42f93d`) and `metadata-update-terminal-probe-fixed-v2.json` (SHA256 `3571fba0aa69cda57bddf9d944eeaa0bffbb0d8200211e672e862563f061482e`). Their executable `.mjs` sources remain beside them. The first probe's phase-prefix removal mistakenly left positive callbacks after removing their start; its setup failure and scripts are preserved separately in `metadata-update-terminal-probe-first-attempt-v1.json`. Only the corrected contiguous-interval probe supplies the table's result.

## Preserved design and byte evidence

The v1 review's supported findings remain valid: expected ordinary values come from authored facts and the independent relational model; the checked reload-final baseline and default keys are locked before follow-up; authored keys remain independently predicted; actual source sync updates and applied receipts are observed; finite provider service and live acquisition settlement are retained; and complete root/downstream callbacks and final snapshots use the unchanged shared metadata judgment. No source commit or cache-quiet shortcut establishes graph publication by itself.

The original four replacement histories, four positive and four no-op follow-ups, and separate fixed/unseeded eight-history campaigns for each cache/key path remain. There is no budget reduction. The four added replay properties and direct replay behavior remain unchanged. The original strict progress failure is not converted into a metadata verdict.

`metadata-update-source-read-audit-v2.py` and its JSON output independently rechecked all 588 successor files, the 573 original frozen files in their original worktree, all 511 unchanged production files, exactly five changed original members, 15 unchanged support additions, all 2,544 named dependency own-payload hashes, four dependency reuse links and the Node executable hash. The source inventory and predecessor freeze identities match. No reviewed source or author artifact was modified by this review.

The author records final TypeScript and scoped ESLint exits zero and 32 accepted / 140 rejected pure controls plus 6,720 modeled receipt histories. This review inspected and hashed those artifacts; it did not repeat the full static or pure campaign. The independent additional execution was the small terminal-omission challenge above. Named-byte equality is not full transitive/native/host equivalence.

## Requirement account for this bounded preparation

| Requirement | Review outcome |
| --- | --- |
| ORC-001 authority/limits | Supported by existing VirtualRowProps, public previous-row description, coherent publication and accepted structured-projection attribution decision. Direct source/stable-metadata limits remain explicit. |
| ORC-002 independence | Supported in source: ordinary recomputation uses authored facts; metadata attribution uses authoring shape; follow-up keys and expected before-state are locked rather than learned from follow-up output. |
| ORC-003 literate responsibilities | Supported in source: prose distinguishes the law, model, bounded grammar, actual driver observations and comparison cuts. |
| ORC-004 grammar | Original inputs, quarter no-op/positive neighbors, separate lanes and translation/scale domains are retained. Pure authored receipts cover the finite model domain; actual generated reconstruction and marginal reach remain unexecuted. |
| ORC-005 path/observation | Source wiring and per-history completion are supported, including R1's pure distinction. Actual native path, update messages and graph cut remain UNREACHED. |
| ORC-006 calibration | Author pure controls plus independent terminal challenge support checker sensitivity. No actual production mutant result is supplied. |
| ORC-007 campaigns/replay | Same per-lane fixed/unseeded property and budget, registry and direct replay wiring are present. Native execution, sampled seeds/shrink paths and an actual direct replay remain pending. |
| ORC-008 minimal state | Checked baseline, locked bindings, separate observed stage and finalization flags preserve distinctions a missing/reordered observation can expose. The small correction adds no production controller or acknowledgment protocol. |
| ORC-009 vocabulary | Observation stages remain declared abstractions; applied receipt, applied settlement and graph publication stay distinct. |
| ORC-010 fidelity/cleanup | Unchanged supervisor preserves primary failures; finalizer runs only after successful outcome validation. Missing cleanup is independently rejected. Actual native cleanup remains unexecuted. |
| ORC-011 second formulation | No concrete additional shared semantic fault was identified that requires a second relational model for this narrow change. |
| ORC-012 review record | This versioned record binds the exact source and the supported/pending obligations. It supplies no comprehensive native-oracle or bug-class-closure verdict. |
| ORC-013 distinguishing witness | Positive/no-op ranks and missing/current/stale previous values distinguish the bounded row law; the terminal omission challenge distinguishes R1's wrong enforcement. Broader metadata transition claims remain excluded. |
| ORC-014 receiving handoff | Real QueryClient driver wiring is present. Actual direct-source receiving witness remains pending; QueryClient-fetched marker updates, adapter-origin transitions and frameworks retain their existing gaps. |
| ORC-015 reach | Four independent path counters and post-comparison update reaches remain; every successful history now requires its comparison independently. No new generated native reach count exists. |
| ORC-016 law-only files | Retained fixed inputs and generated inputs use the shared model/driver/comparison; pure hostile observations calibrate those judgments. No ordinary expected-answer tests were added to oracle files. |

## Remaining native gates and claim limits

Native name discovery, a reviewed successor launcher/provenance packet, and coordinator admission precede any receiving command. Source-derived test names or inert recipes provide no native name evidence. No receiving command is admitted by this source review.

Scope same-key GREEN on unchanged production would calibrate this new path; it would not invent a metadata RED. Strict follow-ups and generated terminal metadata remain blocked if the accepted queued-progress failure prevents the follow-up. A progress repair needs its own causal, oracle-first, ownership and atomic-publication evidence. Native previous-value mutants must reach actual same-key root and downstream messages separately at the shared full-row comparison. A root failure, timeout, unreachable callback or pure wrong observation supplies no downstream mutant credit.

The new rank change is a direct eager source update through the established QueryClient graph. It does not receive a QueryClient-fetched marker update or cache-reconciliation update. Output metadata is stable; copying current metadata onto the correct preceding ordinary row is equivalent here. The full-current-row mutant can fail due to rank but cannot establish sensitivity to a distinct metadata transition. Held reload overlap, second reload, optimistic/source transitions, other providers/schedules and framework receivers remain outside this evidence.

This review performed source/document reads, read/hash audits, and bounded pure Node checks only. It executed no native test registration/list, Collection, QueryClient, receiving driver, supervisor, production mutant, install, Git/worktree operation, canonical survey refresh or publication. The coordinator retains the documentation lint gate. No production behavior or original evidence was changed.
