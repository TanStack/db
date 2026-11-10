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
override. A full clean install and the handoff's scratch-CI lockfile regeneration
remain pending publication approval; local test success does not establish them.

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
