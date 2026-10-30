# PR #2314: high-effort review evaluation

The supplied review targets `dbcf34a15f766b25765aa109b7f243710fef40a2`. Evaluation began at pushed head `f2c51186921b2a863b0ccd5bfb065b5402650260`. The implementation and executable evidence below are in **bb2fdcb8f618c2d986a784a5321741570dbb8dec**; this record is a subsequent documentation commit. All ten source-order candidates are retained. The report's summary said nine, and its numbering repeated 3 and 4. R1–R10 below preserve their source order.

## Laws, experiments, and inference

The maintainer made two explicit decisions during this evaluation:

1. Independent React Suspense bindings distinguish all supplied Collection options for local sharing. Object/function declarations compare by exact reference; scalar declarations compare by value. Undefined options are absent, and omitted automatic indexing is off. Portable query identity stays unchanged. Mounted bindings retain options until query identity changes. Reusable DbClient results retain their existing getKey/schema conflict rule.
2. Every `DbClient.preloadLiveQuery` call rejects eager indexing without a constructor, even when it can reuse pending or settled rows. This supersedes the construction-only limit in the earlier indexing record; that historical record remains intact.

| Law and authority | Earlier protection and missing distinction | Decisive experiment | Repair and enforcement |
| --- | --- | --- | --- |
| Each independent Suspense caller receives compatible local Collection behavior. Authority: decision 1; existing same-identity cached-result conflict decision from PR #2171. | Indexing receiver checked two indexing fields, not other local options. Ordinary React/server cache receivers did not enter Suspense's local sharing path. A rejected caller could install a cache entry before its DbClient admission failed, poisoning later original reuse. | Final original-production receiver run: **206 assertion failures, 1,108 controls pass** across 1,314 histories. This includes 64 warm cached-result failures and 142 local-option failures. A narrow patch qualifying only indexing/getKey/schema still fails **110/348** local-option histories. | Qualify the local key by all supplied options, source-object tokens and portable query hash. Normalize defaults; use exact object/function tokens. Warm admission, rejected retries, original rows, two independent outputs and retained first config all receive real React witnesses. |
| Forbidden output reuse must be rejected as well as required reuse. Authority: existing explicit queryKey and indexing-sharing model. | `expectIndexingReuse` compared only the model's true branch. Admission and config checks could not reject sharing between compatible declarations under different keys. | Old checker accepts 164 opposite-identity observations. A real mutant that removes query hash from the local key passes **all 534** histories with the old checker. The repaired checker rejects **28** histories/506 controls pass. | Compare negative identity for two admitted outputs. Rejected declarations have no output identity; applying unconditional `not.toBe` to two undefined outputs would be wrong. Keep all 178 different-key histories; 28 are the violating compatible-config cases for this mutant. |
| Eager declarations require a constructor at every preload admission. Authority: decision 2 and Collection indexing's constructor requirement. | Construction enforced it; an existing row record bypassed construction. No preload receiving witness compared that checkpoint. | Expanded shared-model receiver against unchanged production: **32 assertion failures/427 controls pass**. Pending and settled warm results both bypassed the invalid declaration; cold and different-key invalid calls rejected. | Share Collection's validator with preload admission before cache lookup. The same **459 histories pass**, and all 432 warm histories preserve the original preload promise after the second admission. |
| Mounted options bind until query identity changes. Authority: React migration/identity docs, prior inline-option decision, bound-options owner. | The indexing receiver explicitly excluded rerenders, although the broader first-options contract existed. | All **534** indexing histories pass unchanged production with added rerender/rebind cuts. | Preserve this policy. There are 480 admitted-first histories checking retention and 432 two-valid-declaration histories applying settings after a real queryKey change. No option-only rebuild or warning was added. |
| Output indexing follows one opt-in policy and distinct ordered requests reuse indexes. Authority: approved #2292 output API and existing Collection rules. | The core receiver repeated the small admission/default policy and scattered count/availability assertions. A single completion tag conflated rejected declarations and output reads. | Existing core histories remain green. Sixteen calibration histories reject an extra index and the opposite optimized-read availability through the shared comparisons. Equal-name registration calibration fails twice with the original name-based labels. | Reuse shared policy/grammar, retain independent array sorting, derive count from distinct requested specifications, and split `rejected`/`output-read` reach. Labels describe grammar roles instead of Function.name. |

These laws are separate. Local compatibility does not enter the portable hash. Distinct live callers without a reusable DbClient row record may own separate outputs; the cached-result conflict rule applies when a reusable record exists. The authored query owns list/single result shape. This review does not claim that a singleResult config annotation rewrites that query.

## Scope and declared reach

- Shared indexing policy exhausts nine mode/constructor declarations. Core construction crosses direct/options entry points: 16 valid histories reach output reads and two reach rejection, eight/one per path. Ordered consumers read two projected fields, both null placements, repeat a specification, and observe a later source update. The independent model sorts plain values; it imports no production comparator or index selector.
- Real React, Preact, Vue, Solid, Svelte and Angular each receive all nine declarations at their settled flush cut. Each case asserts its own admission/read reach. Focused runs for the five frameworks other than React each pass nine cases; React's full suite includes its nine.
- Suspense indexing keeps 534 histories: 486 built-in pairs plus 48 distinct same-name-constructor pairs, across two scopes and three identity relations. First/second admission and retained-first reach apply to every history. Retained-options and rebound-options reach apply to the 480/432 legal mounted cases above.
- The existing local-cache owner now has a real Suspense independent-output receiver: **348 histories, 174 per scope**, covering every non-indexing field in the public config type. Compile-checked fixture keys prevent a new field from silently missing this driver. Six reference/presence pairs cover each field; singleResult admits only its legal absent/true declarations. First output, second output and retained-first reach each cover all 348 histories. The indexing owner supplies the two indexing fields separately.
- Warm React cache receivers now have 144 histories per ordinary mounted, Suspense and server-render path, each checking admission, retry and original reuse. Both mounted paths check settled rows. They use the shared getKey/schema declaration model.
- Core preload receives 459 histories: 27 cold, 216 pending and 216 settled. All reach admission; all 432 warm histories reach original reuse. There are 51 invalid declarations, including the 32 original warm counterexamples. The driver holds source writes, not merely a returned Promise, and checks that the prior preload started that source.

Bounds remain explicit: initial bindings, one source/query, finite option references/scalars, ready-source React Suspense and held/settled core preload delivery. The new receivers do not establish arbitrary hydration/SSR scheduling, every framework's option updates, semantic equality of separately allocated callbacks, or malformed configurations beyond the eager-constructor rule. Existing source-ID, bound-schema, lifecycle and query-shape owners retain their contracts and budgets. No known violation remains in these declared repair boundaries.

## Lossless item ledger

File/line references identify the supplied review, not final source positions. Severity here is this evaluation's judgment, not a claim that the candidates were verified before intake.

| ID | Original claim and suggested fix | Technical verdict/evidence | PR action | Durable value/destination |
| --- | --- | --- | --- | --- |
| R1 | `useLiveQuery.ts:80`: key omits getKey/schema, mutation handlers, id/startSync/gcTime; same-query callers share first output. Key every output-shaping option. | Confirmed omission and public mismatches. Broad separation needed an explicit policy decision; maintainer approved it. Warm rejected-caller poisoning also violates the existing reusable-result rule. Medium correctness priority. | `fixed-now`: general local qualification, shared model and both receiving regimes. | Full non-index field inventory and narrow-mutant rejection in the existing cache owner; no new portable identity contract. |
| R2 | `useLiveQuery.ts:661`: indexing changes after mount do nothing and no warning occurs. Honor or warn about changes. | Behavior reproduced, but it implements the approved first-options rule. A queryKey change applies the new options. | `accepted-design`: preserve behavior; add receiving evidence and public guidance. | 480 retention and 432 rebind histories; the reviewer found an exclusion, not an unapproved product defect. |
| R3 | `live-query-options.ts:347`: even `autoIndex: undefined` disables requested pooling; guide omits it. | Confirmed four-case probe. Public hook type already states that any option beyond query/gcTime/pool compiles its own Collection. Missing guide discoverability is real; silent feature incompatibility is not a new indexing defect. | `fixed-now`: guide explains key-presence opt-out; three ordinary config tests preserve undefined/off/constructor-field cases. | Conservative eligibility, distinct from Suspense value normalization. No pooling implementation or budget changes. |
| R4 | `client.ts:524`: warm eager/no-type preload succeeds while cold rejects; prior evidence mentions it without a test/map entry. | Confirmed cold/warm asymmetry. The earlier record explicitly limited the law to construction. Maintainer now approved admission consistency. | `fixed-now`: shared validator, 459-case receiving oracle and coverage-map entry. | Pending/settled, all prior valid settings and distinct-key controls; historical record is not rewritten. |
| R5 | `indexing-config-oracle.ts:113`: negative reuse absent; different-key over-sharing mutant survives 178 histories. Add not.toBe whenever reuse forbidden. | Confirmed false-green assertion. Real mutant passes all 534 with the old checker, fails 28 with repaired checker; all 178 different-key histories ran, but only compatible ones violate this mutant. Unconditional negative assertion would mishandle two rejected outputs. | `fixed-now`: compare negative identity for admitted outputs, retain positive sharing and invalid controls. | 243 opposite-relation calibrations plus real React production-mutant witness. |
| R6 | `custom-index-order-selection-oracle.test.ts:439`: eager ? 4 : 0 and toBeUndefined are handwritten expected values; forbidden unit tests inside oracle. Derive observations from model. | Partly valid: generated cases already used the independent window model, so these were not standalone pinned unit tests. Scattered policy obscured responsibility and hardcoded four distinct requests. | `fixed-now`: shared admission/config policy; declared request-count and availability model/comparison with 16 hostile-observation histories. | Generated request specification, not a constant moved into a fake model. Source index count is compared with its pre-read count. |
| R7 | `custom-index-order-selection-oracle.test.ts:288`: IndexSettings, grammar and off/eager rules duplicate shared owner. Import them. | Confirmed maintainability issue. Duplicating two test policies is not itself a production/model independence violation, but drift was avoidable. | `fixed-now`: reuse the shared type, nine-case grammar and policy. | Independent sorting remains separate; model reuse does not import production classifiers. |
| R8 | `custom-index-order-selection-oracle.test.ts:334`: configured counts completion of rejected and read branches, not law state. Split tags. | Confirmed reach-reporting weakness. Original assertions did execute both branches; the label did not distinguish their premises. | `fixed-now`: require rejected or output-read at the actual cuts, 2/16 construction histories. | Honest admission/read reach instead of a completion count. |
| R9 | `suspense-indexing-config-oracle.test.tsx:86`: 534 two-mount histories are expensive; reduce through equivalence classes. | Cardinality is correct: 1,068 renderHook calls. No excessive-work requirement or regression was demonstrated. Focused extended receiver took about 3.4 seconds; counts alone do not prove waste. A reduction would need to preserve explicit-default normalization, invalid neighbors, exact constructor refs, key/scope crossings and both participants. | `refuted` as a required performance repair; no reduction. | Preserve factorization idea here. No claim that 534 is a mathematical minimum, and no run budget is lowered. |
| R10 | `indexing-config-oracle.ts:148`: Function.name labels can collide under minification, notably Svelte's built receiver. Use fixed labels. | Conditional collision reproduced by equal-name constructors; original labels fail both calibration cases. The review supplied no particular Svelte minifier output proving an actual collision. | `fixed-now`: semantic constructor-role labels. | Registration invariance under renaming, plus all six real framework receiving runs. |

Loss audit: **10 raw items = 8 fixed-now + 1 accepted-design + 1 refuted.** No item is merged away. No confirmed-open, stale, deferred, duplicate or unanswered design decision remains. Sibling rejected-caller cache poisoning is repaired under R1's existing law; it is not hidden as an unrelated pre-existing problem.

## Process and calibration fidelity

The task-local append-only ledger was created before testing or editing. The whole-review plan grouped admission/sharing, retention/pooling, policy integrity and grammar cost before individual repairs. No production edit preceded the initial receiving runs.

Two driver assumptions were corrected openly. An initial peer-mounted cache path applied the warm-result conflict model without a reusable record; its 64 failures are not valid rejection evidence. Independent peers belong to the local-sharing receiver instead. A later inventory check initially inferred list/single shape from a config annotation; that is not the query builder's findOne action. These were driver-law mistakes, not product REDs. The corrected 1,314-case comparison was run against restored original production and supplies the 206 genuine failures above. The final broader field inventory was added after the first repair attempt and calibrated against original production before further runtime refactoring; it is not presented as having been in the first pre-edit gate.

Temporary mutations restore source in finally blocks; no branch reference was moved. Outcomes:

| Subject | Outcome | Classification |
| --- | --- | --- |
| Original production, final React grammar | 206 fail/1,108 pass | Config, identity and original-reuse assertion failures. |
| Original warm preload | 32 fail/427 pass | Immediate admission assertion failures; no provider timeout. |
| Key ignores query hash, old reuse checker | 534 pass | Surviving production over-sharing mutant; not repaired-branch GREEN. |
| Same mutant, repaired checker | 28 fail/506 pass | Intended identity comparison; compatible different-key bindings distinguish it. |
| Key qualifies only indexing/getKey/schema | 110 fail/238 pass | Narrow-patch rejection across remaining local options. |
| Original Function.name labels | 2 fail | Registration-label assertion; no minifier failure claimed. |
| Extra index/inverted optimized availability | All 16 calibration histories reject both wrong observations | Checker calibration through the same policy/window comparisons. |

The error census initially reported one failure solely because code 206 moved from collection/index.ts to the shared validator. Only that fixture's file field changed. Its class, code and full message remain unchanged; the final census passes. Initial typecheck errors (unused import and invariant Collection test holder) and an ESLint/build race were setup/implementation feedback, not product RED evidence. They were fixed and rerun.

## Verification

Runtime commands use `--coverage.enabled=false --typecheck.enabled=false --maxWorkers=2`. Typechecking is separate:

- React full suite: **4,039 tests/34 files pass**.
- DB selected admission, cache, indexing, options and production-error suites: **5,185 tests/7 files pass**.
- Non-React framework focused conformance: **nine cases each** in Preact, Vue, Solid, Svelte and Angular. React's nine are included in its full suite. Unselected conformance cases are not claimed as executed by these filtered commands.
- `tsc --noEmit -p packages/db/tsconfig.test.json` and `tsc --noEmit --rootDir . -p packages/react-db/tsconfig.json`: pass.
- Production error bundle check: 263 literals (22 shared) erased in production and retained in development, in ESM and CommonJS.
- Changed-file ESLint, `pnpm lint:changed`, Prettier and diff whitespace checks: pass. No oracle budget was lowered or removed.

DB runtime replay entry points:

```sh
pnpm --filter @tanstack/db exec vitest run --coverage.enabled=false --typecheck.enabled=false --maxWorkers=2 \
  tests/live-query-preload-indexing-oracle.test.ts \
  tests/query/custom-index-order-selection-oracle.test.ts \
  tests/conformance/indexing-reuse-oracle.test.ts \
  tests/live-query-options.test.ts \
  tests/live-query-cache-options-oracle.test.ts \
  tests/production-error-messages-oracle.test.ts \
  tests/production-error-messages.test.ts
```

React receiver replay uses `tests/cache-options-oracle.test.tsx`, `tests/suspense-local-options-oracle.test.tsx` and `tests/suspense-indexing-config-oracle.test.tsx` with the same flags. These are exhaustive finite grammars, not random campaigns requiring seed replay.

## Oracle conformance self-review

This is a self-review under oracle-authoring and oracle-review, not another independent reviewer.

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Authorities, the two new decisions, scope and remaining independent owners are stated above and beside models. |
| ORC-002 | Declaration names/reference relations, opt-in rules and full array sorting do not import production keying, comparators or admission classifiers. |
| ORC-003 | Shared owners state laws/models/grammars/comparisons; real-host files name production paths and observation cuts. Policy assertions are centralized. |
| ORC-004 | Absent/equal/changed declarations, off/eager/defaults, invalid constructor neighbor, same/different key and both scopes reconstruct the reports. Removing any of these loses the named controls or admits a narrow mutant. SingleResult's unsupported other declaration is not generated. Bounds are enumerated above. |
| ORC-005 | Public admission, config references, output identity, original rows and optimized ordered windows are compared at their stated cuts. No data needed for eager validation is held back at admission. |
| ORC-006 | Original/narrow/over-sharing/name mutants and wrong observations fail at intended comparisons; surviving old checker is identified separately. |
| ORC-007 | New/changed grammars are finite enumeration. Existing important random campaigns and budgets are unchanged. |
| ORC-008 | No stateful reference state is added. Distinct declaration references matter because a legal second caller observes them. |
| ORC-009 | Framework binding, query identity, source Collection, live-query Collection, admission and publication terms follow the glossary. Declaration labels explicitly abstract scalar values/runtime references. |
| ORC-010 | Drivers use withOracleCleanup/ScenarioLifetime; primary failures survive cleanup. Held preload delivery is released during failure cleanup before pending promises are joined. |
| ORC-011 | No new plausible shared semantic fault requiring a different formulation was identified. Sorting remains independent; key/admission mutants challenge the new relations. This is not an exhaustive fault search. |
| ORC-012 | This versioned record ties outcomes and limits to bb2fdcb8f618c2d986a784a5321741570dbb8dec, preserves all ten items and identifies corrected driver assumptions. |
| ORC-013 | Equal/unequal/absent options, distinct keys, off/eager and invalid eager neighbors distinguish conditional boundaries; narrow and always-sharing implementations do not pass. |
| ORC-014 | Real React receives the shared models. The six real hosts supply the indexing handoff. Core preload claims stay at the real DbClient/controlled sync boundary, without a remote-provider claim. |
| ORC-015 | Required states are asserted per receiving path/history; counts and legal conditional retention/rebind counts are above. |
| ORC-016 | Regressions and calibrations use the shared laws, not standalone handwritten expected examples. Ordinary pool examples remain in an ordinary test file. |

## Code weight and reviewer assessment

`pnpm size:compare --packages db,react-db` compares production bundles with
merge-base `bfd1da1a7`. DB adds 47 gzip bytes and saves three brotli bytes;
React saves 56 gzip and 50 brotli bytes. **Total: nine gzip and 53 brotli bytes
saved.** The typical app saves 13 gzip bytes and adds 69 brotli bytes.
Feature scenarios vary; this is not a claim that every compressor/scenario
gets smaller.

The smaller internal metadata store uses a WeakMap instead of mutating hook result objects with a private symbol. Existing full React receivers cover the unchanged internal handoff; no lifecycle/error guard was removed for size.

**Hire, with verification and contract-calibration guidance.** The reviewer found a real cache omission, a consequential false-green comparison and useful integrity/maintenance issues. Prioritization put cache correctness first and disclosed that no verifier ran. The findings needed contract history: mounted retention was intentional, warm preload validation needed a new decision, unconditional negative identity was wrong for rejected outputs, and unit-test/minifier/performance claims were stronger than their evidence. The report is useful candidate discovery; its wording is not sufficient as a verified bug list.

Review accounting and authorized repairs are complete. At publication,
**whole-PR readiness remains unproven until the new pushed head completes CI**.
All accepted-law repairs have decisive local witnesses and no product decision
remains pending. The previous head's green CI does not establish the new head's
readiness.

## CodeRabbit follow-up on `80985a1ab`

Review `5717923866`, run `21f44a11-4a65-466f-a493-12f311bfd0b5`, covers the implementation and evidence commits through `80985a1ab`. Its two unverified comments concern wording. Its mutable summary also reports a generic documentation metric. These claims require source and policy checks, not a behavioral oracle or a new runtime experiment.

| ID | Claim | Evaluation and action | Durable value |
| --- | --- | --- | --- |
| CB1 | Format the coverage map's queryKey identifier as code. | Confirmed unformatted identifier; `fixed-now` with code formatting. | Preserve API spelling in prose. |
| CB2 | Hyphenate non-React-focused in the reach report. | The modifier is awkward; `fixed-now` by rewriting the sentence to name the five other frameworks. The proposed compound is unnecessary. | Make the receiving-path count clear. |
| CB3 | Raise docstring coverage from the service-reported 23.53% to its 80% threshold. | `refuted` as a repository requirement: no repository CodeRabbit configuration or docstring threshold exists in AGENTS.md, ESLint configuration, package scripts or CI workflows. The service identifies no specific missing explanation. Its percentage was not independently recalculated. | Retain the advisory metric in the raw task ledger; assess comments for useful explanations rather than adding them to meet an external ratio. |

Loss audit: three distinct suggestions = two documentation fixes and one refuted repository requirement. The raw review, complete mutable summary and generic test-generation/autofix controls are preserved in the uncommitted task ledger. The controls supply no concrete test gap or additional finding. No behavioral claim, runtime repair or oracle budget change is introduced by this follow-up. Production measurements and oracle calibration therefore remain applicable.

Reviewer assessment: no hire on this sample alone. The two wording observations are useful but unverified; the generic metric adds no code-level evidence. This conclusion is separate from the high-effort reviewer's assessment above. CI completion remains a separate final-head check.

## Production size follow-up

This internal refactor follows `a0d2c4e3780307a770ef7734b64a2d4adf5bd3ce`.
The measurements below supersede the earlier size figures in this record.
The indexing, admission, sharing, mounted retention, error and lifecycle laws
are unchanged. No model, history grammar, comparison or oracle budget changes.

- Pass render-local metadata directly from the shared hook implementation to
  Suspense. Delete the private WeakMap module, its setter/getter round trip,
  and its missing-metadata guard. Only that private wrapper could read it;
  an ordinary hook still returns the observer's stable snapshot directly.
  Capture the current client and observer per render, rather than exposing
  the mutable hook instance.
- Consult the shared Suspense cache only when a binding needs a Collection.
  This removes the stored cache key, a reuse branch and duplicate preparation.
  Mounted bindings already hold their Collection and retain its first options.
- Share profiler initialization between ordinary and infinite hooks. Literal
  production guards at initialization and both timing sites let the bundler
  erase the timing state, timer and warning formatter. The warning policy still
  handles unbundled browsers without `process`. Indexing validation and its
  production error remain enabled.

`pnpm size:compare --packages db,react-db --files`, against merge-base
`bfd1da1a7e752d66fd667adfd3cdf54f60732b22`, reports these compressed byte deltas:

| Bundle | gzip | brotli |
| --- | ---: | ---: |
| DB package | +47 | -3 |
| React package | -410 | -352 |
| Package total | **-363** | **-355** |
| Typical app | **-319** | **-186** |
| App with Effect | -309 | -310 |
| App with grouping | -314 | -219 |
| App with includes | -306 | -133 |
| App with join | -334 | -276 |
| App with LocalStorage | -302 | -357 |
| App with optimistic action | -314 | -299 |
| App with paced mutations | -288 | -252 |

All eight measured app scenarios shrink under both compressors. DB alone still
adds 47 gzip bytes for the shared eager-admission check and output options;
the React simplifications more than offset that cost in the package total
and receiving apps. These finite scenarios do not establish the size of every
consumer bundle. Tests and contract documentation are separate from shipped
production bytes; this follow-up changes no tests and only adds this evidence.

Two structural experiments were discarded: consolidating Suspense's three
refs increased package compression cost, and replacing separate unscoped/client
caches with a sentinel scope also grew both compressed package measurements.
A pure annotation on the warning predicate produced no measured improvement
and was removed. No comments or names were shortened to change a size number.

Final verification passes the complete React suite (4,039 tests in 34 files)
with `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=3`, plus React typechecking,
changed-file ESLint, `pnpm lint:changed`, Prettier and whitespace checks.
The preceding default-budget run passed 4,038 tests but failed the streaming
campaign's reach gate: its 40 random histories included zero
`held-suspense-first` histories. That is missing generated reach, not a
production refinement mismatch. The larger campaign preserves every budget
and requires that same reach gate; it does not waive the missing state.
A production bundle inspection confirms that `renderCount`,
`totalMs`, `maxMs` and the removed metadata error are absent. An earlier bundle
probe found the timing loop retained despite the erased initializer; the
literal guards at both timing sites resolve that failed probe. Existing
development timing-warning tests remain in the full React run. This is
behavior-preserving internal work under existing receiving coverage, not a new
bug-class closure claim or a replacement for the original RED/GREEN/mutants.

The separately reported SQLite metadata failure remains outside this refactor:
[#2317](https://github.com/TanStack/db/issues/2317) preserves the replay that
fails identically on the PR and its merge-base. A new pushed head still needs
its own CI results; local verification does not establish whole-PR readiness.
