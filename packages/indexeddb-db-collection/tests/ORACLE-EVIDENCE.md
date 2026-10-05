# IndexedDB oracle review evidence

Date: 2026-10-05. Parent checkout: e984780a0535fad977735aa16cc9ab400eb5cd2c
(the PR merged with origin/main at 4070864414f26212dcef20e2537057bff8e21535).
These results apply to the uncommitted implementation snapshot identified below,
not to the unchanged remote PR head. The combined source/test/config manifest
SHA-256 is 5cbfad113bdc556793c0de4072ec73ecea38503a733f303493006adabecc65c7. Hashes exclude this evidence file to avoid self-reference.

## Results

- Original production, rebuilt initial runtime suite: 26 failures, 14 passes,
  plus 23 uncaught errors/rejections. Failures reached public/durable assertions.
  This was a red test run, not a clean success despite some passing assertions.
- Direct replay of fixed seed 1179001 / path 0:1:0:0:2:2 reproduced the original
  clear failure at the public snapshot checkpoint. The same coordinates pass
  with the repaired source, running only the replay campaign (two executed
  histories after applying the shrink coordinate).
- Added API witnesses failed before their repairs: schema input/default
  handling, duplicate imported keys retaining prior state, reserved metadata
  store admission (three failures).
- A random history exposed update followed by clear retaining accepted
  optimistic data. It was retained as an authored test. The immediate-confirm
  mutant still reaches and fails that same public snapshot checkpoint.
- Final normal Vitest command: 74 passing tests, comprising 51 runtime and 23
  type tests. No unhandled errors. Fixed seed 1179001 and random seed 163687465
  each completed 30 histories. Earlier passing unseeded campaign: 1635039643.
- Final coverage: indexeddb.ts 98.08% lines / 88.17% branches; package overall
  85.75% lines. Exported standalone error classes are not covered. Percentages
  do not establish any of the excluded lifecycle/host laws.
- All source and test-driver types pass tsc --noEmit. Full-package ESLint passes.
  ESM and CommonJS builds and their declarations pass. git diff --check passes.

The available dependency installation was incomplete; validation used the
existing cached toolchain plus the package's declared fake-indexeddb and
coverage dependencies. Runtime: Node 24.19.0, Vitest 3.2.4, Vite 7.3.2,
fake-indexeddb 6.2.5. The package now checks the built core package exports;
source aliases had caused Vitest rootDir errors. Those configuration/setup
failures were not product-law failures and earned no oracle credit.

## Repair evidence and test gaps

| Finding                                                        | Missing original observation                                | Receiving witness / repair                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Mixed manual mutations entered the wrong store                 | Other-Collection mutations with overlapping keys            | Generated/manual two-store histories; filter by owning Collection before persistence/publication.                      |
| Failed writes reported success and could leave orphan versions | Exact persistence outcome and raw rows/versions             | Clone-failure matrix at both positions, automatic/manual/import; await every request and abort one batch transaction.  |
| Batch prefix survived later failure                            | More than one row plus later failure                        | Per-row-transaction mutant fails automatic/manual durable-prefix assertions; shared batch transaction repairs it.      |
| Handler rejection persisted changes                            | Held decision cut and rejected suffix/reopen                | CRUD × resolve/reject; run handler before durability or notification.                                                  |
| Clear/import left stale public rows                            | Exact public source replacement with reused keys            | Generated replacement histories; truncate and publish replacement after successful atomic persistence.                 |
| Immediate confirmation retained accepted optimistic rows       | Update then replacement after settlement                    | Pinned generated history and immediate-confirm mutant; queue ordinary confirmation behind optimistic settlement.       |
| Remote deletion was lost under local optimistic delete         | Independent source deletion plus rollback/commit            | Delete/clear × local rollback/commit; keyed source deletes and truncate independent of public visibility.              |
| Failed/unfinished startup reported ready                       | Populated restore plus abort/native completion              | Exact preload/status and native-complete witnesses; publish readiness after transaction success, markError on failure. |
| Wrapper lost callback outcomes and errors                      | Callback completion separate from native completion         | Both completion orders, exact callback errors and request-success/abort; wait for both success obligations.            |
| Invalid imports changed storage                                | Schema input/defaults, duplicate keys, retained prior state | API and atomic replacement tests; validate/normalize all inputs before opening the replacement transaction.            |
| Internal version store was admitted as user data               | Reserved-name boundary                                      | Reject reserved store declaration and Collection configuration.                                                        |

Two oracle assumptions were corrected during development using counterexamples:
attempted no-op edits do not promise either preserved or regenerated versions;
and omitted optional values and explicit undefined are the same in this bounded
value model. These corrections do not waive changed-value version checks,
unrelated-key stability, durable row equality or extra-field checks.

## Calibration classification

| Control                                           | Outcome                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Missing/duplicate/wrong-key/extra-field snapshots | Permanent checker assertions reject all four.                                                                                 |
| Per-row transaction mutant                        | Assertion kill at aborted durable snapshot: two failing cases, one unrelated import control passes. No timeout/setup credit.  |
| Immediate-confirmation mutant                     | Assertion kill at update-then-clear public snapshot.                                                                          |
| Partial-row sync mutant                           | Survives both transport cases; equivalent for their undefined-valued field removal. No arbitrary full/partial-row conclusion. |
| Misaddressed diagnostic config invocation         | Setup failure; corrected and rerun. No product evidence credited.                                                             |
| Native browser handoff                            | Not run; explicitly unresolved in ORACLE.md and the coverage map.                                                             |

The portfolio claims bounded evidence, not universal closure. Remaining
same-key writer, delayed replacement, pending-cleanup, native-browser and
transient-publication cells retain owners in the coverage map.

## Code weight against the merged parent

Production: 1,821 to 1,565 lines (net -256).
TypeScript tests/helpers: 3,139 to 1,920 lines (net -1,219).
Documentation: net +285 lines across README, both oracle records and the coverage map.
The runtime rewrite preserves useful old API/wrapper/type contracts while
replacing repetition, sleeps and optimistic-only assertions with the named owners.

## Reviewed manifest

```text
251f77c89681fc37e3c31932315700d877c34171d37b9e0423abf5f900e79d57  packages/indexeddb-db-collection/package.json
2d976cd7fd8593e750cd7f11cce1a9a5e1e31e36d9a3571c99b22b900aad7141  packages/indexeddb-db-collection/src/errors.ts
3d1dcd35449ce425dcaec3e9f78e2406ce774fb2d6ac857e93f639615097441e  packages/indexeddb-db-collection/src/index.ts
becc58763c62d803a6df4a2ac987efd7b348400ed993814a3361340ac8328d2d  packages/indexeddb-db-collection/src/indexeddb.ts
cac94ec7c04e70c88c12c06cbfe3a2b75cb6e4e1af7f08a6f5e7f9783321e19d  packages/indexeddb-db-collection/src/wrapper.ts
583616735a78d2b6c72b27b7340f887c3d9c5439560a04d41970d636763bb611  packages/indexeddb-db-collection/tests/api.test.ts
0c9448f59fbb8c43aee254f71641adcfecca4951c26858675ff2fb54168966ef  packages/indexeddb-db-collection/tests/harness.ts
19cc1a5def94c8801b436a0ed92b000f71e8c34050a7ba56af1f94c06e5e8612  packages/indexeddb-db-collection/tests/indexeddb.test-d.ts
559dc0f96952fff5f1ed284770c281beba06f33441036cc0bbeee5eb09ffb0a9  packages/indexeddb-db-collection/tests/persistence-oracle.test.ts
c84fafccc28c982a8d1fbefd5d0ead71da9c78afa9b8e56c9af1643e67d8cdca  packages/indexeddb-db-collection/tests/settlement-oracle.test.ts
e2774ae3ae7c2dfb40ade3eae7d50a45a063e5624985a7f2fe4f095d25aef718  packages/indexeddb-db-collection/tests/setup.ts
de972a0ef089a3a2ee3b62788238db6432f8049e770dcdfefa354f7f49649b33  packages/indexeddb-db-collection/tests/transport-oracle.test.ts
d6346ef8fae5651e5b9425f0e4d6fd08741091b883be38fe0bf1b6cc89370bf2  packages/indexeddb-db-collection/tests/wrapper.test.ts
94ae6c8862bb8f512bd1e775c6f9f863eb64052990b018f9431e3af642bca6e8  packages/indexeddb-db-collection/tsconfig.json
b83f19adb1386109c40af6df7123cb021b5b7fb2c588fcf353de211f318704b3  packages/indexeddb-db-collection/vite.config.ts
```

## Review preparation after the next main merge

Reviewed parent: `0c1bdec35781187581e200c87bc064c3a126f92d`, incorporating
origin/main `84dc899bfc8d6a16487c1584dbb1cb177109aacc`. The receipts below
apply to the working-tree manifest that follows, not the original remote PR.
The earlier evidence above remains historical.

### Oracle-first review repairs

- Delayed clear/import × later disjoint receiver insertion × FIFO/reversed/
  duplicated notifications: six intended public snapshot failures before the
  repair; all pass after reading the current atomic durable snapshot.
- Idle/cleaned-up clear/import and real manual acceptance after cleanup: five
  stale-peer failures before the repair; all pass with temporary sender ownership.
  Initially idle manual authorship is excluded because ordinary Collection
  mutation starts sync; no fabricated PendingMutation supplies that premise.
- Whole-database deletion with source, same-store peer and sibling store: the
  sibling retained deleted data before the repair. Database-wide deletion now
  clears each observed source; fresh native stores and restore are empty. A fresh
  descriptor is required for subsequent persistence.
- Missing randomUUID, descriptor reuse across two DbClients and absent global
  KeyRange with an injected factory: four intended compatibility failures. Seven
  bounded compatibility cases pass after using the existing UUID/config helpers
  and a cursor that jumps directly to the owned store prefix.
- Replaced retained-key version, aliased authored input and rejected-handler
  ordinary suffix: old controls accepted the wrong version and three mutated
  inputs; the old suffix grammar never activated the ordinary-write leak. The
  strengthened checks reject all seven corrupted observations at the intended
  cuts. Three accepted-handler controls remain green. These are test repairs;
  production was not alleged to contain the injected faults.
- The request-helper reduction preserves synchronous initiation and native
  synchronous/event error diagnostics. Both focused controls pass before/after.
- Strict compilation of the exact Quick Start/multiple/schema README examples
  found three missing-property errors and one outer-generic variance error. The
  corrected examples all compile. Error taxonomy, additive store creation and
  late callback limitations are documented as actually implemented.
- CI registry validation failed because the new package had no test group. The
  updated registry covers all 25 package test scripts.

### Current validation and pending design

The normal package command reports **99 passes, 2 failures, no type errors**.
The failures are the two proposed blocked open/delete settlement tests: the
wrapper reports rejected at the native blocked cut, while the proposed contract
requires pending. Both native requests subsequently succeed after removing the
blocker. These are intended assertions, not timeouts or fixture errors. The
blocked-event policy remains unchanged pending a maintainer decision; this is
not a green receipt or completed PR preparation.

Fixed seed 1179001 and random seed 170098790 each pass 30 histories. The final
transport subset passes 17/17; compatibility after lint passes 7/7. All-driver
tsc, package ESLint, ESM/CommonJS/declaration builds, registry and whitespace
checks pass. Validation still uses the cached toolchain and built core exports.
No clean CI run or native browser receiving witness is claimed by these receipts.

### Inherited core typed-key counterexample

This review also found a pre-existing core defect, HC005. Starting empty, insert
`[{id: 0, name: 'numeric'}, {id: '0', name: 'text'}]` in one transaction. The
mutation payload, public rows and IndexedDB durable rows retain only the last
row. Reversing the array reverses the survivor. Core collection/mutations.ts
formats globalKey by interpolating the key, losing its type; transactions.ts
coalesces by that string. Both files are identical to the fetched main revision.

Eight controls distinguish the boundary: IndexedDB, local-storage and local-only
with an async handler each lose a row in both orders (six assertion failures).
Default local-only exposes both rows through its direct-write path (two passing
public controls), but its transaction payload still contains only the last row.
Thus default local-only alone would falsely exonerate the core payload.

Primary owner: db/tests/optimistic-transaction-oracle.property.test.ts, whose
current key grammar is numeric-only. Extend typed identity through automatic
array insertion and manual transactions, in both orders, observing both payload
entries before provider work plus settled public and durable receiving rows.
Adjacent controls: 1/'1', noncolliding 0/'1', and repeated true keys that should
coalesce. Delimiter-containing Collection IDs/keys are an unproved adjacent
challenge. Changing globalKey may affect persisted transaction payloads and
requires a separate core compatibility decision. No adapter workaround is added.
The package's typed-key coverage excludes this known counterexample.

### Scope and guide audit

ORACLE.md updates all applicable ORC-001 through ORC-014 outcomes. New finite
matrices have no random-campaign requirement; the generated history keeps both
campaigns and direct replay. The calibration distinguishes an old unreachable
suffix from assertion failures, and retains the earlier partial-row survival.
The coverage map names every remaining owner: wider manual payloads, longer
failed batches, multi-row handlers, pending/reused-key replacement, cleanup at
write/read cuts, remote omissions and metadata, valid post-durability publication
failures, downstream/transient observations and actual native host handoffs.
No universal bug-class closure is claimed.

### Review-repair manifest before blocked-policy decision

```text
db53c4a4cf9e99dfe41a65f7df39800b517ec5161b5f5536a879c3da7747851b  packages/indexeddb-db-collection/package.json
09d53844ef5371f0350f17884a7cf2de69250298ec0f18e705f624ec7a988bfe  packages/indexeddb-db-collection/src/errors.ts
3d1dcd35449ce425dcaec3e9f78e2406ce774fb2d6ac857e93f639615097441e  packages/indexeddb-db-collection/src/index.ts
fc252c1d4e948425c42b0df1423b0d2e50b5287dab9656dc725067426d031f01  packages/indexeddb-db-collection/src/indexeddb.ts
269d007d042b5142abec2b556d5d4539e25713eb9117b8209e093ac952260c3c  packages/indexeddb-db-collection/src/wrapper.ts
583616735a78d2b6c72b27b7340f887c3d9c5439560a04d41970d636763bb611  packages/indexeddb-db-collection/tests/api.test.ts
b2a33bd8f822a87564772c04299a70f452643aaeb181c00d189063a269d3ebbc  packages/indexeddb-db-collection/tests/compatibility-oracle.test.ts
0c9448f59fbb8c43aee254f71641adcfecca4951c26858675ff2fb54168966ef  packages/indexeddb-db-collection/tests/harness.ts
19cc1a5def94c8801b436a0ed92b000f71e8c34050a7ba56af1f94c06e5e8612  packages/indexeddb-db-collection/tests/indexeddb.test-d.ts
0c7db4cd9796e41c07c0dbb3fa95f9199873bbc1990247252c18858262b768bb  packages/indexeddb-db-collection/tests/persistence-oracle.test.ts
62056727f7ccc8135f1675591b0a2f0e7e52a1e90fb08a9366ea5928dac57f45  packages/indexeddb-db-collection/tests/settlement-oracle.test.ts
e2774ae3ae7c2dfb40ade3eae7d50a45a063e5624985a7f2fe4f095d25aef718  packages/indexeddb-db-collection/tests/setup.ts
92a26c90371f7b21b7e2dfb1fcf66c373cd34f81c538da6bd1d4f287fa8f1821  packages/indexeddb-db-collection/tests/transport-oracle.test.ts
c8078dcb0ff5f96361b53290ad4e467c26f7251208c2145b47cb6f878fc8e9f2  packages/indexeddb-db-collection/tests/wrapper.test.ts
94ae6c8862bb8f512bd1e775c6f9f863eb64052990b018f9431e3af642bca6e8  packages/indexeddb-db-collection/tsconfig.json
b83f19adb1386109c40af6df7123cb021b5b7fb2c588fcf353de211f318704b3  packages/indexeddb-db-collection/vite.config.ts
8d1580c27d20d26d08f37e93f72a77a45cfaa5d19d683a4e134aa7fba0481d5e  scripts/ci-tests.mjs
```

## Native settlement and ownership repair

This receipt supersedes the pending blocked-policy status above. The maintainer
approved porting the relevant persistence theories. The adopted law keeps native
open/delete requests pending while blocked and settles only at native success or
error. No deadline, cancellation API or automatic in-memory fallback is added.

Sources: offline-transactions/tests/indexeddb-write-settlement.test.ts separates
request outcome from native completion. The OPFS page lifecycle owner checks
resource ownership at settlement and after release. Its worker termination and
30-second deadline do not transfer to native IDB open/delete requests, which
have no cancellation mechanism. SQLite persistence applied-receipt laws remain
distinct from this database request boundary.

Before repair, the expanded wrapper matrix had 16 passes and 3 assertion
failures: blocked open→success, blocked delete→success, and blocked open→native
upgrade abort each rejected at the nonterminal blocked cut. The transport matrix
had 18 passes and 1 assertion failure: the blocked deletion utility rejected
while retaining durable/public rows and subsequently reached native deletion.
These were intended settlement assertions, not setup failures or timeouts.

The repair removes both onblocked rejection handlers. The wrapper now verifies
caller ownership of the returned native connection: closing only that returned
handle permits later native upgrade and deletion without another blocked event.
Native VersionError and upgrade-abort histories preserve schema/version/rows and
permit successful later writes. The transport owner checks retained public and
durable snapshots and no deletion message while blocked, then caller fulfillment,
empty source/same-store/sibling snapshots after delivery, and a fresh empty
database. Failure to issue deletion preserves rows and sends no success message.

Validation after repair: **106 tests pass, no type errors**, through the normal
package Vitest command with two threads, coverage and typecheck enabled. This
includes 19 wrapper and 19 transport cases. Generated persistence executes 30
histories at fixed seed 1179001 and 30 at random seed -680247802. The all-driver
TypeScript check, package ESLint, ESM/CommonJS/declaration build, 25-package CI
registry check and whitespace check pass. These use the available cached
toolchain and built core exports; native-browser guarantees and clean CI are
not inferred. Review source changes total **93 fewer production lines** relative
to 0c1bdec35781187581e200c87bc064c3a126f92d, including source comments. Tests and
contract documentation grow separately. Earlier receipts and hostile controls
remain historical evidence with their original scope.

### Final source and test manifest before commit

```text
db53c4a4cf9e99dfe41a65f7df39800b517ec5161b5f5536a879c3da7747851b  packages/indexeddb-db-collection/package.json
09d53844ef5371f0350f17884a7cf2de69250298ec0f18e705f624ec7a988bfe  packages/indexeddb-db-collection/src/errors.ts
3d1dcd35449ce425dcaec3e9f78e2406ce774fb2d6ac857e93f639615097441e  packages/indexeddb-db-collection/src/index.ts
fc252c1d4e948425c42b0df1423b0d2e50b5287dab9656dc725067426d031f01  packages/indexeddb-db-collection/src/indexeddb.ts
70fa5444a5566d771edaf15ee2573e49af9be08e03e2182764d1d6a087a4fac6  packages/indexeddb-db-collection/src/wrapper.ts
583616735a78d2b6c72b27b7340f887c3d9c5439560a04d41970d636763bb611  packages/indexeddb-db-collection/tests/api.test.ts
b2a33bd8f822a87564772c04299a70f452643aaeb181c00d189063a269d3ebbc  packages/indexeddb-db-collection/tests/compatibility-oracle.test.ts
0c9448f59fbb8c43aee254f71641adcfecca4951c26858675ff2fb54168966ef  packages/indexeddb-db-collection/tests/harness.ts
19cc1a5def94c8801b436a0ed92b000f71e8c34050a7ba56af1f94c06e5e8612  packages/indexeddb-db-collection/tests/indexeddb.test-d.ts
0c7db4cd9796e41c07c0dbb3fa95f9199873bbc1990247252c18858262b768bb  packages/indexeddb-db-collection/tests/persistence-oracle.test.ts
62056727f7ccc8135f1675591b0a2f0e7e52a1e90fb08a9366ea5928dac57f45  packages/indexeddb-db-collection/tests/settlement-oracle.test.ts
e2774ae3ae7c2dfb40ade3eae7d50a45a063e5624985a7f2fe4f095d25aef718  packages/indexeddb-db-collection/tests/setup.ts
144d795408136eeb7f6c1258c61885edebecda14c187e38386673fbeb98dade5  packages/indexeddb-db-collection/tests/transport-oracle.test.ts
22158f29593bd4e57f90fff28876c3ba331569a849079814a3b9028c54c7a67f  packages/indexeddb-db-collection/tests/wrapper.test.ts
8d1580c27d20d26d08f37e93f72a77a45cfaa5d19d683a4e134aa7fba0481d5e  scripts/ci-tests.mjs
```

## Managed versionchange and docs receipt

This receipt adopts the maintainer-approved automatic-close policy and
supersedes the earlier app-only connection release assumption. The transport
owner now crosses two/three independent `createIndexedDB` descriptors with
native upgrade/delete. Its blocked observer records a violation before fixture
rescue closes owned connections, so native terminal outcomes and all snapshots
can still be compared. Without the listener, 19 cases passed and all four new
cases failed at `managed versionchange closes every connection` (one blocked
event versus zero). Exact versionchange recipients and all remaining snapshot,
old-descriptor rejection, and fresh-descriptor restore/write assertions passed.
Adding the versionchange close listener makes all four intended assertions pass.

Current verification uses merged head e3daf0e6feaa4ea234ab8c75e22d8002221b57fa
plus this repair. Core was rebuilt from that head before package verification.
**110 tests pass with no type errors**, including 23 transport cases. Fixed
seed 1179001 and random seed -307492034 each complete 30 generated histories.
All-driver tsc, package/generator lint, package bundles/declarations, six exact
guide examples, 27 generated API pages, 53 navigation targets and links across
705 docs pages are checked. Source changes add one event listener and its
contract comment; the larger diff is tests and documentation. Browser-native
scheduling, in-flight native transactions and an app notification API are not
established by this finite fake-IDB matrix. Raw blockers still have no deadline.

### Current source and owner fingerprints

```text
3895cb3fd6d4d972386e9c2c87e2e1947f4e0e9cd1416997ca6e09af6bb95345  packages/indexeddb-db-collection/src/indexeddb.ts
70fa5444a5566d771edaf15ee2573e49af9be08e03e2182764d1d6a087a4fac6  packages/indexeddb-db-collection/src/wrapper.ts
08dc88ee5d9122d078de0fa0f2c04bca8f7606bfcb656aa2e47df28faaa0517d  packages/indexeddb-db-collection/tests/transport-oracle.test.ts
22158f29593bd4e57f90fff28876c3ba331569a849079814a3b9028c54c7a67f  packages/indexeddb-db-collection/tests/wrapper.test.ts
```

## Concurrent oracle extension — 2026-10-05

This record covers the extension based on PR head
`2a49f6d67a9f60d7f30bdfab6056ce2e2f5df02a`. The implementation manifest below
identifies the reviewed source and executable owners. Earlier sections describe
historical evidence, including the partial-row control that initially survived.
The new non-truncating omission witness rejects that control.

### Reproductions and repairs

| Subject                                    | RED observation                                                                                                                                                                                      | Repair / GREEN boundary                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redundant import notifications             | Chromium fixed seed 1179, path `1:1:1:1:1:4:4`: write then import published the union of prior and imported rows. Controlled owner failed `atomic publication / imported replacement publication 0`. | One replacement notification. Existing peers, every publication and restore agree in controlled and native histories.                                                 |
| Insert confirmation after peer persistence | Held insert, peer insert, then handler acceptance persisted successfully but caller rejected with duplicate-key CollectionOperationError.                                                            | Full-row update confirms the accepted `put` snapshot. The 24-case held-action matrix, generated neighboring histories and native accept/reject cases pass.            |
| Incorrect raw event key                    | Hostile insert and repeated malformed insert were accepted when event.key differed from value.id. The pre-repair negative test failed to throw.                                                      | Strict typed identity before reduction. Wrong string/numeric identity and duplicate malformed inserts now fail `event semantics`; adjacent update control also fails. |
| Premature reload observation               | With a held native restore, the probe existed but Collection status was loading and rows were empty. Chromium failed the old comparison at `reload before native restore completes`.                 | Generated reload awaits preload. All engines pass the held-restore negative/positive cuts.                                                                            |
| Cleanup failure masking                    | Inner native cleanup could replace an earlier mismatch or omit later pages.                                                                                                                          | Every cleanup action is attempted, the original is AggregateError.cause, and an injected failure closes both pages while retaining the exact mismatch on all engines. |

The pending reference initially over-attributed later source writes and counted
unchanged peer updates as new acknowledgements. It now follows the pinned core
oracle's one-use attribution and Collection no-op admission laws. A retained
import → identical write → rejection history distinguishes the latter. These
were reference-model repairs, not new product behavior. Peer actions now use
`write` rather than two aliases called insert/update. Positive reach assertions
prove the matrix actually performs all peer CRUD operations.

### Executed validation

- Full package: 149 tests across 11 files, including 23 type tests, passed with
  coverage enabled. Adapter statement/branch/line coverage: 97.55% / 95.37% /
  98.67%. Coverage percentages are supplementary, not oracle-law evidence.
- New controlled campaigns: 30 fixed + 30 fresh histories per transport/pending
  family. Stress: 300 fixed + 300 fresh per family. Transport stress uses five
  Collections, up to 100 operations and the large-array generation profile.
- Bounded enumeration: 16 ordered-writer/delivery schedules, six manual
  acceptance orders, and 24 held-local/peer-action/decision cases.
- Native matrix: 48 tests, all passed. Engines: Chromium 148.0.7778.96, Firefox
  150.0.2 and WebKit 26.4 on macOS. Each engine ran the same 10 fixed + 10 fresh
  generated-history budget, pinned receiving cases and calibration controls.
- Package lint, `tsc --noEmit`, ESM/CJS build and published declaration checks
  passed. CI registration installs all three engines and uploads test-results.
  CI execution is a separate status, not inferred from these local results.
- Direct intentional-failure replay used seed 11792026 and path
  `0:4:3:5:5:8:8:8:8:10:10`. The selected Vitest command exited 1 at
  `public rows / registered campaign calibration`. Reconstruction, premise reach
  and same-failure checks were all true. The native split-publication mutant
  separately reproduced its schedule-dependent failure twice in each engine.

Local dependency infrastructure could not retrieve Rollup 4.64.0 from the
configured registry. Local validation used cached Rollup 4.59.0 after an isolated
offline install. The tracked lock retains 4.64.0. No dependency version change
was included to hide this local infrastructure difference.

### Oracle guide audit

| Requirement                | Outcome and evidence                                                                                                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ORC-001 contract           | Existing core optimistic, lifecycle and package persistence laws; unspecified policy stays in ORACLE.md and coverage map.                                                                                                                       |
| ORC-002 independence       | Authored row ledger, per-Collection snapshots and independent pending projection. Observed rows/payloads never select expected membership.                                                                                                      |
| ORC-003 literate owners    | Opening contract, model, grammar, driver, checks and limits in each owner and its explicitly named companion.                                                                                                                                   |
| ORC-004 grammar            | Every action reconstructed, actual CRUD reach counted, stale-peer admission pair, empty/typed/reused keys, held decisions and finite enumerations.                                                                                              |
| ORC-005 observations       | Raw event identity/kind/multiplicity/previous value, callback rows, status, base, metadata, caller, durable versions and downstream cuts.                                                                                                       |
| ORC-006 calibration        | Original import/confirmation RED, partial-row control, serial overlap non-reach, spurious status, partial-publication and raw-key controls.                                                                                                     |
| ORC-007 campaigns/replay   | Fixed/fresh parity, explicit seed/path selection, failing selected command and three-part replay receipts. No fc.commands replayPath applies.                                                                                                   |
| ORC-008 minimality         | Stale-peer pair distinguishes durable from public. Held decisions distinguish base/public/queued source. Lifecycle separates old callbacks from current runs.                                                                                   |
| ORC-009 vocabulary         | Glossary terms retained. Model combinations and one-intent bound are stated beside the reference.                                                                                                                                               |
| ORC-010 fidelity           | Original/reduced failures and unique per-run reports retained. Native sink survives acknowledged destruction. Cleanup and missing-export controls reject evidence loss.                                                                         |
| ORC-011 second formulation | No remaining reviewer-named shared semantic fault needs an alternate reference. Exact identity controls repaired the checker itself. Raw IDB and independent fresh restore supply separate receiving observations, not a second semantic model. |
| ORC-012 review             | Two independent reviewers, eight ledger items: five fixed, one already fixed, two duplicates retaining their additional controls. No unresolved review item.                                                                                    |
| ORC-013 distinction        | Omission without truncate rejects partial updates; active/obsolete aborts distinguish run authority; split replacement repairs final rows but still fails original publication.                                                                 |
| ORC-014 handoff            | Controlled-to-native table below. Unsupported premises remain open with owners.                                                                                                                                                                 |

### Controlled-to-native handoff

All listed native witnesses executed on all three engines.

| Controlled premise                                  | Native receiving witness                                                                      | Limit                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Concurrent receiver reads behind a live transaction | Two callbacks and two readonly transactions remain pending behind real native requests        | Writes finish before the read window.                                   |
| Whole-row omission without replacement              | Delete/reinsert transactions precede reads; ordinary update observed, zero truncate           | Ordered writes only.                                                    |
| Held local intent with independent peer progress    | Peer persistence and receiver callback finish before held insert settles                      | One local insert in native witness; broader CRUD family controlled.     |
| Old receiver abort after cleanup                    | Abort old pending read, restart, release storage, restore current run                         | Pending mutation completion is a separate policy boundary.              |
| Native request progress then abort                  | Read/write abort witnesses observe progress, terminal failure, status/caller and rollback     | Test-owned abort is not quota exhaustion.                               |
| Managed connection close and unmanaged blocker      | Versionchange with held transaction; blocked deletion remains pending until raw handle closes | Held transaction is test-owned, not an adapter write already in flight. |
| Subscription acquisition during startup             | Pending startup and pending peer write positively observed before release                     | No framework scheduling claim.                                          |
| Repaired transient error before page destruction    | Runner retains split-publication evidence with handler pending, then closes page              | Acknowledged destruction only, not an unacknowledged crash.             |

Production weight for this extension is +2/-2 lines (net zero). Test/browser
code grows by approximately 3,200 lines for the models, drivers, histories and
controls. Documentation and integration changes are separate. No new runtime
queue, retry, generation, fallback or dependency is required by the two fixes.

The claim is bounded by law × legal history × adapter path × observation cut.
The current remaining-boundaries list in ORACLE.md and oracle-coverage.md retains
unordered read/write overlap, multiple active local intents, pending mutation
cleanup policy, same-ID ownership, AUX01, suspended delivery, nested identity,
quota, eviction and physical crash durability. HC005 remains a core-owned
counterexample. No universal cross-tab bug-freedom claim is made.

### Extension implementation manifest

```text
94aa4cfc438f175f034e54e3a01faf0fd2a00f15da69cbf83abfa23715dbce62  packages/indexeddb-db-collection/src/indexeddb.ts
97b7b3691c739de2c52c3aed5e10c4b9b3f32055bc07497c93d846018fd1d29a  packages/indexeddb-db-collection/tests/cross-tab-boundary-oracle.test.ts
3361b26742495eec6d580331773070e50f8709b3caaf80d77f95f5c1c9e44da8  packages/indexeddb-db-collection/tests/cross-tab-driver.ts
96c79b747dfd322f1c2ad67ea8b0091094f76c78ab9de14db251c1c28a5c6426  packages/indexeddb-db-collection/tests/cross-tab-history-oracle.test.ts
3193e9c0ebcbb6e4c6322f630aa43f7eb26abd92eeaaf1a36a69435ddce625dd  packages/indexeddb-db-collection/tests/cross-tab-oracle.ts
28f3ba9fd3b9485f50e66312c77ef260f50c20b5d19cd426475ea67ddf71c456  packages/indexeddb-db-collection/tests/pending-history-oracle.test.ts
5cf50fb9f00166b5f203b05bbcbe609cf349c3367ef066f5316a1a7bf6c9e27b  packages/indexeddb-db-collection/tests/campaign.ts
1371b3b4a6e71fccf4d3207f600f9969e3e9f793cb0f747e0266a0e037fa19f5  packages/indexeddb-db-collection/tests/recorder.ts
d0c2c3233aacb258d67f9018357846833822f16aca610e4182e714fa129ccf59  packages/indexeddb-db-collection/tests/idb-driver.ts
ccdaba88a58a378ef57d90b0d295b00ed57a1736c20e479f0ec03e3cfae1a3fc  packages/indexeddb-db-collection/e2e/browser-evidence-oracle.ts
d461155641e40acaebb3b7b3581440c7ecfa51125adcd94d09619b53d577d96e  packages/indexeddb-db-collection/e2e/browser.ts
c5ef4c7965a4964dafdd7bc43117b649644900c4e230c5be253a2f4b4eb41e85  packages/indexeddb-db-collection/e2e/cross-tab-oracle.spec.ts
```
