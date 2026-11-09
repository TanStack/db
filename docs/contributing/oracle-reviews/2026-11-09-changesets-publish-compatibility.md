# Changesets publish compatibility

Reviewed base: `d4448ca49c3db623b63005ad7f2e3c35cdbc85df`.
Repair commit: `PENDING_CODE_SHA`.
The publisher's repaired SHA-256 is
`65229f7a47f182f363528082a4495bec3f3e7638e81c754cfb579d5a7cc67134`.

## Law, defect and repair

`CONTRIBUTING.md` Changesets/Releases and the existing independent release
ledger require missing public stable/candidate versions to upload once under
`latest`. Existing versions are skipped. Temporary phase isolation must restore
the original config, prerelease state and public/private manifest bytes after
success or publication failure. Packing retains authored runtime and peer
dependency edges; the fixture's bounded `workspace:*` edge becomes its target's
authored exact version.

Changesets CLI 2.31.1/config 3.1.4 rejects a public dependent when its dependency
is temporarily private and config disables private versioning. The existing
release fixture exercises that valid configuration. The repository's own
config omits `privatePackages`, which defaults to versioning private packages;
this is not evidence of a production-registry failure with that default.

The publisher temporarily enables `privatePackages.version`, retaining every
other config field and the independent manifest-based upload filter. It saves
and restores the original config Buffer in `finally`. It neither changes
`ignore` nor removes dependencies. Upstream `publishPackages` filters private
manifests before metadata lookup and uploads, independently of private
versioning. Explicit private Git-tag policy is preserved rather than enabled.

## Grammar, receiving paths and checkpoints

The primary owner remains `scripts/release-history-oracle.js`. All original
29 HTTP histories remain an unchanged prefix; all 40 strict-command histories
remain unchanged. Four appended HTTP histories cover private policy `false`,
`false` with a runtime edge and candidate failure/retry, omitted/default policy
with a runtime edge, and explicit versioning. Existing histories retain the
object form `{ version: false, tag: false }` and peer edges.

Both drivers invoke the production publisher. The strict receiver forwards to
real Changesets while recording registry commands. The HTTP receiver executes
real npm 11.17.0/pnpm 11.1.0 against a loopback server and inspects actual packed
manifests. The shared ledger predicts uploads/tags independently of Changesets.
The added dependency model uses authored manifests, not observed archives.
Every attempt compares saved bytes before publication/retry judgments; each
archive's runtime/peer maps are compared after packing. Noncanonical config
spacing distinguishes exact restoration from parse-and-reformat restoration.

Final normal HTTP reach: 33 histories each reach public-dependent, registry
reads, restoration and completed comparison; 26 reach packed uploads, 12 reach
controlled failure/partial publication/retry, and seven reach already-current.
Private-policy reach is 29 object-disabled, two false, one default and one
explicit versioning. All 40 command histories satisfy their declared reach.

## RED, GREEN and hostile controls

Before editing production, the expanded oracle gave **71 failed / 14 passed**
in 37.71 seconds. The original publisher SHA-256 was
`0ee310d0476278ce48bbff50fd5548081369db90b932086f958f4db0c720899e`.
All failures reached upgraded config validation, before uploads. Default and
explicit-version controls reached real packed uploads and ledger comparisons.
This is an upload-fulfillment RED; failed-validation cases receive no credit
for controlled publication failure, retry, or archive comparison.

An initial repaired run passed all 39 HTTP tests but exposed 36 strict-fixture
failures: upgraded Changesets moves `--json` after the same publish flags. The
fixture now accepts exactly both argv forms. Ordinary positive controls prove
both; malformed duplicate/foreign options remain rejected. This changes no
product expectation. A final-fixture replay of the frozen original publisher
again gave **71 failed / 14 passed**, in 38.87 seconds, with the same config
validation failure and no unsupported-command failures.

The final repaired run gave **85 passed** in 133.37 seconds: 40 command histories,
33 HTTP histories and 12 checker controls. Ordinary publisher/fixture controls
gave **32 passed**. An initial scratch control run lacked the unchanged
`version-packages.mjs`; its three import failures were setup failures, then
passed after the missing source was copied. Direct changed-file oracle lint
feedback passed. No oracle budget or comparison was reduced.

Hostile controls use only a scratch publisher and restore it afterward:

- The frozen original reproduces the validation defect above.
- Parse-and-reserialize config restoration fails both selected false-policy
  histories at the original-byte comparison, despite successful HTTP uploads.
- Temporarily removing runtime/peer edges while restoring all local bytes
  fails both selected default/version-policy histories at the packed-edge
  comparison. Their real uploads and exact-byte checks pass before that
  intended assertion rejects the missing runtime or peer edge.

Normal command:

```sh
TANSTACK_DB_ORACLE_STATISTICS=1 vitest run \
  --config scripts/oracle-scripts.vitest.config.mjs \
  scripts/publish-http-oracle.property.test.js \
  scripts/publish-history-oracle.property.test.js \
  --maxWorkers=2 --minWorkers=1
node --test scripts/publish-packages.test.mjs \
  scripts/release-fixture.test.mjs scripts/release-http-fixture.test.mjs
```

Finite HTTP replay selects its complete unique Vitest title. The focused
config control uses `-t 'privatePolicy.*false'`; the packed-edge control uses
`-t 'privatePolicy.*(default|version)'`. These are finite histories, not random
campaigns or arbitrary-schedule claims.

## Tool provenance and limits

Local exact npm tarball requests returned HTTP 403. All Changesets runtime
packages were instead built together from the official tag
[`@changesets/cli@2.31.1`](https://github.com/changesets/changesets/tree/%40changesets%2Fcli%402.31.1),
including config 3.1.4 and matching internal packages. The codeload archive's
SHA-256 is `97b1609cb26116f0394eaf377b52c2daeef6a8659ba45f60d961f7ea9d12dd49`.
Builds and fake registries remained under `/tmp`; external compatible tools
were read-only links to the existing installation. Shared dependencies were
neither installed nor rebuilt. The production publisher was copied verbatim
into the tool-resolvable scratch suite.

This is tagged-source toolchain evidence, not the published compiled
distribution or final-lockfile CI. Real npm authentication, production
registries, installed consumers, arbitrary semver/workspace ranges, optional
dependencies, failing filesystem restoration writes, and Windows process
cleanup remain outside this bounded receiver. Final repair-head CI must
receive the published upgraded tools before merge readiness is claimed.

## Oracle review outcomes

| Requirement | Outcome |
| --- | --- |
| ORC-001 Authority/limits | Existing release authority and bounded packing rule are stated above; no release-policy change. |
| ORC-002 Independence | Authored version ledger and range mapping import no Changesets planner, config validator or archive classifier. |
| ORC-003 Responsibilities | Shared model/grammar, production drivers and observation comparisons remain distinct and explained. |
| ORC-004 Grammar | Original histories are preserved; four neighbors distinguish config spellings, runtime/peer edges and retry. Impossible already-current/failure histories remain excluded. |
| ORC-005 Path/cut | Real CLI and npm/pnpm HTTP paths compare bytes after each attempt and actual archives after packing. |
| ORC-006 Calibration | All 12 existing checker controls pass; hostile restoration and dependency controls challenge the added observations. |
| ORC-007 Campaign/replay | Bounded enumeration uses complete test titles; no seeded/random campaign claim applies. |
| ORC-008 Minimality | Existing ledger is unchanged. Exact-version presence and tags remain distinct; packing adds only two authored dependency maps. |
| ORC-009 Vocabulary | Release versions, attempts, archives and restoration name their concrete observations; no runtime Collection publication is inferred. |
| ORC-010 Failure fidelity | Validation RED, unsupported argv, missing scratch source and actual assertion failures are classified separately. Existing process cleanup controls pass. |
| ORC-011 Second formulation | No concrete shared semantic-fault hypothesis requires a second release planner. Actual archives receive the authored range rule without restating the ledger. |
| ORC-012 Review evidence | This record retains base/source hashes, chronology, reach, commands, mutant classifications and limits. |
| ORC-013 Boundary witness | Disabled versus default/versioned config and runtime versus peer edges distinguish plausible wrong compatibility repairs. |
| ORC-014 Handoff | Real npm/pnpm packing receives the dependency premise; Changesets is built from matching tagged source. Published-dist CI remains open. |
| ORC-015 Reach | Per-history assertions enforce the normal counts above, rather than crediting setup or validation-only failures as uploads. |
| ORC-016 Law-only files | New cases replay shared model/driver/comparisons; ordinary argv controls remain in a fixture test file. |

Independent source review found no confirmed production regression. It identified
the canonical-JSON sensitivity gap, which the noncanonical fixture and hostile
restoration control close. The reviewer ran no tests; execution evidence above
belongs to this repair record.
