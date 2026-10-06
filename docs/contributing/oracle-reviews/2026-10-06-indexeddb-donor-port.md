# IndexedDB donor coverage port

Reviewed implementation: `c4441632c7ac595d11c57061f5c5f9a3ae556de9`.
Production baseline: `fd3c05c818d76489438224e24d4e935751596dc0`.
This record concerns DP08, DP09, DP10 and DP17 from the
[sighted donor survey](2026-10-06-indexeddb-donor-survey.md).
It preserves the survey's original dispositions as historical evidence.

## Result and receiving scope

No production changes or new product policy were required. The port extends the
existing per-store and persistence models and adds a separate distribution smoke
lane. The shared rich-value definition is `structured-clone-oracle.ts`; its
controlled receiving companion is `persistence-values-oracle.test.ts`. The native
driver is `e2e/coverage-browser.ts`, with comparisons in `value-oracle.spec.ts`.
Drivers are not counted as additional independent models.

| Finding | Executed law and bound | Limit |
| --- | --- | --- |
| DP08 | Two/three competing first native opens; same/independent absent names; complete identical declarations; schema, held restore/readiness, disjoint writes, convergence, fresh restore and later upgrade. Native engines receive three-open histories. | Opens settle before writes; no callback-order promise or union of conflicting declarations. No new liveness guarantee. |
| DP09 | Seven authored native value shapes: Date, odd ArrayBuffer, offset Uint8Array/DataView, BigInt64Array, Blob and nested array. Unrelated scalar update, peer, export/import, fresh descriptor; insert/import rejection at first/middle/last nested function; raw row/version rollback and valid suffix. | No post-submission mutation, custom prototypes, cycles, Map/Set, detached/shared/resizable buffers or schema transforms in this companion. |
| DP10 | Six legal database/store substitutions, prefix neighbor and anchor; scalar typed keys in separate transactions, update/import/clear, peer/public/durable/restore and untouched version values. | Native receiving covers prototype/Unicode creation and ordinary writes, not the entire controlled renaming/import/clear matrix. |
| DP17 | Tarball ESM/CJS consumers plus missing-export controls; Vite with no aliases/config rescue; native browser execution of persist/reopen. | Installed dependency closure is pinned with tarball overrides. This does not prove registry range selection, old runtimes, all bundlers or every export. |

The new finite grammars intentionally extend existing models without multiplying
all value shapes by the entire lifecycle state space. Existing fixed/random
history campaigns and direct replay remain unchanged. The TLA+ lifecycle models
are unchanged because names, payload fidelity and package resolution add no
lifecycle or authority policy.

## Sensitivity and test-first evidence

[`review-evidence/donor-port`](../../../review-evidence/donor-port/) contains the
replay script, source hash, classifications and complete receipts.

- `name-prefix`: change exact metadata-store matching to `startsWith`.
  Six assertion failures at metadata ownership after replacement; a neighbor's
  entries disappear. This is neither timeout nor setup failure.
- `premature-readiness`: publish readiness before persisted restore.
  Four assertions reject `ready` while native reads remain held/pending.
- `json-values`: JSON-convert accepted rows before native persistence.
  The Date history rejects the peer's string value at the first insert checkpoint.
- Two resolver controls remove one installed tarball entry each. ESM/CJS loaders
  fail with the missing-entry path; workspace aliases cannot rescue either path.
- Value-observer controls accept each correctly constructed corpus value and
  reject flattened shapes, lost view offsets, altered backing bytes and omissions.

All production mutants were restored. These establish sensitivity to the named
wrong designs, not universal coverage. There is no newly repaired source bug.

The first legal-name draft inserted numeric `0` and string `"0"` in one Collection
transaction and reproduced the already tracked HC005 core payload collision.
Both ordinary and unusual names lost the numeric row. The final name grammar uses
separate transactions to isolate routing; HC005 stays open with its existing core
owner rather than being represented as fixed by this port.

## Native provider distinction

Chromium and Firefox receive all seven preservation shapes. The local Playwright
WebKit provider rejects Blob preparation with native `UnknownError: Error preparing
Blob/File data to be stored in object store`. A direct native transaction without
adapter code reproduces it. The executable raw-provider witness preserves this
classification.

For the two Blob-containing WebKit cells, the test requires that exact native
failure, matching adapter rejection, empty public/durable/export rows, and a
successful Date suffix. These are executed rejection tests, not skipped tests or
Blob-preservation evidence. If native Blob storage succeeds on another platform,
the same test executes the full preservation history. A Blob-capable WebKit
receiving witness is still needed for that claim; the coverage map names it.

## Guide audit

| Requirement | Evidence |
| --- | --- |
| ORC-001 | Existing persistence, schema, readiness and per-store contracts; each owner states its finite domain and exclusions. No recovery/ownership policy is inferred from a donor. |
| ORC-002 | Authored per-store arrays and tagged value descriptions never derive expected rows from production storage or version classifiers. Production receives detached scalar inputs or fresh native values. |
| ORC-003 | Opening and adjacent prose distinguish law, value model, finite grammar, real API driver and checkpoint in each oracle/companion. |
| ORC-004 | No new random generator: bounded enumeration is explicit. Removing unusual names loses dictionary/routing cases; removing independent names loses isolation; removing native holds loses premature-readiness reach; removing offsets/types loses fidelity. Empty/reserved stores and conflicting declarations remain separate negative controls. |
| ORC-005 | Native open admission counts precede settlement; zero old versions prove absent names; held native reads precede readiness. Public/peer/raw/export/restore observations occur at stated cuts. Package consumers execute real loaders and storage. |
| ORC-006 | Three production mutants fail by assertion at the named cuts; value and packed resolver controls remain executable. |
| ORC-007 | Not triggered for new finite enumerations. Existing generated persistence and cross-tab campaigns remain registered and unchanged. |
| ORC-008 | No lifecycle states added. Value tags, content, offsets and backing bytes remain because an untouched-field observation distinguishes them; object identity is deliberately outside the law. |
| ORC-009 | Collection status/readiness, persisted restore, public snapshot, native transaction and settlement retain glossary meanings. Value descriptions are test-only observations, not product states. |
| ORC-010 | Controlled harness retains primary failures and cleanup errors. Native runner aggregates cleanup errors with the primary cause. Tarball fixtures own/dispose temporary directories. No shrinker or failure classifier was changed. |
| ORC-011 | Native constructors and independent typed/byte observations reject shared JSON assumptions. Direct native Blob admission distinguishes provider rejection from adapter corruption. Legal-name substitution preserves authored meaning. |
| ORC-012 | This versioned record identifies the reviewed implementation and reports each applicable obligation, calibration and open boundary. No universal bug-class closure is claimed. |
| ORC-013 | Prefix neighbor versus exact-name metadata; held versus completed restore; offset versus flattened view; native rejected Blob versus accepted Date; existing versus missing packed export are distinguishing neighbors. |
| ORC-014 | Native first opens, held restore and cross-page values run in Chromium/Firefox/WebKit. WebKit Blob preservation and the wider native naming matrix are explicitly unclaimed, with owners in the coverage map. |

## Validation

- 2,446 adapter runtime/type cases passed; 15 files, no type errors.
- 192 native browser cases passed across Chromium, Firefox and WebKit. Of the
  36 added cases, 19 prove rich-value preservation, two prove the documented
  native Blob rejection/suffix, 12 prove first-open readiness/schema, and three
  execute packed browser bundles.
- 16 package-consumer cases passed: 12 existing declaration checks, two packed
  runtime examples and two missing-export controls.
- Full test-driver typecheck, changed-file ESLint, formatting and whitespace
  checks passed. No production code changed, so no core rerun is claimed.

An attempted dependency refresh hit the configured registry's unavailable
packages. Tests used the available cached Vite/Rollup installation; source,
manifest and lockfile were not changed to bypass it. A dependency declaration
removed by its prepare script was restored from the local package cache; external
packing now uses `npm pack --ignore-scripts`. No suite rebuilds another suite's
input. The native CI build list now includes the adapter before packed-browser
consumption.

## What remains

- Product decisions: abnormal native closure (DP02), mutable-value capture and
  ownership (DP12), and worker-host support (DP13). These have not been silently
  assigned recovery behavior.
- Optional new APIs: blocked-operation diagnostics, atomic storage read-modify-write,
  and durability hints. Existing accepted contracts remain unchanged.
- Provider evidence: WebKit Blob preservation and the wider native naming matrix.
- Existing open boundaries, including HC005 and the previously recorded lifecycle/
  suspension/crash limits, remain in the coverage map. This port does not retire them.


## Approved follow-up

The later [follow-up audit](2026-10-06-indexeddb-donor-followup.md) records the
approved closure/capture/worker contracts, optional blocked diagnostics, core
typed-key repair, and completed native naming and persistent-WebKit Blob evidence.
The earlier findings above retain their original revision and evidence boundary.
