# Persisted option type preservation: PR #2259

Reviewed PR head: `e3e8a9b5bce0a99d889b73f6eb7578b6d7ef3769`.
Original defective parent: `d2935d0fcac164163adc231c6a796b8a4c234d9b`.
This self-audit covers the oracle migration built on that head. Production
`persisted.ts` is unchanged from the reviewed PR after all temporary mutants.
Optional raw logs remain in local scratch storage. This versioned record and
the calibration command below preserve the verdict-critical reproduction steps.

The initial migration record below precedes the prep-pr follow-up at the end.
That follow-up supersedes its owner hash, construction counts, and scoped
readiness assessment while preserving the earlier experiments.

The migrated executable owner has SHA-256
`c164515bf9705864bd5f0b27dc6e7769d1f7214cfba8158130fb12b36c04c9a0`.
The replay registry has SHA-256
`53837b427c149964cd6dda52c7f87d71de57626790c48012527d1d2028f90889`.
These identify the historical initial instrument. Later sections explicitly
supersede them. They are not hashes of the current owner.

## Law, experiment, and inference

The SQLite guide's **Add persistence to a synced Collection** example composes
adapter options with `persistedCollectionOptions` and `createCollection`.
The public `createCollection` contract assigns schema input to insert, schema
output to reads, and the configured key and user utilities to callers.
Wrapping must preserve those roles, including when the caller has no schema.
The existing public persistence option types also require a present `sync`
property to contain a `SyncConfig`.

| Existing evidence | Decisive experiment | Inference and repair |
| --- | --- | --- |
| Eight fixed core configurations and two browser configurations checked broad string/number keys. | Change only the schema-free result key types to `TKey extends string ? string : number`. All eight original core tests and both original browser tests pass. | Their expected answers do not generalize key preservation. Generate key domains and compare exact public key types with the independent input model. |
| Browser tests restated their expected types. | Run browser source exports and real Query Collection options through the same generated law as core. The parent implementation fails with TS2769 at `createCollection`; the PR implementation passes. | A receiving driver can share the model and comparison. Separate browser expectations are unnecessary. |
| Schema-free results must retain their row/key/utility contract without damaging schema-bearing options. | Restore either original overload, erase utilities, or return `never` from both schema-bearing overload results. Each mutant fails the generated comparison. | The repair must preserve both persistence modes and the neighboring schema-input/output law. |

The primary executable owner is now
[`persisted-options-type-oracle.ts`](../../../packages/db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts).
Its generated TypeScript model declares input/output rows, keys, and utility
signatures without importing production inference helpers. Its comparison
checks exact insert input, exact `get` parameters, the optional non-null read
result, the complete documented published-row shape, absence
of `any` reads, and supplied utility signatures. Generated invalid row, key,
utility, and sync expressions must remain compiler errors. The real Query
Collection driver additionally checks exact utility namespace preservation before/after
wrapping and exercises its write/refetch signatures.

Each generated shape crosses 24 related construction forms: two persistence
modes, schema-free/transforming schema, typed-spread/inline arguments, and
inferred/partial/full explicit arguments. Browser adds the actual Query
Collection path. Partial explicit arguments select TypeScript's utility
default; they do not promise inference for unspecified later type parameters.
The original string, numeric, and browser row shapes survive as replay data
through the same checker, without separate expected answers.

## Evidence block

- **Law:** The source-level composition law above, from the SQLite guide and
  public `createCollection`/persistence option contracts.
- **Reach:** Each receiver runs 12 generated histories with seed 2259 and 12
  with a fresh seed. In both campaigns, each of `schema-free-local`,
  `schema-free-synced`, `schema-input-output`, `typed-spread`,
  `inferred-arguments`, `explicit-arguments`, and `row-key-arguments` reaches
  12 histories. Browser's `query-adapter` also reaches 12 in each campaign.
  Counts derive from the construction paths actually compiled and compared.
  The three fixed replay inputs do not contribute to generated reach.
- **RED:** With the exact parent `persisted.ts` temporarily restored, both
  receivers fail their first generated history with TS2769 at the public
  `createCollection(persistedCollectionOptions(...))` call. The fixed-campaign
  command is `../../node_modules/.bin/vitest run --coverage.enabled=false
  --typecheck.enabled=false tests/persisted-options.test.ts -t fixed`, run
  from each receiving package. Source restoration uses `finally`.
- **GREEN:** With PR production restored, both fixed and fresh-seed campaigns
  pass through core and browser. There are 48 generated histories and 1,176
  consumer constructions across these four campaigns, plus shared replays.
  Core's nine surrounding `persisted.test-d.ts` tests also pass. The runner
  and shared harness typecheck in both packages without source errors.
- **Mutants:** All outcomes below are compiler comparison failures, not
  timeouts or setup failures. All eleven receiving-path checks were replayed
  again against the final generator after restoring its original names.
- **Limits:** This is source execution with TypeScript 5.9.3, Vitest 3.2.4,
  and fast-check 3.23.2. It establishes no runtime parsing, I/O, publication,
  generated declaration, npm resolution, other host re-export, or compiler
  version claim. The grammar has 1–4 non-key fields, scalar/nullable/array/
  nested field types, six key domains, field optionality, and scalar utility
  signatures. Domain values are sampled; there is no claim that every key
  domain or every input appears in each fresh campaign. There is no known
  counterexample in the declared grammar. The coverage-map entry retains the
  owner and these limits for future extension.

| Hostile implementation | Receiving path | Rejection |
| --- | --- | --- |
| Exact defective parent, both schema-free results retain `TSchema` | Core and browser | TS2769; seed 2259, path `0:0:0:0:0:0:0:0:0` |
| Restore only the synced schema-free result | Core | TS2769 at the synced construction |
| Restore only the local schema-free result | Core | TS2769 at the local construction |
| Widen literal/branded keys to broad string/number | Core | TS2344 at exact key equality; seed 2259, path `3:1:1:1:1:1:1`; reduced key is `"alpha" \| "beta"` |
| Erase schema-free user utilities to `UtilsRecord` | Core | TS2344 at utility equality and unused negative utility directive |
| Apply `never` to schema-bearing result types too | Core | TS2344 and unused negative schema-input directives |
| Remove `undefined` from the public getter result and assert the implementation return non-null | Core | TS2344 at optional read-result equality |
| Add a required `leaked` field to the public getter result | Core | TS2344 at complete published-row type equality |
| Add an overload that admits a present `sync: undefined` | Core and browser | Unused negative sync directives (TS2578); persistence is supplied so the error cannot arise from a missing adapter |

The original ten fixed tests pass the widened-key mutant. This is an executed
false-green witness, not an inference from the file's name. The other mutants
reject at the reduced path `0:0:0:0:0:0:0:0:0` as well.

Direct replay was verified against the parent: exactly one history ran, with
the captured seed and complete shrink path, and failed without further
shrinking. The same replay passed after restoration of PR production. The
shared replay witness recorded `numRuns: 1`, `failed: true` for the parent and
`failed: false` for the repair. To reproduce the repaired replay:

```sh
# From packages/db-sqlite-persistence-core
TANSTACK_DB_ORACLE_SEED=2259 \
TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0 \
TANSTACK_DB_ORACLE_PROPERTY=persisted-options.types.core \
pnpm exec vitest run --typecheck.enabled=false --coverage.enabled=false tests/persisted-options.test.ts
```

Normal verification from the respective package directories:

```sh
# Core: campaigns, harness typecheck, and surrounding persistence type contracts.
pnpm exec vitest run --coverage.enabled=false tests/persisted-options.test.ts tests/persisted.test-d.ts

# Browser: campaigns; the next command separately checks the harness types.
pnpm exec vitest run --typecheck.enabled=false --coverage.enabled=false tests/persisted-options.test.ts
pnpm exec vitest run --typecheck.only --coverage.enabled=false tests/persisted-options.test.ts
```

Local commands invoked the same Vitest executable directly, with workspace
`node_modules/.bin` first on PATH. The configured registry returned 403 and
the public fallback returned 503 during installation; existing installed
external dependencies were reused without changing the lockfile. Explicit
compiler aliases target this checkout's production sources. Early failures
from jsdom import URLs, missing worker/schema declarations, and an accidentally
selected global TypeScript 7 compiler were setup failures and supply no RED
evidence. Final compiler runs retain all diagnostics rather than suppressing
source errors. ESLint, formatting, `pnpm lint:changed`, and `git diff --check`
also pass.

## Requirement audit

| Requirement | Outcome |
| --- | --- |
| ORC-001 | Authority, source-level observation, finite grammar, and receiving limits are stated above and beside the model. |
| ORC-002 | Expected rows/keys/user utilities are independently declared; the published virtual shape comes from the public WithVirtualProps/VirtualRowProps documentation. No production schema inference or virtual-row helper computes expectations. PublicShape flattens type intersections while retaining every key, readonly/optional modifier, and undefined. The Query utility relation trusts the unchanged adapter contract. |
| ORC-003 | Contract, grammar, independent row model, construction drivers, and compiler comparison have adjacent prose in the owner. |
| ORC-004 | Reconstruction: replay shapes preserve the original row/key/utility cases. Ablation: typed spreads and inferred arguments expose the parent; mode variants reject single-overload repairs; key domains reject widening; schema neighbors reject blanket-never; utility signatures reject erasure. Range: 1–4 non-key fields, six keys, optional/nullable/array/nested fields, scalar utility signatures. Exclusion: duplicate names cannot be generated; boolean/symbol keys are outside the legal domains. |
| ORC-005 | Real source entries feed the compiler. Diagnostics and exact type constraints observe the public call boundary. The original and mutant diagnostics positively identify those paths. There is no runtime information-delivery claim. |
| ORC-006 | Original implementation and eight additional wrong designs reject at the intended compiler comparison; the legacy-suite survivor demonstrates the missing distinction. |
| ORC-007 | Fixed/fresh campaigns share one grammar, comparison, and budget. Seed/path/property replay runs directly, and the shared reporter records one failed/passing replay. No command-model replay path applies. |
| ORC-008 | Not applicable: the reference computes static type shapes and introduces no stateful runtime abstraction. |
| ORC-009 | A history here is a model-only declaration/construction/compilation sequence, explicitly mapped to the source boundary. It is not a Collection sync run. |
| ORC-010 | Full compiler diagnostics retain the violated type constraint and source expression. Fast-check preserves the generated/shrunk shape and path. Generated consumers live in memory; temporary mutation experiments restore source in `finally`. |
| ORC-011 | No additional shared-semantic-fault hypothesis was identified for the independent shape model. The Query driver's before/after utility relation is supplemental; it does not independently specify Query Collection internals. |
| ORC-012 | This record identifies the reviewed head, scope, experiments, dispositions, and applicable/non-applicable requirements. No universal bug-class proof is claimed. |
| ORC-013 | Typed/untyped and schema-free/schema-bearing neighbors distinguish omission of the schema premise from blanket schema erasure. Exact broad/literal key cases reject widening. |
| ORC-014 | The browser public source export and actual Query adapter are receiving drivers of the shared law. No SQLite/provider/runtime-host premise is transferred by this source-only claim. |
| ORC-015 | Shared `createOracleReach` counters require every declared path to appear, count histories once, and report the measured counts above. Fixed replay data does not inflate them. |
| ORC-016 | No standalone unit/type examples remain in this owner. Fixed cases are model input data; both receiving runners register the same generated law. Negative type checks are emitted by the reusable comparison from each shape. |

## Lossless finding ledger and reviewer assessment

The raw sources are the preceding assistant review, the user's correction,
and CodeRabbit's PR comment. The GitHub review and inline-comment lists were
empty at capture. There were no additional capped findings or footnotes.

| ID | Claim | Technical verdict and evidence | PR action | Durable value/destination |
| --- | --- | --- | --- | --- |
| R1 | The PR does not edit its oracle. | Refuted literally: the original diff edits the coverage-map owner. This does not answer R2. | `refuted`; no separate code change. | Preserve the distinction between editing an owner and enforcing a reusable law. |
| R2 | Fixed assertions do not provide a generated type-preservation oracle; ban unit tests in oracle files. | Confirmed by the widened-key mutant passing all original tests. | `fixed-now`: generated owner, shared replay inputs, reach/replay/calibration; AGENTS, authoring skill, and ORC-016 prohibit standalone unit tests in oracle files. | Primary owner and this evidence record. |
| R3 | Browser checks repeat separate fixed expectations. | Confirmed by source inspection and the same legacy-suite survivor. | `fixed-now`: browser/Query receiving paths use the identical model/checker. | Receiving runner and primary owner. |
| R4 | CodeRabbit reports no actionable issue and says the fix is ready for normal merge checks. | Refuted as an oracle-sufficiency assessment: it missed R2/R3 and the executed false green. This does not establish a new defect in the PR's two-line production fix. | `refuted`; repair the actual coverage gap. | Keep whole-PR readiness separate from a green fixture matrix. |
| R5 | CodeRabbit's 0% docstring warning requires missing docstrings. | Refuted as an actionable documentation defect: changed public overload return types retain the same API; the warning identifies no incorrect/missing public contract. Its metric itself was not reimplemented. | `refuted`; no metric-driven docstrings. | The executable owner now explains the law and limits; retain useful prose rather than chasing the percentage. |

CodeRabbit's overload summary was technically accurate. Its oracle analysis
had low depth and prioritized a documentation metric over a real enforcement
gap. The preceding
assistant review located the right owner and distinguished compile-time from
runtime coverage, but was too generous in treating fixed expected shapes as
sufficient independent oracle judgment. The surviving mutant corrects that
assessment. This is a self-audit, not an independent external review.

Loss audit: **5 raw items = 2 fixed-now + 3 refuted**. No confirmed-open,
deferred, duplicate, stale, or unresolved design-decision items remain in this
scoped migration. The unit-test prohibition is an explicit review requirement;
the existing syntactic lint rules cannot prove semantic model independence.

Whole-PR readiness: **not assessed**. The focused instrument and type contract
checks pass; full runtime CI, published package resolution, and integration
outside the named source receiving paths were not rerun or claimed.

## Prep-pr follow-up: contextual schema inference

Reviewed production remains `e3e8a9b5bce0a99d889b73f6eb7578b6d7ef3769`.
The final executable owner has SHA-256
`5fa47aeaec4790188ee46194e687ca269c507d47d97555d475edc219d45dabf4`.
The replay registry is unchanged from the initial migration above.

The independent prep-pr reviewer found one P2 gap: all generated core `getKey`
callbacks annotated their row as `Output`. The deleted schema examples used
an inline unannotated callback. A spread of an annotated callback cannot test
whether the schema context supplies the output row.

An in-memory compiler-host mutant changed only the two schema-bearing input
overloads to accept `getKey: (row: any) => TKey`. The baseline accepted both
construction paths. The mutant passed the annotated path and the entire
initial fixed core campaign, including its replays and all declared reaches.
The original unannotated path rejected it: an invalid numeric key became
accepted, producing TS2578 for the unused negative directive. This is an
executed false-green witness for the migration, not a production defect on
the repaired PR.

The repair adds six generated contextual schema forms: local/synced crossed
with inferred/partial/full explicit arguments. They put the unannotated
callback directly inside the wrapper argument. The callback's public row
parameter must equal the independently declared schema output. All 24
annotated forms remain. Core therefore compiles 30 forms per shape; browser
compiles the same 30 plus its actual Query Collection receiving path.
Fixed regressions remain inputs to that same model, driver, and comparison.

- **Law:** The public schema-output contract also supplies the contextual
  `getKey` row. It must preserve the inferred key. Authority is the schema
  overload's documented output-row role and the original schema composition
  examples, rather than the mutant's behavior.
- **Reach:** `schema-contextual-key` reaches 12 generated histories in each
  fixed and fresh campaign on both receivers. Every prior declared state also
  reaches 12. Across four campaigns, 48 generated histories compile 1,464
  constructions, plus shared regressions excluded from generated reach.
- **RED:** The initial fixed core campaign survives the contextual-row mutant.
  The expanded comparison rejects it with TS2344 at `CallbackInput`, with
  additional inferred-key/result mismatches. Direct replay uses seed 2259,
  path `0:0:0:0:0:0:0:0:0`, and the appropriate receiver property.
- **GREEN:** The expanded core and browser campaigns and harness typechecks
  pass. Core also passes all nine neighboring persistence type tests. The
  commands retain the initial verification selectors and limit Vitest to two
  CPUs.
- **Mutant:** The same compiler-host overlay supplies the wrong contextual
  type to the unchanged expanded comparison. Both core and browser reject it
  at the callback parameter equality. The nine earlier wrong designs were
  also replayed against the expanded owner: all eleven receiving checks still
  reject at their compiler comparisons. In total, ten wrong designs reject
  across thirteen receiving checks. Production on disk remains the PR's
  two-overload correction after temporary calibration experiments.
- **Limits:** The initial source-only and compiler-version limits still apply.
  This adds no runtime, built-declaration, or package-resolution claim.

ORC-004 reconstruction now includes the original contextual schema path.
Its ablation is decisive: removing the six contextual cells lets this mutant
pass. ORC-005 observes the callback parameter at compilation as well as the
resulting Collection. ORC-006 rejects the previously surviving wrong design.
ORC-015 declares and measures the added path. The other ORC outcomes above
retain their scope, with the expanded counts and owner hash stated here.

Finding ledger: **one raw prep-pr finding = one repaired coverage regression**.
The simplifier made no changes and proposed no additional suggestions.
Technical reviewer assessment: the reviewer
identified a lost public path and proved its significance with a full-campaign
survivor and a distinguishing old-path failure. Root independently reran the
four-way probe and inspected the full-campaign overlay and diagnostics.
The reviewer then inspected the expanded owner and confirmed the repair,
retained paths, and declared reach, with no additional supported findings.

The bundle-size comparison could not build the cached baseline because that
worktree lacks Vitest/TypeScript dependencies. A separate TypeScript 5.9.3
transpile comparison emits identical JavaScript for the parent and repaired
`persisted.ts`. This is emit evidence, not a completed bundle measurement.

## External review follow-up at 4ea6b7663

The supplied review read PR head
`4ea6b76634ef3b16ec8461fb29bb4aebb51819da` without running its tests.
This follow-up evaluates all ten items and repairs confirmed oracle gaps.
Production remains the original two schema-free result corrections; no new
production defect was demonstrated. This section supersedes earlier descriptions
of the current grammar, Query expectation, diagnostics, counts, and replay path.
The follow-up owner SHA-256 is `8f206d9195231239989e2a2c3370fd4abaf4fe4bab32717689c0b5e04834905c`.
The containing Git commit identifies the complete follow-up tree. Historical
hashes above describe earlier experiments, rather than a mutable current file.

### Law, experiment, inference, and enforcement

| Law and authority | Experiment and inference | Final enforcement and limits |
| --- | --- | --- |
| Public persistence utilities retain required/optional signatures, alongside caller utilities. Authority: PersistedCollectionUtils API and SQLite guide. | Removing the local result intersection passes the reviewed full campaign. The expanded comparison rejects TS2344 at LocalCapabilities. | Independent signatures observe acceptMutations, optional getLeadershipState and optional forceReloadSubset. PendingMutation/LoadSubsetOptions are trusted domain carriers, not expected-result helpers. |
| Documented persistence options and contextual callbacks remain usable across schema/sync configurations. Authority: SQLite guide and public SyncConfig/option contracts. | Old grammar omits those options and uses no-argument sync functions. Widening schemaVersion, initialRender strategy, syncMode or contextual sync input now rejects TS2344. | Twelve extra configurations per shape cross schema and sync modes with eager/on-demand/network-first. Network-first is eager. Generated schemaVersion is 1–100 and timeout is 0–10000. This checks types, not runtime option validation. |
| Query composition preserves its documented closed capabilities. Authority: QueryCollectionUtils public reference and the guide's adapter composition. | isLoading:any survives the reviewed full browser campaign. The independent model rejects it, widened refetch options, and an extra optional adapter capability. | Generated row/key write signatures plus exact state fields and refetch parameters. Non-any Promise-array envelope is independent; supplemental before/after equality preserves the full return payload. No independent QueryObserverResult payload semantics are claimed. |
| A fresh sync:undefined argument must fail for sync admission, rather than collateral corruption. | Undefined-sync admission alone already failed the old directive. Adding unrelated getKey:42 to the negative expressions masks it and passes the old full campaign. New paired observations reject that compound corruption. | Unsuppressed TS2769 must point at the exact fresh sync property. The legal neighbor changes only sync and must compile. Every other diagnostic remains fatal. Structural extra properties carried through variables have different TypeScript freshness semantics and are not this rejection claim. |
| Run budget, receiving configuration and diagnostic fidelity must remain effective. | Multiplier10 originally registers 120 runs but 120000ms. Revised registration gives 1200000ms. Source-only TS2322 and declaration-only TS4094 controls reject. | Receiver tsconfig, one compiler per receiver across campaigns, dependency caching, all original diagnostic classes, and event-loop yields between generated histories. No generated-file-only diagnostic filtering. |

### Lossless finding ledger

| ID | Supplied claim | Technical verdict / evidence | PR action | Durable value |
| --- | --- | --- | --- | --- |
| E1 | Local-added utilities are unchecked; removing their result intersection survives. | Confirmed by full reviewed-campaign survivor and new TS2344 rejection. | fixed-now: independent LocalCapabilities comparison. | Primary owner and local-utils recipe. |
| E2 | Deleted schemaVersion/markReady examples lost coverage; initialRender/syncMode absent. | Confirmed grammar omissions. No new runtime defect claimed. | fixed-now: generated legal options, exact declared option law, contextual readiness signature and reaches. | Primary grammar; four option/callback mutants. |
| E3 | Unused schema generic silently drops a schema; using never in inputs fixes it. | Refuted as stated. Eighteen compiler probes show current and proposed inputs both accept no-value phantom generic, reject an actual schema value (TS2769), and retain correct schema-input composition. Suggested change has no effect. | refuted: no production edit. | Two phantom-generic paths preserve useful normalization coverage. |
| E4 | Whole-program work repeats; timeout ignores multiplier; check only generated file and share compiler. | Timeout confirmed. Repeated dependency checking is avoidable. Generated-only diagnostics would hide source errors. | fixed-now: semantic builder shared across campaigns, scaled timeout, retained source/declaration diagnostics. | Deterministic affected-file telemetry and budget/source controls. |
| E5 | Fixed refetch/nonexistent-method examples violate law-only policy. | Confirmed standalone concrete expressions in Query driver. | fixed-now: reusable closed capability model replaces them. | Model parameterized by generated rows/keys, not fixed call examples. |
| E6 | Expected Query utils derive from production; shared erasure can pass. | Independent judgment gap confirmed by isLoading:any survivor. Whole-namespace any was overstated: old negative writes already detect some erasure. | fixed-now: independent model plus supplemental transparency relation. | State, namespace and refetch corruption controls. |
| E7 | Named campaigns omit runners; tests can only get 12 runs. | Registration omission confirmed. Hardcoded 12 claim refuted: multiplier 3 helper experiment executes 36 fixed and 36 random checks; normal package test globs already include runners. | fixed-now: package/root test:oracles registration. | Distinguish selection, count, reach and completion. |
| E8 | Browser uses core tsconfig, invalidating browser witness. | Config selection confirmed; current semantic compiler settings match. Both configs compile the same consumer and resolve the same browser/Query source modules. | fixed-now: select receiving package config to prevent drift. | Preserve accurate source-only browser scope. |
| E9 | Any unrelated error can satisfy bare sync directive. | Checker fragility confirmed with the two-factor control above; original admission-only mutant was already detected. | fixed-now: exact unsuppressed property diagnostic and legal same-candidate neighbor. | Reusable admission observation rejects collateral corruption. |
| E10 | Audit depends on inaccessible scratch, mutable hashes, personnel verdicts. | Mixed: versioned record already contains authority, commands, outcomes and limits, and historical hashes match. Exact overlay recipes and stale wording needed improvement. | fixed-now: versioned runnable calibration command, historical-hash clarification, technical-only reviewer assessment. | Others can reproduce decisive results without prior scratch files. |

Loss audit: **10 supplied items = 9 fixed-now + 1 refuted**. No raw item,
footnote, or suggested fix was dropped. Proposed remedies rejected as ineffective
or unsafe remain recorded in their original item. No deferrals or unresolved
product decisions remain in this scoped evaluation.

The review had high signal for missing observations and grammar dimensions,
and clearly disclosed that its findings were unexecuted. Its weaker points were
the ineffective input-never proposal, generated-only diagnostics suggestion,
and overstatements about multiplier use, compiler settings, and missing evidence.
Execution supports the oracle repairs, not a newly discovered production bug.
Personnel recommendations remain in the local review ledger.

### Reproducible calibration

From the repository root, with the workspace dependencies installed:

```sh
# Unmodified current fixed campaign: must succeed.
node scripts/calibrate-persisted-option-types.mjs none

# Reviewed full campaigns: both accept these wrong implementations.
node scripts/calibrate-persisted-option-types.mjs local-utils 4ea6b7663
node scripts/calibrate-persisted-option-types.mjs query-status 4ea6b7663
node scripts/calibrate-persisted-option-types.mjs collateral-sync 4ea6b7663

# Current owner rejects each at the named comparison.
node scripts/calibrate-persisted-option-types.mjs local-utils
node scripts/calibrate-persisted-option-types.mjs query-status
node scripts/calibrate-persisted-option-types.mjs collateral-sync

# Exact original production, without touching source files on disk: rejects TS2769.
node scripts/calibrate-persisted-option-types.mjs parent
ORACLE_RECEIVER=browser node scripts/calibrate-persisted-option-types.mjs parent

# Retained source and declaration diagnostic fidelity: reject TS2322 / TS4094.
node scripts/calibrate-persisted-option-types.mjs source-error
node scripts/calibrate-persisted-option-types.mjs declaration-error

# Budget must report 120 runs and two 1200000ms registrations.
ORACLE_REGISTRATION_ONLY=1 TANSTACK_DB_ORACLE_RUNS_MULTIPLIER=10 node scripts/calibrate-persisted-option-types.mjs none

# Observe builder invalidation and worker progress through both campaigns.
ORACLE_COMPILER_WORK=1 ORACLE_ALL_CAMPAIGNS=1 node scripts/calibrate-persisted-option-types.mjs none
```

Calibration failures intentionally exit nonzero. Classify the reported compiler
constraint or missing exact admission rejection, rather than treating any
nonzero exit as a killed mutant. The script creates disposable files under
`.context` from versioned sources; it needs no existing scratch evidence and
never mutates production on disk. Its optional second argument pins only the
historical owner; production starts from the current checkout unless the
selected overlay replaces it. To reproduce the precise historical whole tree,
run the command from a checkout of the reviewed commit with this calibration
script available.

The command also supports sync-regression, local-regression, widened-key,
erased-utils, blanket-never, contextual-key, missing-undefined, extra-read-field,
undefined-sync, query-refetch, query-namespace, schema-version, initial-render,
sync-mode and contextual-sync. The widened-key control requires normal generated
sampling; the other observed controls reject at seed 2259 and reduced path
`0:0:0:0:0:0:0:0:0:0:0`. The property and replay interface are the same as the
normal receiver runners. Explicit replay starts at the requested generated path and bypasses normal
campaigns and fixed examples. Fast-check 3.23 can also visit remaining sibling
shrinks after a passing colon-path replay, despite numRuns: 1; a calibrated
repaired replay visited 14 histories. Failing minimal replays stop after the
first rejected history. No single-history claim is made for successful replays.

### Follow-up evidence and requirement audit

- **Law:** The original composition law remains, with independent capability,
  option and contextual-callback observations from the public references above.
- **Reach:** Each core campaign compiles 44 constructions per shape; browser
  compiles 45. Across four 12-history campaigns this is 2136 generated constructions,
  plus 534 fixed-replay constructions outside generated reach. Every prior state
  and each new local-capabilities, configured-options, on-demand-options,
  network-first-options, contextual-sync and phantom-schema-argument state
  reaches 12 histories per campaign; query-adapter reaches 12 on browser.
- **RED / mutants:** Original production still fails at public composition.
  Local utility removal, Query state widening and collateral-error masking are
  demonstrated false greens on the reviewed owner and reject on the expanded
  owner. Twenty-one original/hostile/collateral controls reject, including source and
  declaration-only controls. Outcomes are compiler comparison failures or the
  exact missing-admission observation, not timeouts or setup failures.
- **GREEN:** Both receiver campaigns and neighboring core type contracts pass
  on unchanged PR production (11 core tests and two browser campaigns, no type
  errors). Both named package commands also pass at multiplier 2, with 24
  histories per declared state in each campaign. Browser's command filters to
  the changed type property; its 99 older runtime tests are not rerun by that
  check. Semantic affected-file instrumentation records 290 files for the first
  core history and 1 for every later history across both campaigns. Declaration
  diagnostics are still collected separately, so this count does not claim all
  compiler work is eliminated. The worker heartbeat advances 24 times across
  the 24 generated histories. Formatting, ESLint, lint:changed and diff checks pass.
- **Limits:** Source compilation with TS 5.9.3 / Vitest 3.2.4 / fast-check 3.23.2 and the
  stated finite grammar. No runtime, package/declaration publication, or other
  host/compiler-version claim. Declaration diagnostics are retained for source
  fidelity, not proof of emitted artifact consumption.

The independent follow-up challenge found sibling S1: the initial builder
rewrite omitted declaration diagnostics. An exported anonymous class with a
private field survives that gate but fails TS4094 when declaration diagnostics
return. The final gate retains them and the declaration-error recipe. This was
an oracle-repair regression, not a production defect.

ORC-001/002 now cover independent local/Query capability and option laws.
ORC-003 prose follows the revised grammar, model, driver and exact diagnostic
cut. ORC-004 reconstruction retains all 30 old forms and adds configured/phantom
forms; option ablations and the documented calibration controls distinguish
their contribution. ORC-005/006 observe real receivers and reject the controls
above. ORC-007 retains campaign parity and the shared direct replay interface.
ORC-008 remains inapplicable to a static model. ORC-009's type-history mapping
is unchanged. ORC-010 retains unexpected source/declaration diagnostics and
original shrinking evidence; no disk restoration is needed for the overlays.
ORC-011's shared Query fault is answered by the independent capability model.
ORC-012 is this versioned evidence. ORC-013 observes legal option neighbors and
invalid sync with a same-candidate legal neighbor. ORC-014 retains the real
browser/Query receiving source paths, with no runtime provider claim.
ORC-015 measures every new declared state. ORC-016 contains no standalone fixed
API examples; fixed regressions remain shared model inputs.

### Calibration portability follow-up

CodeRabbit review5656171283 of892bf55b8 identified four Minor items, preserved
as C2-1 through C2-4 in source order. C2-1 corrected missing spaces in E7's
numbers. C2-2 removed eager parent-history loading from unrelated calibrations.
C2-3 restricted transform/target validation to the selected mutation. C2-4 added
the missing changed-source guard for the two Collection getter controls.

The law here is reproduction integrity: selecting one control must require
only that control's inputs, and a requested semantic edit must actually apply.
Executing the helper's actual setup prefix with filesystem/process overlays
reproduced three failures: `none` attempted unavailable parent history; `none`
failed an unrelated changed overload target; and a selected getter control
constructed an unchanged overlay after both its signature and return-helper
targets disappeared. The same probes now avoid all historical reads for `none`
and report `Missing mutation target: missing-undefined` for the no-op control.
Real commands then confirm `none` registers normally, `parent` rejects TS2769,
and `missing-undefined` rejects the public-read equality with TS2344.
No production, grammar, model, observation or compiler-gate edit was needed.

All four items are fixed-now. The script's lazy parent getter and selected-only
transform loops preserve the intended overlays and make independent controls
usable when unrelated historical sources drift. The review accurately found
portable-calibration weaknesses; no production claim follows from those setup
failures. The previous owner hash and oracle evidence remain unchanged.

## Adversarial round two and reserved utility decision

Reviewed head: `39065e399894913874d5f6965f75322cbac82ad7`. The containing
follow-up commit identifies the repaired tree. Three fresh reviewers examined
enforcement, authority, and compiler infrastructure. This section supersedes
the earlier current-grammar counts and the claim that production contains only
the schema-free return correction. The original experiments remain historical.

### Law, experiment, inference, and repair

| Law and authority | Decisive experiment | Repair |
| --- | --- | --- |
| Schema input accepts output, so already-transformed rows remain legal input. Authority: schema guide, Core Concepts and Critical Design Principle. | A real persisted Collection with input `string \| number` and output `number` accepts an output row. Restoring the old negative directive gives TS2578. The old disjoint grammar also allowed output-optional/input-required fields. | Generate the superset relation, retain exact input equality, and observe legal output insertion. No production change for this finding. |
| Public read types retain declared readonly user properties. Authority: schema-free createCollection return type and WithVirtualProps. | A getter mutant strips user-property readonly while retaining virtual modifiers. It passes the old path-0 history. A schema-free readonly row passes production and rejects the mutant at the shared published-row equality. | Generate independent modifiers and eight structural mutable/readonly neighbors across schema and sync modes. Declare and measure their reach. |
| Local persistence owns its utility names and rejects caller collisions. Authority: the user's decision, “let's just throw an error as those names are reserved,” now documented in the SQLite guide. | Before the guard, both real receivers accept a reserved caller property and resolve persistence. TypeScript permits a caller leadership return type of `'caller'`, while runtime returns the persistence leadership object. | Reject acceptMutations, getLeadershipState and forceReloadSubset before persistence resolution. The guard uses the existing utility object's keys. Synced wrapping preserves adapter utilities because that path adds none of these local capabilities. |

The runtime law is an explicit contract decision, rather than an inference from
the previous overwrite behavior. It applies to a present reserved property,
including inherited/non-enumerable properties and undefined values. The wrapper
throws InvalidPersistedCollectionConfigError. This is runtime admission, not a
new compile-time rejection. Successful local results cannot retain a conflicting
caller signature because the conflicting construction does not return.

The existing option owner now includes a runtime receiving driver for this
namespace boundary. Its independent rule uses reserved names and sync presence.
The production driver records return/throw, error identity, persistence resolver
calls, caller-function calls, and preservation of admitted utilities. Each
history crosses schema presence, both sync modes, each reserved name, their
union, a generated subset, ordinary names, three descriptor forms, and
undefined/function values. A rejected configuration must do zero resolver work.
No Collection is created and no SQLite operation or sync starts.

### Lossless round-two ledger

| ID | Claim | Technical verdict and PR action | Durable value |
| --- | --- | --- | --- |
| R2-A1 | Caller utility preservation conflicts with local reserved-name overwrites. | Confirmed type/runtime mismatch. User chose rejection. fixed-now: runtime guard, shared generated admission judgment, real core/browser RED and GREEN, guide and changeset. | Explicit admission contract and reserved-name controls. |
| R2-A2 | Phantom schema generic acceptance lacks a guide-level meaning. | Refuted as a current correctness defect. Existing public signatures accept this source form; executable prose now labels the compatibility basis. | Distinguish source compatibility from runtime schema semantics. |
| R2-A3 | Exact Query utility equality also rejects future typed additions. | Refuted as a current defect. The current API remains the independent expected shape. Prose clarifies that an intentional documented addition updates the model. | Distinguish a current namespace check from a prohibition on API evolution. |
| R2-A4 | The transformation grammar misses the documented update-safe input domain. | Confirmed. fixed-now: compatible transform, optionality relation, and legal output admission. Exact input equality still rejects reversed schema roles. | Schema-output-rejection and blanket-never controls. |
| R2-A5 | The header implies a generated persistence utility reference page that does not exist. | Confirmed citation issue. fixed-now: cite the exported PersistedCollectionUtils interface directly. | Trace the law to the actual public API. |
| R2-E1 | Readonly user fields are absent from the grammar. | Confirmed old-owner survivor. fixed-now: generated modifiers and measured structural neighbors. | Readonly-row control, including a schema-free witness. |
| R2-S1 | Concurrent calibration processes can overwrite the same scratch runner. | Found during reconciliation: core/browser parent controls shared a filename, causing a missing-campaign setup error. fixed-now: receiver and process ID in type-runner names, process ID in runtime bundles. Repeated concurrent controls both reject TS2769. | Calibration isolation across receivers and owner versions. |

Loss audit: six supplied items plus one reconciliation finding equal five
fixed-now and two refuted. No deferrals, unresolved policy decisions, or known
in-scope counterexamples remain in this bounded option review. Technical reviewer
assessment: the enforcement review demonstrated a concrete survivor and supplied
an independent schema-free witness. The authority review verified the contract
conflict and runtime mismatch. The infrastructure review accurately separated
executed controls from source inspection and found no additional supported bug.

### Evidence block and reproduction

- **Law:** Input/output and modifier preservation follow the existing public
  contracts. Reserved local utility rejection follows the explicit decision
  above. The runtime comparison does not import production's merge/classifier.
- **Reach:** Each type shape now compiles 52 core or 53 browser constructions.
  Four default campaigns cover 48 generated histories and 2520 constructions,
  plus 630 fixed replay constructions outside reach. Every type state reaches
  12 histories per campaign, including schema-compatible-input, readonly-input,
  readonly-output and mutable-fields. Four runtime campaigns cover 48 histories
  and 6912 wrapper constructions; all ten admission states reach 12 histories
  in each campaign, including schema-collision.
- **RED:** Before production edits, both real entry points fail admission at
  the intended return/throw comparison: a reserved property is admitted, no
  config error appears, and the resolver runs once. Schema-free and
  schema-bearing histories both demonstrate this. The type owner rejects the
  original schema-free overloads with TS2769 on both receivers.
- **GREEN:** The type campaigns and nine neighboring core type tests pass.
  The final expanded admission campaigns pass on both receivers with no source
  errors. Three existing runtime checks also pass: local loopback utilities,
  manual acceptMutations, and terminal-failure fencing of direct acceptance.
  Formatting, ESLint, lint:changed and diff checks pass.
- **Mutants:** The readonly-stripping getter rejects on both receivers. The
  obsolete schema-output rejection fails TS2578, and blanket schema erasure
  fails the exact type laws. Runtime controls reject the old production,
  removed guard, own-properties-only guard, truthiness-only guard, and a guard
  missing forceReloadSubset. Failures identify admission or type comparisons,
  not setup errors or timeouts. The initial concurrent-runner setup error is
  R2-S1 above and is not counted as a mutant rejection.
- **Weight and limits:** The production bundle grows 64 gzip bytes and 29
  brotli bytes against the merge-base on fetched origin/main. Reusing the
  existing utility object and inlining its acceptance callback avoids a second
  name registry and helper. The new rejection branch accounts for the growth.
  Type evidence remains source-only on TS 5.9.3. Runtime evidence stops at
  wrapper admission and does not establish database I/O, schema parsing,
  Collection mutation behavior, native hosts, or published package resolution.

From each receiving package, the normal persisted-options.test.ts command runs
both type and admission campaigns. To select admission alone, add
`-t 'reserved local utility'`. Direct runtime replay uses seed 2259, path
`0:0:0`, and property `persisted-options.utilities.core` or `.browser`.

The following repository-root commands use only versioned inputs:

```sh
# Old grammar accepts the readonly-stripping getter.
TANSTACK_DB_ORACLE_PATH=0 node scripts/calibrate-persisted-option-types.mjs readonly-row 39065e399

# Current grammar rejects these controls. Use the browser receiver for readonly-row too.
TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0 node scripts/calibrate-persisted-option-types.mjs readonly-row
ORACLE_RECEIVER=browser TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0 node scripts/calibrate-persisted-option-types.mjs readonly-row
TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0 node scripts/calibrate-persisted-option-types.mjs schema-output-rejection
TANSTACK_DB_ORACLE_PATH=0:0:0:0:0:0:0:0:0:0:0:0:0 node scripts/calibrate-persisted-option-types.mjs blanket-never

# Runtime controls bundle the same shared admission model and the real core entry.
node scripts/calibrate-persisted-option-types.mjs utility-parent
node scripts/calibrate-persisted-option-types.mjs utility-no-guard
node scripts/calibrate-persisted-option-types.mjs utility-own-only
node scripts/calibrate-persisted-option-types.mjs utility-truthy
node scripts/calibrate-persisted-option-types.mjs utility-missing-name
```

The runtime controls use esbuild and write isolated bundles under .context.
They leave tracked production files unchanged. A failure must show the intended
comparison and selected input, rather than merely exit nonzero.

ORC-001/002 tie the revised input rule and new admission policy to their actual
authorities. ORC-003/004 retain adjacent prose and add modifier, schema and
property-descriptor neighbors. ORC-005/006 now include real wrapper admission
and the calibrated rejection boundary. ORC-007/009/010 preserve campaign parity,
replay, source/type diagnostics and isolated calibration artifacts. ORC-008 is
still inapplicable: neither model adds a state machine. ORC-011 retains the
independent Query formulation and identifies no new shared semantic-fault
hypothesis. ORC-012 is this versioned audit. ORC-013 checks ordinary local and
synced collisions beside rejected local collisions. ORC-014 uses both real
receiving exports without transferring a SQLite/provider premise. ORC-015
measures the new type and admission states. ORC-016 keeps all observations in
shared judgments over generated inputs, without standalone regression answers.
