# PowerSync and RxDB primary eager-source conversions

Validated immutable head: `777935fd68daa497fdd3c9db533845b710be68a1`, parent
`c4c00b20b6c91549a2b9fe502096d0841520f3fe`. The seven-file conversion was then
integrated into the live PR worktree. Shortened imports received formatting only.
This record covers the conversion with unchanged adapter production, before the
separate startup batching and performance repair.

## Preserved law and integration

The shared eager-source owner keeps its existing authority, independent row
Map and sync run phase model. It preserves status, health, rows at readiness,
field values, event folds and every intermediate publication comparison. The new bridge transports
the original violated law, step and expected/actual observations. It does not
derive expected rows from production.

The integrated files are:

- `packages/db-adapter-conformance/src/eager-live-source-oracle.ts`
- `packages/db-adapter-conformance/tests/eager-live-source-framework-oracle.ts`
- `packages/db-adapter-conformance/tests/eager-live-source-oracle-suite.ts`
- `packages/powersync-db-collection/tests/eager-live-source-history-oracle.ts`
- `packages/powersync-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`
- `packages/rxdb-db-collection/tests/eager-live-source-history-oracle.ts`
- `packages/rxdb-db-collection/tests/eager-live-source-conformance-oracle.property.test.ts`

Both existing IDs remain:
`adapter-conformance.eager-live-source.powersync` and
`adapter-conformance.eager-live-source.rxdb`. Each wrapper supplies literal
`runs: 400` and `fixedSeeds: [2118]`: 400 histories per fixed and fresh campaign.
The shared grammar only gains inverse maps to admit constructed RxDB startup histories.
Across both domains and seeds 2118/2367/20261110, all 2400 sampled forward draws
match before and after conversion.

Five randomized builders enforce the original minimum reach of five histories. A local
WeakMap also binds fresh generated outputs to their required states, because the
pinned framework binds only its seed-derived constructions. All five builders
return fresh arrays. PowerSync retains its twelve-step bound: four required
steps and up to eight generated steps. RxDB retains three startup batches plus
twelve steps: its construction uses nine required steps and up to three generated
steps after the startup batches. Keys, titles, notes, value examples, kind
rotations and suffixes vary with generated inputs. Unsupported wait steps remain
outside both grammars.

PowerSync retains real local SQLite through its Node SDK, its diff-trigger
propagation cut, per-batch publications, five typed field kinds and existing
15-significant-digit storage exclusion. RxDB retains its controlled RxCollection,
real query matcher/comparator, per-change publications, seven JSON value kinds,
initial buffering and post-ready stream failure. Its existing memory-storage
receiving witness remains. No receiving path or checkpoint is removed.

## Executed evidence

- **GREEN:** RxDB 129/129 in its original jsdom host. PowerSync 89/89 in both
  Node 24.22.1/forks clean captures, within full 265-test baselines of 181.089s and
  169.686s. Both captures have no setup/unhandled errors or nondeterminism.
- **Fresh campaign:** a separate PowerSync unseeded 400 passes in 62.94s, all 17
  declared states at 213–334 histories. PROPERTY/SEED/PATH/CALIBRATION were removed
  from its environment. The retention audit's random campaign was explicitly
  reseeded 2367; it is not substituted for this fresh campaign.
- **Reach calibration:** all 5×17 PowerSync and 5×25 RxDB named builder/state
  omissions fail `constructed builder reach`. Six grammar controls also pass
  reconstruction, fresh identity, variation, actual receiving reach and
  unsupported-step exclusion. Removing a required prefix loses its corresponding
  failure/restart, buffering, optional-field or typed-path state.
- **Generated-only RED:** each chosen construction is absent from all five
  seed-derived histories. Suppressing only its `field-removed` observation,
  after the unchanged shared product comparison passes, fails at `reach` with
  `constructed builder reach`. Exact clean/omitted replays preserve that
  distinction: RxDB seed 2118/path 6; PowerSync seed 2118/path
  `6:12:10:18:30:29:38:46:46:46:56:64:64:72:81`.
  These are assertion failures, not setup errors.
- **Mutant retention:** all 12/12 original stable operator kills remain, six per
  adapter, with zero exclusions/nondeterminism. PowerSync run
  `96e1e23c1c70`; RxDB run `5f5866b66af7`. The
  [versioned retention record](2026-11-10-primary-eager-conversion-retention.json)
  preserves stable keys, commands, source hashes, clean captures and integrity.
  The separate adapted semantic control remains covered by Audit A's unchanged
  input proof; no duplicate control is credited.
- **Failure fidelity:** wrong public values fail the original `FID-1 (values)`
  comparison. Three additional actual-RxDB controls preserve that law/step 0
  ahead of a secondary dispose failure; cleanup-only and setup-only failures
  escape instead of becoming product violations.
- **Static checks:** strict TypeScript, scoped typed ESLint and diff checks pass
  on the integrated seven files. The required whole-branch command
  `pnpm --config.verifyDepsBeforeRun=false lint:changed` also exits 0 without
  reports after central removal of the two stale legacy entries.

Earlier default-runtime attempts are retained as failed runtime evidence:
a combined PowerSync fresh campaign lost its worker to SIGKILL, and a single
clean replay aborted in better-sqlite3's environment-cleanup hook with SIGABRT.
Neither is a product verdict or mutant kill. The same full replay then passes
under the validated Node 24.22.1/forks runtime; its omitted-state replay fails the
intended assertion there.

## Normal-campaign reach

Each listed state has enforced minimum 5. Counts below are complete original-host
fixed and fresh campaigns of 400 histories each; explicit one-history replays do
not replace them.

### PowerSync

| State | Fixed2118 | Unseeded fresh |
| --- | ---: | ---: |
| `change-batch` | 296 | 294 |
| `failure-before-ready` | 255 | 273 |
| `field-removed` | 196 | 213 |
| `field:boolean:change` | 274 | 271 |
| `field:boolean:load` | 309 | 315 |
| `field:date:change` | 274 | 271 |
| `field:date:load` | 309 | 315 |
| `field:float:change` | 274 | 271 |
| `field:float:load` | 309 | 315 |
| `field:integer:change` | 274 | 271 |
| `field:integer:load` | 309 | 315 |
| `field:string:change` | 274 | 271 |
| `field:string:load` | 309 | 315 |
| `first-ready` | 333 | 334 |
| `multi-change-batch` | 254 | 249 |
| `restart` | 264 | 281 |
| `restart-after-failure` | 213 | 232 |

### RxDB

| State | Fixed2118 | Unseeded fresh |
| --- | ---: | ---: |
| `change-batch` | 280 | 291 |
| `change-before-ready` | 373 | 381 |
| `failure-after-ready` | 258 | 272 |
| `failure-before-ready` | 255 | 282 |
| `field-removed` | 198 | 222 |
| `first-ready` | 333 | 338 |
| `multi-change-batch` | 330 | 348 |
| `read-missed-change` | 263 | 266 |
| `restart` | 265 | 298 |
| `restart-after-failure` | 226 | 251 |
| `seen-change-superseded` | 203 | 233 |
| `value:array:change` | 246 | 272 |
| `value:array:load` | 235 | 250 |
| `value:boolean:change` | 253 | 267 |
| `value:boolean:load` | 233 | 255 |
| `value:float:change` | 234 | 265 |
| `value:float:load` | 212 | 252 |
| `value:integer:change` | 270 | 288 |
| `value:integer:load` | 241 | 268 |
| `value:null:change` | 254 | 272 |
| `value:null:load` | 232 | 251 |
| `value:object:change` | 246 | 265 |
| `value:object:load` | 233 | 249 |
| `value:string:change` | 248 | 271 |
| `value:string:load` | 236 | 249 |

## Bounds and review outcome

The product model and its vocabulary are unchanged (ORC001–003/008–009).
Grammar controls, real receiving execution, value/reach calibrations and direct
replay cover ORC004–007. Failure fidelity covers ORC010. No new shared semantic
fault or product threshold is proposed, so ORC011/013 add no new obligation.
This versioned record and the immutable retention record supply ORC012 evidence.
Original receiving boundaries remain (ORC014); constructed and generated-output
checks enforce ORC015; campaigns and calibrations share the original judgment
without separate expected row constants (ORC016).

These are eager, unwrapped source receivers. They do not cover persistence
hydration-await lifecycle windows, remote replication, mutation handlers,
on-demand loading or elapsed/heap performance. The separate persisted-startup,
lifecycle and measurement owners supply those claims. This conversion does not
claim closure of later production changes.
