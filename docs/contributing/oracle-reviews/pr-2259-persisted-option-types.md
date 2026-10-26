# Persisted option type preservation: PR #2259

Reviewed PR head: `e3e8a9b5bce0a99d889b73f6eb7578b6d7ef3769`.
Original defective parent: `d2935d0fcac164163adc231c6a796b8a4c234d9b`.
This self-audit covers the oracle migration built on that head. Production
`persisted.ts` is unchanged from the reviewed PR after all temporary mutants.
The review ledger and raw GitHub responses are retained under `.context/`;
this record preserves the verdict-critical evidence for version control.

The initial migration record below precedes the prep-pr follow-up at the end.
That follow-up supersedes its owner hash, construction counts, and scoped
readiness assessment while preserving the earlier experiments.

The migrated executable owner has SHA-256
`c164515bf9705864bd5f0b27dc6e7769d1f7214cfba8158130fb12b36c04c9a0`.
The replay registry has SHA-256
`53837b427c149964cd6dda52c7f87d71de57626790c48012527d1d2028f90889`.
These identify the repaired instrument while its changes remain uncommitted.

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
gap. **No hire for an oracle-review role on this evidence.** The preceding
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
Reviewer assessment: **hire for this scoped oracle review**. The reviewer
identified a lost public path and proved its significance with a full-campaign
survivor and a distinguishing old-path failure. Root independently reran the
four-way probe and inspected the full-campaign overlay and diagnostics.
The reviewer then inspected the expanded owner and confirmed the repair,
retained paths, and declared reach, with no additional supported findings.

The bundle-size comparison could not build the cached baseline because that
worktree lacks Vitest/TypeScript dependencies. A separate TypeScript 5.9.3
transpile comparison emits identical JavaScript for the parent and repaired
`persisted.ts`. This is emit evidence, not a completed bundle measurement.
