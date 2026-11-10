# oracleProperty repin and migration baseline

Reviewed implementation: `9a5214f2801c2c7918f6fd21ac5add317559322a`.
Base: `ea3c920c1`. The rubric account is an author self-review. This record
covers the repin checkpoint. Subsequent
conversion batches need their own before/after evidence.

## Scope and authority

The maintainer's 2026-11-10 handoff requires `oracleProperty` as the only
campaign API, randomized constructed reach, a shrinking legacy baseline, and
same-seed preservation of every earlier mutant kill during conversion.
AGENTS.md's migration ratchet records that decision in the repository.

The checkpoint pins both framework packages to TanStack/oracles
`e1fb5048c6d33e958643360d87e168c302e03bd1`, the upstream main head checked on
2026-11-10. It restores the removed reach/campaign helpers and their self-tests
from `fe532f4` locally, registers their implementation modules, adopts the
199-file baseline, and adds its shrinking-list gate and executable inventory.
The framework's private campaign-seed selection is retained locally too.
The generated compatibility self-oracle keeps its model and 200-run budget.
Imports and environment names use DB's configuration. Vite inlines the
framework so its module state resets with the self-oracle's replay environment.

No existing campaign is converted in this checkpoint. The legacy helpers still
have their old reach semantics, including fixed-history reach. New and converted
oracles use constructed reach through `oracleProperty`.

## Gate evidence

Law: after adoption, exact legacy file identities may only shrink. Initial
adoption is permitted only when neither the baseline setting nor its gate
exists at base. Removing the setting after the last conversion does not permit
a fresh adoption. The authority is the maintainer's shrinking-list decision.

The oracle is `scripts/legacy-campaign-baseline-oracle.property.test.js`
(`scripts.legacy-campaign-baseline`). Its independent model classifies each
file in a four-file universe by base/head membership. The universe includes
shared stems, different extensions, and different packages. The production
driver commits a real temporary Git base, writes head settings, and invokes
the actual gate CLI. The named check compares the entire additions report and
exit status at `completed`.

The first RED used an always-accept gate. A second grammar extension exposed
the removed-setting loophole before changing the gate: both campaigns failed
`only shrinks` at `completed`. The fixed-seed counterexample shrank to seed
`20261110`, path `0:1:2:1:2`:

```json
{"adopted":false,"enforced":true,"base":[],"head":["packages/db/tests/a-oracle.test.ts"]}
```

The law owes status 1 and that file in `added`; the old gate returned status 0
and an empty report. `adopted` maps to the setting's presence at base;
`enforced` maps to the gate's presence there. Either establishes prior adoption.

Command for RED and GREEN, from the repository worktree:

```sh
./node_modules/.bin/vitest run --maxWorkers=2 --config scripts/oracle-scripts.vitest.config.mjs legacy-campaign-baseline
```

GREEN: all 5 tests pass. Each campaign keeps 20 generated histories and the
same grammar, constructions, production driver, and comparison. The fixed
regression uses the shared model and comparison; it contributes no required
generated reach. Counts from the final run:

| Declared state | Fixed seed 20261110 | Random campaign |
| --- | ---: | ---: |
| addition | 7 | 4 |
| empty baseline addition | 1 | 2 |
| retired baseline addition | 6 | 5 |
| removal | 5 | 9 |
| adoption | 7 | 4 |

Two production mutants were checked against the final oracle: replacing
`added` with `[]`, and dropping `&& !gateExisted` from the bootstrap condition.
Both fail the named `only shrinks` law at `completed`, using seed `20261110`
and path `0`. These are comparison failures, not timeouts or setup errors.
Restoring production and replaying the same coordinates passes:

```sh
TANSTACK_DB_ORACLE_PROPERTY=scripts.legacy-campaign-baseline TANSTACK_DB_ORACLE_SEED=20261110 TANSTACK_DB_ORACLE_PATH=0 node --import tsx packages/db/tests/oracle-replay.ts --maxWorkers=2 --config scripts/oracle-scripts.vitest.config.mjs legacy-campaign-baseline
```

The guard records one execution of one history for that exact property, seed,
and path. The restored compatibility property also has a successful guarded
replay of one history. Neither replay claims a full campaign's reach.

## Rubric account for the new gate oracle

| Requirement | Evidence or applicability |
| --- | --- |
| ORC-001 | The gate law and maintainer authority are above and beside the executable model. Valid-settings limits are below. |
| ORC-002 | Expected additions come from a finite membership truth table; the model imports no gate classifications or Git helpers. |
| ORC-003 | Opening contract prose, model explanation, grammar, actual CLI production driver, and completion comparison remain in the oracle file. |
| ORC-004 | Both known RED witnesses reconstruct. Removing setting presence, gate presence, membership, order, or empty sets loses a distinguishing legal case. The bounded domain is all ordered unique subsets of four files, with both presence flags. Duplicate or unknown file entries are excluded by the grammar. |
| ORC-005 | Every judged history invokes the actual CLI in a real Git checkout and compares its full report and status after completion. Both source versions are available by then; no concrete missing-input hypothesis remains. |
| ORC-006 | The always-accept trace calibration and both production mutants fail the named law at the intended checkpoint. |
| ORC-007 | Fixed and random campaigns share the 20-history grammar and judgment. Guarded seed/path replay records exactly one execution and rejects a filtered-out target. |
| ORC-008 | No stateful reference transitions are introduced; this is a stateless membership judgment. The setting/gate flags cannot be combined away: absence of both permits adoption, while either present forbids new files. |
| ORC-009 | The `adopted`/`enforced` abstraction is mapped to concrete base files beside the model. `completed` means the CLI process returned. |
| ORC-010 | Each temporary checkout is removed in the production driver's finally block. Both shrunk RED and direct mutant replay retain the same law/checkpoint; the observed mutant runs reach comparison after cleanup. |
| ORC-011 | No additional shared semantic-fault hypothesis requiring a second formulation was identified. The gate compares sets; the model classifies a fixed universe by a truth table. |
| ORC-012 | This versioned record is tied to the exact implementation head and bounds the evidence to the gate's declared input/path/observation domain. |
| ORC-013 | Initial absence versus adopted-empty versus removed-setting states distinguish three plausible bootstrap rules; additions versus removals distinguish always-accept and always-reject rules. |
| ORC-014 | The production driver uses the actual Node/Git CLI; no claim transfers a simulated provider premise to another host. |
| ORC-015 | Five declared states have randomized constructions, with measured counts above. Fixed regressions do not supply their reach. |
| ORC-016 | All tests use the shared membership model, CLI production driver and named comparison, or corrupt that comparison's observation. No separate expected-answer unit tests are in the oracle. |

## Validation and installation limits

- Compatibility helpers and generated self-oracle: 8 tests pass.
- Cleanup queue, cleanup/restart, comparison, local-storage write order and
  observer hydration representatives: 1768 tests pass.
- IVM multiset oracle: 41 tests pass.
- Full DB replay suite after registry/manifest additions: 116 tests pass.
- DB test TypeScript project, full oracle lint, changed-file lint, full ESLint
  of changed code, Prettier checks and `git diff --check` pass.
- The implementation commit runs the normal pre-commit hooks successfully.

All Vitest commands use at most two workers. The final gate and compatibility
runs follow the last source edits; the wider representative/replay checks
predate only the gate's added retired-baseline dimension and the compatibility
example's corrected environment setup. Direct guarded replay covers the final
gate grammar.

The registry proxy returned HTTP 403 for `fake-indexeddb@6.2.8`; local tests use
the nearest earlier downloadable version, `6.2.7`, through an uncommitted
override. Its workspace and lockfile changes are excluded from the commit.
The proxy also blocked the full examples install at `@tanstack/react-start`
`1.169.5`; `1.169.4` downloads but was not selected, because examples were
excluded from the successful root/db/db-ivm filtered install.

The intended lockfile uses the downloaded commit-pinned tarballs' actual hashes
and metadata. Upstream moved TypeScript from optional peer to dependency; that
metadata change is included. A frozen filtered install succeeds with the local
override. The handoff's scratch-CI regeneration passed in
[run 42868324651](https://github.com/TanStack/db/actions/runs/42868324651):
`pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile` produced
no diff against the committed lockfile. PR CI also completed frozen dependency
installs and all test groups on head `77317dc32`. The downloaded artifact is
byte-identical; SHA-256 is
`03a04b417c0c49fc122fbf529af2b03318b0da77b6a91b513fe067c354e5651a`.

The gate assumes valid unique entries and a settings module present at base,
with literal exports and no imports. The external lint plugin owns malformed
entries, stale entries in files that still exist, and legacy-use classification.
Deleted files have no lint invocation; remove their baseline entries when
deleting them. The gate permits reason edits and tests file identities.
The upstream malformed-entry lint fix has not
landed at the checked main head; all adopted entries are well formed.

An independent reviewer tested implementation `9a5214f28`: all five gate tests
pass with `GIT_CONFIG_GLOBAL=/dev/null` to isolate fixture commits from the
user's global hooks. Four separate temporary-repository probes exercised the
default merge-base path (addition, removal, adoption, and removed-setting
addition). The classifier inventory matched all 199 baseline identities. The
review found no confirmed gate correctness defect. Initial runs affected by a
blocked global Git hook supplied no oracle verdict. Source mutants and the
wider compatibility/install checks were not independently repeated.

## Conversion survey

`node scripts/oracle-campaign-inventory.mjs` applies the installed lint rule
with an empty baseline. It finds 199 files: 196 existing files and 3 restored
compatibility tests. Shapes are 104 manual-reach files, 24 campaign-helper
files, and 71 raw-campaign files. There are 45 fixed-history candidates,
50 files with one raw call, and 3 mixed `oracleProperty` files. These lexical
shape flags aid planning; they do not establish complete fixed-history coverage.

| Package | Legacy files |
| --- | ---: |
| db | 86 |
| convex-db-collection | 20 |
| db-ivm | 16 |
| react-db | 13 |
| db-sqlite-persistence-core | 12 |
| browser-db-sqlite-persistence | 9 |
| query-db-collection | 8 |
| electric-db-collection | 7 |
| svelte-db | 6 |
| scripts | 6 |
| offline-transactions | 3 |
| preact-db | 3 |
| db-adapter-conformance | 2 |
| trailbase-db-collection | 2 |
| electron-db-sqlite-persistence | 1 |
| node-db-sqlite-persistence | 1 |
| powersync-db-collection | 1 |
| react-native-db-sqlite-persistence | 1 |
| rxdb-db-collection | 1 |
| solid-db | 1 |

Conversions must preserve every earlier killed mutant key under the same seed,
all laws/statements/budgets, and required reach. Literal required histories
become randomized constructions. Each group needs actual receiving-path
evidence; an unowned mutation report is not a preservation comparison.

## Review follow-up

CodeRabbit's review of `77317dc32` raised four substantive findings. All were
verified against that source and addressed without changing shipped behavior:

- The migration ratchet now preserves required Playwright real-host witnesses.
  The pinned framework registers Vitest tests, so unsupported receiving paths
  block affected production changes until an equivalent real-host replacement
  passes; retaining the legacy witness grants no conversion exception.
- The glossary distinguishes an unreached state's required reach evidence from
  the named kill needed to close a mutant gap.
- ORC-015 explains that the pinned API has no numeric minimum-count option.
  N randomized constructed builders each requiring a state guarantee N reached
  histories. A direct API probe with ten builders and runs=1 reported ten in
  both campaigns; a builder that missed the state failed.
- Temporary gate-fixture commits now isolate inherited Git hooks. The shared
  grammar generates blocking pre-commit and prepare-commit-msg hooks. Before
  isolation the latter stopped fixture setup at seed `20261110`, path `0:0:0:0`;
  afterward all five gate tests and that exact replay pass without a global
  Git-configuration workaround. Fixed-seed and random campaigns reached the two
  hook kinds 14/11 and 10/10 times. This RED is a fixture setup defect, not a named
  product-law mutant kill.

The three scoped repairs are committed in `b7f713f03`; explicit ESLint,
formatting, changed-file lint and normal commit hooks passed. The earlier gate
mutation evidence remains bounded by the same membership model and CLI path.
The runner clarification changes documentation only and does not claim that
Playwright registration support has been implemented.

## Second review follow-up

CodeRabbit review `5846877275` checked `9b43e97ff602a159277fb8ba381b931f2e9192a0`.
Both findings were reproduced against the unchanged `e1fb504` framework and
fixture driver before their scoped corrections.

The reach law requires every constructed builder to check each state it names.
A two-builder API probe used `runs: 1`, fixed seed `42`, and disjoint `enters`
claims, `earlier` and `later`. The production driver reported only `later`.
Returning `false` from both builders passed with reach `{earlier: 0, later: 3}`.
Returning one shared object from both builders produced the same false green.
The framework's map kept only the later builder for the repeated history.

Returning fresh objects instead rejected the missing `earlier` state at path
`0`. Omitting only `later` rejected the later builder at path `1`. Reporting
both states passed with reach `{earlier: 3, later: 3}`. Primitive histories can
also remain safe: builders returning disjoint values `false` and `true` passed,
and omitting the former's state failed at path `0`. ORC-015 now requires
collision-free constructions and verification of every builder's state check.
A single primitive-valued builder remains permitted. This corrects the
instructions; it does not claim that the external framework defect is fixed.

The Git fixture law requires developer global configuration to leave fixture
setup and the gate's completed report unchanged. The existing membership model
and `only shrinks` comparison remain independent of that configuration. The
history grammar now crosses plain/strict CRLF global configuration with all
three hook choices, including a constructed strict-config/no-hook history.
Strict configuration sets both `core.autocrlf=true` and `core.safecrlf=true` in
a temporary file; no developer configuration is changed.

The extended grammar on the unchanged driver failed at seed `20261110`, path
`5:0:0:0:0`, with empty base/head sets, no adoption or prior gate, `hook: none`,
and strict CRLF configuration. `git add .` exited `128` because LF would be
replaced by CRLF. This is a fixture setup failure, not a named product-law kill.
The repair supplies the fixture's global configuration to every fixture Git
command and the gate child process. Inherited hook controls remain, and fixture
commits still use a local `core.hooksPath` override without bypassing hooks in
the working repository.

Verification, with at most two Vitest workers:

```sh
./node_modules/.bin/vitest run --config scripts/oracle-scripts.vitest.config.mjs scripts/legacy-campaign-baseline-oracle.property.test.js --maxWorkers=2
TANSTACK_DB_ORACLE_PROPERTY=scripts.legacy-campaign-baseline TANSTACK_DB_ORACLE_SEED=20261110 TANSTACK_DB_ORACLE_PATH=5:0:0:0:0 ./node_modules/.bin/vitest run --config scripts/oracle-scripts.vitest.config.mjs scripts/legacy-campaign-baseline-oracle.property.test.js --maxWorkers=2
```

All five gate tests passed, and the direct RED-history replay passed. The
fixed-seed/random campaigns reached strict global configuration without hooks
5/6 times. They reached inherited pre-commit hooks 10/9 times and inherited
prepare-commit-msg hooks 12/9 times. Both base run budgets remain 20. The shared
always-accept calibration still rejects the wrong completed report.

The two inline findings (`4528611050`, `4528611070`) are addressed within this
PR's documentation and fixture scope. The additional prose comment is addressed
with the precise term “fixed-seed and random campaigns.” The repeated generic
docstring-coverage advisory names no missing explanation; it supplies no new
finding beyond the earlier advisory. Remaining limits are the four-file
membership domain, valid settings, and the two modeled global-configuration
forms. External framework repair and whole-PR readiness are separate work.

The final scoped source passed explicit ESLint, formatting, and changed-file
oracle lint. No framework package, production gate, campaign law, or run budget
changed in this follow-up.

## Third review follow-up: generated constructions

CodeRabbit review `5847211592`, inline `4528863611`, checked
`e7fe57ea1320cb717f323fa8b291ff796e69f60b`. Its finding distinguishes the
seed-derived constructed histories that enforce a campaign's minimum from
fresh constructed histories produced during the generated run budget.

An executable probe on the unchanged `e1fb504` package uses a record grammar
`{ n: integer, constructed: boolean }`, seed `42`, and `runs: 100`. Its builder
returns a fresh record with `constructed: true`. The production driver reports
state `required` only when `n` equals the source record sampled at seed `42`
(`n: 9`). A local `WeakSet` counts builder outputs without changing the
production driver or framework semantics. The native campaign passes with
reach `{required: 1}`, although 45 of the 46 executed builder outputs omit the
state. The framework's history-to-builder map contains only the initial
seed-derived object; the later fresh outputs carry no automatic obligation.

A shared check that rejects a marked construction without the state reports
law `constructed reach` at `completed`, seed `42`, path `2:0:0`, for
`{n: 0, constructed: true}`. Making the same driver report the state for every
constructed history passes with the same check and budget; none of the 46
builder outputs misses it. Separately, suppressing the state on the initial
seed-derived history fails the framework's existing constructed-state check at
path `0`. The original minimum is enforced, while the claim about every
generated construction needs an additional check.

ORC-015 now states both obligations. The original seeded constructions still
enforce the minimum. A conversion also checks builder outputs over generated
inputs against actual state observations. This is a DB guidance correction;
it does not claim to repair the external framework. The finite probe covers
one object-valued builder, one state, one seeded campaign, and no state probes
or primitive-history association.

The gate oracle applies that requirement within its original grammar and
20-history budgets. Each existing builder still returns a fresh object. A
local `WeakMap` records its declared state obligations on every builder
invocation, including generated and shrunk constructions. The model carries
those declarations beside the independent membership report. The shared
check compares them with the production driver's actual state observations.
The map stores no production answer, does not modify the history language,
and is rebuilt by the same builder calls during direct replay. Weak keys
release histories after the framework releases them.

A generated-only observation mutant preserves all eight initial seed-derived
constructions, then drops the declared state observations for later builder
outputs. Keeping the old permissive reach comparison passes this mutant.
The repaired shared check rejects it with law `constructed reach` at
`completed`, seed `20261110`, path `8:0:0:0:0:0`:

```json
{"adopted":true,"enforced":false,"base":[],"head":["packages/db/tests/a-oracle.test.ts"],"hook":"none","globalConfig":"plain"}
```

The required `addition` and `empty baseline addition` observations are
missing. The report and exit-status comparison still passes, so its named
failure isolates constructed reach. A permanent wrong-trace calibration
removes a required state while retaining the completed report and requires
this same check to reject it. Restoring the observations gives six passing
tests, with both original 20-history campaigns. No new campaign, property ID,
production gate change, or history field was introduced.

The restored direct replay passes and its guard records one execution of one
history for the exact property, seed, and path:

```sh
TANSTACK_DB_ORACLE_PROPERTY=scripts.legacy-campaign-baseline TANSTACK_DB_ORACLE_SEED=20261110 TANSTACK_DB_ORACLE_PATH=8:0:0:0:0:0 pnpm_config_verify_deps_before_run=false node --import tsx packages/db/tests/oracle-replay.ts --maxWorkers=2 --config scripts/oracle-scripts.vitest.config.mjs legacy-campaign-baseline
```

In the clean fixed-seed/random campaigns, the eight state counts are:
`addition` 10/7, `adoption` 5/5, `empty baseline addition` 4/3,
`inherited pre-commit hook` 10/10, `inherited prepare-commit-msg hook` 12/10,
`removal` 7/4, `retired baseline addition` 4/8, and
`strict global config without hooks` 5/7. These finite results establish the
local check's sensitivity; they do not repair or certify upstream's general
constructed-history association.
