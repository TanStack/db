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

| Finding | Missing original observation | Receiving witness / repair |
| --- | --- | --- |
| Mixed manual mutations entered the wrong store | Other-Collection mutations with overlapping keys | Generated/manual two-store histories; filter by owning Collection before persistence/publication. |
| Failed writes reported success and could leave orphan versions | Exact persistence outcome and raw rows/versions | Clone-failure matrix at both positions, automatic/manual/import; await every request and abort one batch transaction. |
| Batch prefix survived later failure | More than one row plus later failure | Per-row-transaction mutant fails automatic/manual durable-prefix assertions; shared batch transaction repairs it. |
| Handler rejection persisted changes | Held decision cut and rejected suffix/reopen | CRUD × resolve/reject; run handler before durability or notification. |
| Clear/import left stale public rows | Exact public source replacement with reused keys | Generated replacement histories; truncate and publish replacement after successful atomic persistence. |
| Immediate confirmation retained accepted optimistic rows | Update then replacement after settlement | Pinned generated history and immediate-confirm mutant; queue ordinary confirmation behind optimistic settlement. |
| Remote deletion was lost under local optimistic delete | Independent source deletion plus rollback/commit | Delete/clear × local rollback/commit; keyed source deletes and truncate independent of public visibility. |
| Failed/unfinished startup reported ready | Populated restore plus abort/native completion | Exact preload/status and native-complete witnesses; publish readiness after transaction success, markError on failure. |
| Wrapper lost callback outcomes and errors | Callback completion separate from native completion | Both completion orders, exact callback errors and request-success/abort; wait for both success obligations. |
| Invalid imports changed storage | Schema input/defaults, duplicate keys, retained prior state | API and atomic replacement tests; validate/normalize all inputs before opening the replacement transaction. |
| Internal version store was admitted as user data | Reserved-name boundary | Reject reserved store declaration and Collection configuration. |

Two oracle assumptions were corrected during development using counterexamples:
attempted no-op edits do not promise either preserved or regenerated versions;
and omitted optional values and explicit undefined are the same in this bounded
value model. These corrections do not waive changed-value version checks,
unrelated-key stability, durable row equality or extra-field checks.

## Calibration classification

| Control | Outcome |
| --- | --- |
| Missing/duplicate/wrong-key/extra-field snapshots | Permanent checker assertions reject all four. |
| Per-row transaction mutant | Assertion kill at aborted durable snapshot: two failing cases, one unrelated import control passes. No timeout/setup credit. |
| Immediate-confirmation mutant | Assertion kill at update-then-clear public snapshot. |
| Partial-row sync mutant | Survives both transport cases; equivalent for their undefined-valued field removal. No arbitrary full/partial-row conclusion. |
| Misaddressed diagnostic config invocation | Setup failure; corrected and rerun. No product evidence credited. |
| Native browser handoff | Not run; explicitly unresolved in ORACLE.md and the coverage map. |

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

~~~text
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
~~~
