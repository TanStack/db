# D03 exact frozen packet: independent static acceptance

Reviewer: `/root/review_combined_held_cuts`  
Author: `/root/evaluate_replay`  
Decision: **Accept exactly one D03 invocation under root's existing conditional authorization.**

This acceptance is for `D03-isolated-after-freeze-ready`, slot 3, one worker, 120-second test-process timeout, followed by freeze and STOP regardless of outcome. Root's conditional authorization and this exact acceptance together admit that single invocation; no further root roundtrip is required. This report does not itself execute anything, and it admits no retries or subsequent work.

The accepted packet is in `docs/misfits-repairs/2026-10-29/prep-pr/replay-batch/evaluation/initial-preload-repair-v1/r03-lifecycle-ready-receiver-d03-v1` in the coordinator worktree `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items`. The runtime worktree is `/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-replay-latest-main-v3`.

## Exact identities

| Artifact | SHA-256 |
| --- | --- |
| D03 packet freeze | `e5a6671b959df3d5054a2b98b54b11bab1db62306c48bcd8dab010186fa0230a` |
| D03 input freeze | `fadf58e40e79fb66690d4cec681cc80717c6344e105d479c0e2892efc9c1dd76` |
| Applied primary and candidate snapshot | `0618b4aad166dc6c613ed00df526dc9eb34ab3243e2eb2cafee35115bd7267c0` |
| D02 base snapshot | `12192c5831bec3ccb3beb1e81c25d453097d9125b2e3377f0fb2431997283066` |
| Accepted receiver patch | `feee0370fc5a029dd67a728a18c2ea4122ff51dd9ace0c6cdb440022f5d349a1` |
| Runtime recipes | `8424e22fcd6116627609314d4ceb61abc43c70ee3ba8cc6e7635e2ac219532ac` |
| D03 launcher | `ffe8edcf40b2f7581821493eeb3a2be447c08235920bffa1c3886a547e05894c` |
| Exact archive mapping | `5d176b2fb6fa3f17e4f93047750902df1ccae309b23004b6170ddcf8bff4712a` |
| Archive resolver | `6799d0f221d208bb80d0e5cb6d5c0f2345f4dee82e95d5adec33d57480cef87d` |
| Saved archive calibration | `4a80925e5a1a18a9a0a5f593708360f11203f9c8faf965e3815fc992ec515c60` |
| Static closeout | `678f572987e46731dabafe50b590587d86377f7d223b1f38b50286f374e582be` |
| Root conditional authorization record | `ed00879536579b86c16b7dea029ce7649cfc2b61b679399979dfaa5eb09c2ed4` |

The input freeze binds HEAD `9cfa11fc712866f8f276e85762865ebb8bd49cbe` and unchanged production identity `60d0fa772d95a340042bf3776c67da573cd407ded732dcb4d7f776f5da339a42`.

## Independent checks

I read the applicable oracle review skill, rubric, glossary, author-worktree live-query architecture, coverage owner and limits, subscription lifecycle grammar contract, and repair-location instrument. This review uses read-only source/text/JSON/hash inspection, independent reconstruction, AST parsing without import, and a data-only JavaScript regular-expression check. I ran no test, test listing, compiler, lint, build, generator, mutant, launcher, or source import. I made no source or Git changes. This immutable review report is the only reviewer write.

All 23 packet members match their frozen hashes. All 1,415 current input files match the D03 input freeze. Exactly one input differs from D02: `packages/db/tests/query/load-subset-replay-refinement-oracle.test.ts`. All 511 production inputs and the production identity are unchanged. The current primary, packet candidate, and held proposal snapshot match exactly.

I independently reconstructed the full source diff and the full launcher successor. The source change is confined to `armCoveringAfterVerdict`: the actual registration changes from `loadSubset:error` to `status:ready`, three matching diagnostic event strings change, and a two-line comment changes. That is four strings plus the comment, reducing the source by 16 bytes. Guards, self-removal, frozen receipt identity, actual replacement edges, applied coverage, before-window and before-identity assertions, minimum-one reach, model, history, comparison, budgets, and production remain unchanged.

The launcher reconstruction begins from the accepted D02 launcher `6500f2e2946567b43a0a6fbe3c13be8a1ac26bb0c225ce25ff2bbe8a10b55d81`. Its changes are the D03 label, slot 2 to 3 assertion/receipt, the exact resolver import, and use of that resolver before the original unchanged predecessor-member SHA check. The saved launcher patch equals the independently reconstructed diff. All original predecessor bindings remain preserved. Independently traversing the bindings and recursive packet members checked 37 bindings and 89 recursive members successfully. The launcher and resolver were parsed as Python syntax, never imported or executed.

The D03 argv equals D02 argv, including the selector. A native JavaScript `RegExp` applied only to the saved dynamic full-name inventory matches exactly one intended name and excludes the other 89 of 90. The actual registered target is `Ordered windows across truncate replays > records replay lifecycle cut for 'covering replacement after own freeze…'`. This static selection evidence does not replace D03's actual runtime count and payload evidence.

At the final read-only verification, D03 had neither `admission.json` nor a `runs` directory.

## Individual saved static receipts

I checked each receipt itself, rather than relying on `static-closeout.json`:

| Check | Receipt SHA-256 | Saved exit | Saved seconds |
| --- | --- | --- | --- |
| Types | `3bb61f409dcf130d7fac051ad22fabb16a0a2e904a2c4d7a7af214389cf45770` | 0 | 13.907 |
| Format | `33a022f3806fa3f087a6e51cd7af8e9aab568bea35b2eb67a53d162b6a0dab0c` | 0 | 0.621 |
| Changed lint | `2e6ff2e5f08e48e1dc67a50008d7f20544299405831cb63a4fea7247f8c44c5a` | 0 | 42.112 |

Each receipt has the exact expected command, author worktree cwd, slot 3, D03 input-freeze hash, empty saved `TANSTACK_DB_ORACLE_*` environment, and both complete 1,415-entry maps equal to the D03 freeze. Each log hash matches its receipt and closeout. The types log is empty; format reports all matched files formatted; lint records the agent-lint-feedback command without a diagnostic. These are saved author executions, not reviewer reruns.

The static runner uses `subprocess.run(..., timeout=180)` and writes a receipt after return. It does not record exception or process-group fields, so these static receipts establish no separate process-group census or exception field. No such field is inferred from their absence. The D03 runtime launcher separately records exception and process-group observations and performs process-group cleanup.

## Exact archive resolution

The copied map and resolver equal the accepted migration assets. The migration preserves four historical inert source mirrors under `.test.ts.source-snapshot.txt`; the executable old `.test.ts` paths remain absent. All original manifests, reports, receipts, runners, logical paths, and expected hashes remain immutable. Earlier independent archive inspection reconstructed all four historical directory inventories under their original logical projections: v1 19 files, v2 10, v3 19, v4 38. It also checked all seven migration evidence assets and all 27 original v4 packet members.

Static branch inspection shows exact resolved-original-path selection, rejection of ambiguous bindings, a mapped expected-hash check before reading, byte-hash verification, and mapped byte-count verification. Unknown paths retain the original direct path; an unknown missing path therefore fails at the read. No fuzzy substitution or TypeScript loading is present. The launcher checks the packet's map/resolver hashes before using resolution in the predecessor-member loop. The top-level resolver import defines functions only.

I independently checked that the saved calibration's four successful rows equal the mapping and the current inert bytes/hashes/sizes, that its four mapped-hash rejection cases name exactly those rows, that its unknown missing path remains absent and unmapped, and that its direct-hash rejection names an existing unmapped input-freeze asset. I independently reconstructed its 27 v4 member paths and hashes. The saved calibration reports four mapped expected-hash `ValueError` rejections, one unknown-missing `FileNotFoundError`, and one direct-existing hash `ValueError`. These exception outcomes are saved author calibration evidence, supported by static branch inspection; I did not import, execute, or rerun the resolver. Unknown missing identities and hash mismatches fail closed.

## Source account and limits

The source supports the ready callback as a candidate receiving seam. `recordLoadSubsetError` synchronously stores/emits the failure, and future-only registration does not replay it. In D02 the last error existed before registration, and the remaining responses succeeded. The marker adapter records its independent authored settlement after applied commit and before its async result reaches core. Core's ordinary result observer precedes the replay participant observer; own replay completion decides failure before the final `setReadyIfIdle`. Specific ready delivery is synchronous, while the public window Promise reactions are asynchronous.

This account does not guarantee the intended covering interaction. Generic status delivery may reenter, change the revision, and suppress specific ready delivery. Commit may remain asynchronous. The prior ready witness was noncovering. D03 must measure actual entry, guard decision, exact failed own receipt, real applied covering replacement, callback return, public window rejection, and identity comparison in this covering history. Missing reach remains a failed instrument premise. Diagnostic Error number 34 is local evidence, not a product constant.

Original R03 remains a model/comparison false RED. D01 remains a selection failure with no lifecycle evidence. D02 remains missing receiving reach, not production RED. None of those classifications is revised by static acceptance. No lifecycle campaign has been credited.

## Admitted invocation and mandatory stop

The author may create the admission record binding this report and invoke exactly once:

```text
python3 <D03 packet directory>/run-corrected-isolated-diagnostic.py D03-isolated-after-freeze-ready
```

The frozen underlying command, from the author worktree's `packages/db`, is:

```text
pnpm exec vitest run tests/query/load-subset-replay-refinement-oracle.test.ts --coverage.enabled=false --maxWorkers=1 --silent=false --reporter=verbose -t "records replay lifecycle cut for .*covering replacement after own freeze"
```

Resources are slot 3, one worker, and 120 seconds. Required actual selection is one selected, 89 skipped, 90 registered, with exactly one complete intended lifecycle payload. Preserve raw log, receipt, source/environment/group observations, extracted payload, chronology, and immutable result freeze for subsequent classification. A zero exit, saved listing, or missing payload does not establish GREEN. Missing receiving reach does not establish production RED.

**After that one invocation: freeze and STOP, regardless of outcome.** No unreviewed receiver change, repair, retry, listing, campaign, sensitivity run, mutant, production change, source/model/reach/checker/history/budget change, commit, push, publication, or PR step is admitted. No native Promise-engine settlement, cross-owner ordering, natural-controller selection, receiving/minified coverage, broad closure, or PR-ready claim follows from this acceptance or the prospective single result.
