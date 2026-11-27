# Package naming evidence

Base: `4fc3689bf50e43c0278e24f4d42bd7c92c323106`. The linter and oracle were
added and exercised before the package or its directory changed. This record
covers that base plus the working-tree changes identified below; it does not
claim that a new commit has been published.

- **Law:** public packages use `@tanstack/<directory>`, lowercase kebab case,
  a whole `db` word, and `-db-collection` for collection adapters. The existing
  `offline-transactions` name is the sole `db` exception. Private packages and
  nested apps are excluded. Authority: the maintainer's November 27 request and
  `CONTRIBUTING.md`, Package names.
- **RED:** before the rename, `pnpm lint:package-names` exited 1. It inspected
  26 public manifests and reported `db-segment` and `collection-suffix` for
  `packages/powersync-direct-collection/package.json`.
- **GREEN:** after the rename, the same command exited 0 and inspected 26
  public manifests. The naming oracle passed all 44 registered checks with
  `pnpm exec vitest run --config scripts/oracle-scripts.vitest.config.mjs
  scripts/package-names-oracle.property.test.js`.
- **Mutant:** temporarily omitting both identity checks made the exact
  PowerSync regression and a generated missing-`db` construction fail the
  `package naming` law at `process exit`. The generated failure shrank to
  `{stem: 'a', family: 'binding', edit: 'missing-db'}`. The original linter was
  restored. A bound corrupted-observation control preserves the same wrong
  acceptance in the committed oracle.
- **Replay:** seed `27112026`, path `0:0:0:0`, property
  `scripts.package-names`, unit `random seed: missing-db` failed with that
  source mutant and passed after restoration. Run the oracle command above
  with the corresponding `TANSTACK_DB_ORACLE_SEED`, `_PATH`, `_PROPERTY`, and
  `_UNIT` variables to select it directly.
- **Limits:** four generated naming families, one naming edit per target,
  one healthy peer, and ignored private/nested/example fixtures. Stems have
  one to three words of up to twelve characters and exclude the reserved
  `db` word. This does not check registry availability, malformed JSON, symlink
  packages, npm publication, or adapter runtime behavior. An automated gap
  report was attempted but refused because it found no test files under the
  scripts-root Vitest configuration; no mutation-completeness claim follows.

The base run budget is 40 in each fixed/fresh campaign. Each of nine
constructions retains random stems and families, returns a fresh object, and
enforces its state. In the recorded GREEN run, constructions reached every
state five times in each campaign; the generated units added these counts:

| State | Fixed generated | Fresh generated |
| --- | ---: | ---: |
| valid | 5 | 4 |
| missing-db | 5 | 4 |
| scope | 3 | 4 |
| folder | 2 | 6 |
| kebab | 5 | 5 |
| collection-order | 5 | 4 |
| offline | 3 | 3 |
| private | 6 | 6 |
| missing-name | 6 | 4 |

Every construction has a bound missing-state control. The comparison checks
the state on generated executions too, so an omitted state cannot be hidden
by another constructed execution.

| Rubric | Evidence or trigger limit |
| --- | --- |
| ORC-001–003 | Opening law and limits; independent edit-based model; separate input renderer, CLI driver, and exit comparison. |
| ORC-004 | The original name is reconstructible as a generated missing-db collection. Each edit changes one naming fact; removing its axis loses that distinction. Bounds are stated above. Invalid scope, folder, spelling, identity, and suffix forms are rejected rather than skipped. |
| ORC-005 | Real filesystem and Node CLI; full diagnostic paths, rule list with duplicates, public count, and exit code. |
| ORC-006 | Source mutant and bound wrong-acceptance control both fail the naming comparison. |
| ORC-007 | Same 40-run grammar and driver in fixed/fresh campaigns; captured path replay checked RED and GREEN. |
| ORC-008–009 | No lifecycle model or model-only subsystem concepts; histories describe manifests and naming edits. |
| ORC-010 | Synchronous process results are recorded before temporary-directory cleanup in `finally`. No asynchronous provider resources are created. |
| ORC-011 | No shared production/model classifier: the model predicts from the authored edit. No concrete shared semantic fault was identified. |
| ORC-012 | This versioned record identifies the base and reviewed source hashes. |
| ORC-013 | Missing-db binding and misplaced collection suffix distinguish the two identity rules. A healthy peer and invalid nested fixtures distinguish discovery boundaries. |
| ORC-014 | The real Node/filesystem CLI supplies the tested boundary; no remote-provider or browser claim. |
| ORC-015 | Declared constructed states, counts above, generated-execution comparison, and one bound missing-state control per builder. |
| ORC-016 | Only `oracleProperty` registers tests. The PowerSync regression uses the shared model, driver, and comparison. |

The two moved adapter production files are byte-for-byte identical to the
base. The renamed package and its dependencies build successfully. The selected
collection, protocol-request, and startup ownership suites pass 73 checks with
no type errors. Changesets accepts the renamed release entry. Existing adapter
laws, histories, campaign budgets, and observation cuts remain unchanged.

Reviewed SHA-256:

```text
f9768982da759e395508cd6b1260e98a00bdcdd187053dbb0a5a7e737e25decc  scripts/check-package-names.mjs
eaa0816e0fd7c3cbb85b17930022fb40e7d67d9e6459b2fbad1a4d7fe99999d5  scripts/package-names-oracle.property.test.js
```

## Expanded workspaces and branch reach

The maintainer's follow-up asked for multiple invalid packages, combined
faults, and reach measured at the actual validation branches. This section
supersedes the single-target bounds and input-labelled reach above. The naming
policy, property id, fixed seed, and 40-run campaign budgets remain unchanged.

**Law and model.** Every public package owes every applicable diagnostic. The
grammar now draws one to four targets and subsets of scope, directory,
spelling, db-word, and collection-suffix edits. Private and missing-name
boundaries determine which rules apply. A collection with both db removal and
suffix displacement owes one suffix diagnostic, not two. Optional healthy and
offline peers vary workspace composition. The reference unions the rules broken
by the authored edits; it does not classify the resulting names.

**Original gaps.** Before changing the oracle, both of these self-generated
source mutants passed all 44 original checks:

- Suppress diagnostics from every invalid package after the first, while still
  counting all public packages. The original grammar had only one bad target.
- Skip spelling validation when the scope is wrong. The original grammar never
  combined those faults.

The original source/oracle hashes are recorded above. For the first policy, the
original source control remembered the first reporting package; after the
instrumentation refactor, `errorsBefore > 0` expresses the same suppression
policy. The second control adds the same scope condition to the spelling gate
in both versions.

**Instrumentation RED.** The extended grammar and CLI driver were written
before the linter changed. Running the two new constructed units against the
uninstrumented linter failed `reach agreement` at `states`: the expected native
probes were never reached. The public naming comparison passed. This is an
instrumentation failure, not evidence of a naming defect in the old linter.

**Actual branch reach.** The linter marks each validation decision reached with
a false probe call. Only entry into its corresponding branch emits true.
Missing-name and private branches follow the same rule. Accepted names and the
offline exemption have their own probes. At each package's end, probes use the
actual before/after diagnostic counts to distinguish two invalid packages from
two failures in one package. Those are different conjunctions, not unions of
unrelated per-workspace branch hits.

A test-only Node preload forwards the raw calls on fd 3. After the child exits,
the production driver forwards them to the framework collector inside that
history's window. The model and public comparison do not receive the calls.
Every state binds its native probe, has an independent `predict` result, and has
explicit entered/not-entered history bindings. All 22 forced-entry controls
pass. Generated histories receive the same reach-agreement judgment as
constructed histories; no summary or input label supplies reach.

**GREEN.** The extended oracle passes 70 checks. Each campaign runs 40 generated
histories plus 11 randomized constructions over five bases each. The 95
non-fixed histories per campaign reached these states; fixed histories and
calibration executions are not included:

| Native state | Fixed campaign | Fresh campaign |
| --- | ---: | ---: |
| valid | 73 | 80 |
| missing-db | 32 | 29 |
| scope | 39 | 34 |
| folder | 27 | 31 |
| kebab | 30 | 34 |
| collection-suffix | 27 | 28 |
| offline | 49 | 53 |
| private | 42 | 44 |
| missing-name | 56 | 45 |
| multiple-invalid-packages | 50 | 41 |
| combined-faults | 41 | 40 |

Each state's own construction reached it five times in each campaign.

**Source mutants.** The oracle retains these three source controls as bound
`calibrations`. Each writes a temporary copy of the actual CLI, requires its
find text to occur exactly once, and uses the same driver/model/check. External
runs also applied each edit to the linter itself and failed at the named law:

| Mutant | Exact final source edit | Rejection |
| --- | --- | --- |
| suppress-later-invalid-packages | Add `if (errorsBefore > 0) return` at the start of `report` | `package naming`, `process exit`: later target diagnostics are missing. |
| skip-spelling-after-wrong-scope | Replace `if (wrongSpelling)` with `if (wrongSpelling && !wrongScope)` | `package naming`, `process exit`: the composed spelling diagnostic is missing. |
| scope-probe-never-enters | Replace the scope branch's true probe with false | `reach agreement`, `states`: scope entry is absent although the public diagnostic remains correct. |

All three are intended comparison failures, not crashes, setup failures, or
timeouts. Each captured path was replayed against its mutant and then against
the restored source: RED 1, GREEN 0. The property is `scripts.package-names` and
the campaign seed is `27112026`:

| Unit (`random seed: …`) | Path |
| --- | --- |
| multiple-invalid-packages | `0:1:1:1:1:1:2:2:2:2:2:3:3:3` |
| combined-faults | `0:2:1:1:4:4:4:4:4:4:4:4` |
| scope | `0:0:0:0:0:1:1` |

Use the oracle command above with the corresponding `_PROPERTY`, `_SEED`,
`_UNIT`, and `_PATH` variables. These coordinates belong to this expanded
grammar; the earlier single-target replay coordinates remain historical.

**Limits and rubric update.** ORC-001–003 retain the law and independent
edit-based reference. ORC-004 now includes workspace cardinality, composed edit
subsets, and the restriction of suffix displacement to collection inputs.
ORC-005–007 use the real CLI, the complete diagnostic multiset, three source
controls and checked path replays. ORC-008–009 add no subsystem lifecycle or
model-only production concepts. ORC-010 keeps synchronous child-process
settlement and cleanup in `finally`; ORC-011 has no identified shared semantic
classifier. This append-only record and source hashes satisfy ORC-012's
identification requirement. ORC-013 distinguishes one versus several failing
packages and individual versus combined faults. ORC-014 still claims only the
real Node/filesystem boundary. Native branch bindings, independent predictions,
constructions and forced controls replace the former label-based ORC-015
evidence. ORC-016 still registers only through `oracleProperty`.

This is a bounded campaign, not exhaustive enumeration of every name or
workspace. Stems still exclude the reserved db word; standalone
offline-transactions is excluded from generated stems and supplied separately.
There is no registry, malformed-JSON, symlink, or adapter-runtime claim. No
automated gap-report completeness claim is added. All selected mutants are
rejected; no selected survivor remains.

Reviewed source SHA-256 for this extension:

```text
9199138a5f2dd3c8400a5c6beb3f0d42749cb0388335a7a68207ae639f0d3d94  scripts/check-package-names.mjs
37bdb9e7b2d5046c21719c9fa0272f5a2084cb73560be158fd2a3ba4204b302e  scripts/package-names-oracle.property.test.js
a08417c4a026826a26505329636e42cce98c8c9e6fb790cb96acdfe8d7e2e7eb  scripts/package-names-probe-bridge.mjs
```
