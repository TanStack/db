# TrailBase lifecycle framework conversion

Source checkpoint: `76e3a7fbeaf5bc3127a06191a15bd1229412a7b3`, with the
uncommitted oracle-only conversion. No production file changes belong to this
conversion. The same-seed stable-key mutation retention report is a separate
required gate; the calibration results below do not replace it.

## Law, model and history preservation

The governing contract is `packages/trailbase-db-collection/tests/ORACLE.md`,
with Collection readiness, cleanup, sync-run retirement and health terminology
from the glossary. The conversion preserves all 82 original assertion sites.
Eighty retain their exact relation. The reports/rejections sites preserve their
empty-versus-events judgment while capturing opaque reasons as data.

The authored RecordApi/service and independent Maps compute row truth from
commands. Their reference facts and the public production observations occupy
separate trace records. The checker compares them at every original cut. Error
and resource identity are relational observations encoded with stable tokens.
No driver runs Vitest assertions or reports a pass/fail summary.

The lifecycle grammar retains one to three sync runs, eager/on-demand mode,
metadata absence/presence, zero to eight changes, five stream endings and both
cleanup timings. It now also generates the previously fixed-only optional
rejecting cancellation. The page grammar retains 258 source rows, cursor/offset,
one/two loads, at most ten steps and four changes. Offset inserts/deletes remain
excluded because service pagination shifts position. Its inverse rejects those
invalid forms and more than four changes.

All 36 lifecycle fixed histories, five page fixed histories and 51 finite
histories remain. Fixed/fresh budgets and seeds remain 50/714203 and 40/205917.
The lifecycle and page grammars add thirteen and seven randomized constructed
builders. Every builder returns a fresh object and records requirements in a
WeakMap; checks enforce those requirements for generated outputs too.

## Executed evidence

Scratch files and logs are under `/private/tmp/pr2394-trailbase-lifecycle`.
`clean3.log`: 128/128 checks GREEN, including per-builder missing-state controls,
provider-owned row corruption, wrong status, error identity, reader ownership,
timer release, omitted rows and early fetch controls. `clean4.log`: 130/130
GREEN after adding DOMException and opaque class diagnostic controls. Symbol
capture and the final integrated receiving run are recorded in the final
appendix once executed.

`generated-controls.log` runs all twenty builders on fresh generated histories.
Each output differs in data from every named fixed-seed construction, is accepted
by its arbitrary, passes the unchanged production recorder/checker, and is rejected
under `constructed builder reach` when its required reach event is removed.
The two harness checks pass; all twenty per-builder results are printed.

The driver and reference model are deterministic over fixed/constructed inputs
and three generated histories, as enforced by the framework. TypeScript and
normal/oracle ESLint passed on scratch before the final diagnostic additions.

## Rubric accounting

- ORC-001/002: Existing authority and independent service/Map laws are retained.
  The trace transports independent fixture/model facts, never production-derived
  row expectations. The fixture boundary remains the trusted base.
- ORC-003/009: Opening law, local model/driver prose and named cuts are retained.
  Driver names now say `observe`; only the refinement functions judge results.
  Opaque identity tokens are the declared abstraction for resources and errors.
- ORC-004/007: Both budgets/seeds and all fixed inputs remain. Missing metadata,
  rejecting cancellation and allocated page commands now reconstruct. Numeric
  ranges and offset exclusions remain; the mapper has a checked inverse. Replay
  selectors change to each property followed by `.*random seed`.
- ORC-005/006: The same real adapter, native streams, Collection and live-query
  paths run. Comparisons remain at all original cuts. Wrong-result and provider
  corruption controls yield named law violations rather than setup failures.
- ORC-008: No model state is removed, merged or split. Service maps, in-transit
  events and cleanup retirement retain their original distinguishing histories.
- ORC-010: Drivers retain cleanup/failure aggregation. Prefix checks compare
  existing cuts before completeness, so a later driver error cannot replace an
  earlier recorded violation. Opaque diagnostics cannot fail data capture for a
  DOMException, class instance or symbol before the forbidden-event comparison.
- ORC-011: No new shared semantic fault hypothesis is addressed by this pure
  conversion. Independent second formulation is not triggered.
- ORC-012: This record identifies the reviewed source checkpoint and bounded
  evidence; it does not claim new product bug-class closure.
- ORC-013: Existing boundary distinctions and fixed histories remain. This
  conversion adds no broader reusable-law claim.
- ORC-014: The legacy scope stays at controlled RecordApi/native streams. The
  persisted hydration receiver and real Chromium witness use the shared primary
  hydration model and are integrated by their separate conversion.
- ORC-015: Required states have randomized builders, fresh identities, WeakMap
  enforcement, per-builder omission controls and distinct generated-only checks.
- ORC-016: Fixed regressions reuse the same model, driver and checker. The finite
  property enumerates its whole legal grammar; ordinary assertions do not remain
  inside oracle drivers.

## Limits

No deployed TrailBase server, SDK wire decoding, service reconnect or arbitrary
scheduler claim is added. The conversion does not fix production. Previous
mutant kills must survive the parent same-seed retention gate before readiness.

## Final scratch appendix

`clean-final.log`: **131/131 GREEN** in 26.35 seconds. This includes all three
arbitrary-reason capture controls: DOMException, opaque class instance and
symbol. `types5.log` and `lint5.log` are empty successful strict TypeScript and
normal/oracle ESLint outputs. The active source and observation normalization
were held fixed for this run.

Normal enforced minimum is one randomized construction per state and per
campaign. Every builder also runs in the ordinary generated population with its
WeakMap obligation. Final measured counts:

| Lifecycle state | Fixed | Random |
| --- | ---: | ---: |
| cleanup-during-list | 30 | 31 |
| cleanup-during-subscribe | 32 | 28 |
| list-rejected | 14 | 11 |
| metadata-absent | 42 | 37 |
| metadata-present | 21 | 26 |
| replacement-before-retired-delivery | 13 | 9 |
| stream-buffered-close | 9 | 2 |
| stream-cleanup | 8 | 11 |
| stream-close | 17 | 12 |
| stream-immediate-cleanup | 18 | 11 |
| stream-parse-error | 5 | 13 |
| stream-read-error | 8 | 7 |
| subscribe-rejected | 15 | 15 |

| Page state | Fixed | Random |
| --- | ---: | ---: |
| cursor-paging | 25 | 23 |
| offset-paging | 22 | 24 |
| overlapping-loads | 17 | 21 |
| event-in-transit-across-page | 10 | 11 |
| update-between-pages | 10 | 6 |
| delete-first-page-in-flight | 6 | 8 |
| insert-new-key | 6 | 10 |

The scratch-only reach mutant filters one `reach` observation from the
production driver only when a construction's encoded history differs from
every named seed-derived construction. It retains required-state metadata,
reference facts, production observations and the original checker. This tests
generated outputs separately from the framework's named construction map.

- Lifecycle: reseeded campaign 916721 fails under `constructed builder reach`
  at `complete`, omitting metadata-absent. Path **37:0** shrinks to eager mode,
  metadata absent, one cancel-load resolving late. The direct mutant replay
  fails after one test at the same law/cut with no further shrinking. The same
  direct replay without suppression is GREEN.
- Page/event: reseeded campaign 916721 fails under that same law/cut, omitting
  insert-new-key. Path **32:0:0** shrinks to cursor mode, one load, one immediate
  set of key300. The direct mutant replay fails after one test at the same
  law/cut with no further shrinking. The same clean direct replay is GREEN.

Commands use `node <worktree>/node_modules/vitest/vitest.mjs run`, the isolated
`reach-mutant.config.mjs` or clean `vite.config.mjs`, `--maxWorkers 1`, and
`-t 'trailbase.lifecycle.*random seed'` or
`-t 'trailbase.page-event.*random seed'`. Campaigns set
`TANSTACK_DB_ORACLE_SEED=916721`. Direct replays additionally set
`TANSTACK_DB_ORACLE_PROPERTY` and `TANSTACK_DB_ORACLE_PATH` to the values above.
Only mutant runs set `TRAILBASE_REACH_STATE=metadata-absent` or
`TRAILBASE_REACH_STATE=insert-new-key`.

Logs: `lifecycle-generated-red3.log`, `page-generated-red2.log`,
`lifecycle-generated-replay-red.log`, `page-generated-replay-red.log`, and the
corresponding `*-generated-replay-green.log`. Earlier parse/configuration errors
are retained separately; none is counted as an oracle RED or mutant kill.
