# Persisted baseline lifecycle receiving evidence

Reviewed base: `0e86c1fdae85520aff142f141f71ccf46a8ee8bd` plus the working
oracle receivers. This is the author's integration record. No live adapter
production file was edited for this work. Immutable test-only Vite overlays
retain the original module IDs and verify both original and candidate hashes.

## Law and ownership

Persisted baseline work cannot extend a retired sync run's authority. Cleanup
releases provider resources once. Accepted rows remain durable. Reload keeps
its accepted rows until its complete replacement applies. An initial provider
failure preserves its exact cause and ends the initial load. A terminal source
failure cannot later accept an omission sweep from that failed continuation.
Authorities are the shared eager owner's LIFE-2/5/10, READY-4 and HEALTH-5,
the glossary's accepted sync transaction, cleanup and reload contracts, and
TrailBase's existing persisted-hydration complete-result row judgment.

The [receiver judgment](../../../packages/db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle.ts)
uses a differential preservation check for retirement and the existing
TrailBase set model for replacement and subsequent live rows. It imports no
adapter transition, ownership classifier or diff helper. Source failure,
acknowledgment rejection, application and cleanup remain distinct boundaries.
The [composition driver](../../../packages/db-adapter-conformance/tests/persisted-baseline-lifecycle-driver.ts)
settles every genuine underlying receipt before it freezes the retirement cut.
The held acknowledgment returned to the adapter does not undo application.
Candidate mode additionally requires an actual adapter `hydrateBaseline()`
invocation and holds its return after the genuine restore has completed.

The same grammar/check receives real local RxDB memory storage and PowerSync
SQLite, each on controlled persistence, real Node SQLite and real Chromium
worker/OPFS persistence. These local SDK receiving paths make no remote service
or replication claim. PowerSync has no post-ready terminal stream-error
capability, so its grammar excludes `stream-fail`; RxDB supplies that event
through its existing Observable boundary.

## Grammar and observation cuts

Each normal property runs 24 generated histories at campaign seed 239467 and
24 without a supplied seed. Each state has one randomized constructed builder,
with fresh object identities and a WeakMap recording its required state.
The comparison checks generated builder outputs as well as the framework's
seed-derived constructions. Eight fixed histories, plus two RxDB stream-error
histories, replay the same model, driver and comparison.

The domains are three prior/old/replacement keys (bitsets 0–7), batch sizes 1–2,
default or network-first rendering for cleanup/reload, and default rendering for
injected source/receipt failures. A real source error before its initial query
settles holds the actual persisted restore. After a delivered source result,
cleanup/reload/receipt rejection hold acknowledgment and candidate hydration
completion separately. RxDB also terminates the source while that genuine
hydrate return remains held. Public/durable rows, Collection status, preload
settlement, health cause identity, provider resource releases, onLoad releases,
handled diagnostics and a subsequent replacement live insert are compared.

Reconstruction retains all fixed traces inside the generated language. Removing
the action axis loses cleanup, reload or either failure obligation; removing
empty/overlap/omission memberships loses complete-result distinctions; removing
batch size loses multi-commit receipt cuts; removing initial rendering loses
network-first lifecycle reception. Empty and full bitsets are in range. Failures
with network-first rendering are excluded by this receiver's stated grammar,
and PowerSync terminal stream errors are not legal provider events here. The
existing startup owner covers fallback/deadline semantics independently.

## Candidate identities

| Source | Original SHA-256 | Final frozen candidate SHA-256 |
| --- | --- | --- |
| RxDB | `2dca19cff8bb602b2aa59f46c7635035e49d0f1cda0a2222e1917f6d2eb8aa62` | `c78f7409f9e539a6bf575718f36a91309c191b18638be29a7d87b481914e65f7` |
| PowerSync | `d945eb99bff416fc9c7ba041a802fa842072e5cf03a71d02dd2ed214610df408` | `c4960f0c00aae28400de1811285458995c5b61591bd7ce42353f99ad6ab47068` |

RxDB uses its existing subscription's `closed` state rather than adding an
independent active flag. Earlier RxDB candidate `df25ff89…` used an active flag;
its results below are historical. Earlier PowerSync candidate `831ea195…`
differs from the final candidate only in reading private `_lifecycle.reloading`
instead of public `health.reloading`. Final frozen files and manifests are under
`/private/tmp/pr2394-baseline-lifecycle-evidence/final-candidates`.

## Executed results

| Receiving path | Original | Final candidate |
| --- | --- | --- |
| RxDB controlled + Node SQLite | 46/46 GREEN | 48/48 GREEN |
| RxDB Chromium/OPFS | 23/23 GREEN | 24/24 GREEN |
| PowerSync controlled + Node SQLite | 40/40 GREEN | 42/42 GREEN |
| PowerSync Chromium/OPFS | 20/20 GREEN | 21/21 GREEN |

The original mode sets `TANSTACK_DB_BASELINE_EXPECT_HYDRATE=0`: it proves the
acknowledgment neighbor without claiming the candidate's new await was entered.
Normal final mode requires actual hydrate invocation/held-return reach. No
live production edit may be justified by a retrospective original-mode result.

For RxDB's final candidate, fixed/fresh counts by path are:

| State | Controlled fixed/fresh | Node SQLite fixed/fresh | Chromium fixed/fresh |
| --- | ---: | ---: | ---: |
| accepted-before-retirement | 27/28 | 27/30 | 27/27 |
| adapter-hydrate-continuation | 27/28 | 27/30 | 27/27 |
| cleanup-held-continuation | 11/16 | 11/15 | 11/13 |
| empty-replacement | 5/7 | 5/5 | 5/9 |
| receipt-rejection-held-baseline | 4/1 | 4/2 | 4/7 |
| reload-held-continuation | 2/2 | 2/5 | 2/3 |
| replacement-omits-old | 18/16 | 18/17 | 18/14 |
| replacement-overlap | 18/17 | 18/19 | 18/12 |
| source-failure-held-baseline | 7/6 | 7/4 | 7/7 |
| stream-failure-held-continuation | 10/9 | 10/8 | 10/4 |

These counts exclude literal fixed histories but include every seed-derived
construction and subsequent generated histories. Each minimum-one builder is
also challenged by its own permanent missing-state calibration.

Commands, from the adapter package, disable coverage/typechecking only for the
bounded oracle execution; separate strict TypeScript checks remain GREEN:

```sh
TANSTACK_DB_BASELINE_EXPECT_HYDRATE=0 \
pnpm --config.verifyDepsBeforeRun=false exec vitest run \
  tests/persisted-baseline-lifecycle-oracle.test.ts \
  --coverage.enabled=false --typecheck.enabled=false --maxWorkers=1

TANSTACK_DB_BASELINE_CANDIDATE_DIR=/private/tmp/pr2394-baseline-lifecycle-evidence/final-candidates \
pnpm --config.verifyDepsBeforeRun=false exec vitest run \
  --config /private/tmp/pr2394-baseline-lifecycle-evidence/rxdb-candidate.config.ts \
  tests/persisted-baseline-lifecycle-oracle.test.ts --maxWorkers=1
```

PowerSync native commands invoke the validated Node 24.22.1 executable directly,
prepend its directory to PATH, use `--pool=forks --maxWorkers=1`, and serialize
native runs with the other PR campaigns. The same runtime’s provider-selection probe reports ABI 137 and
`better-sqlite3`; the driver passes that exported selection to PowerSync.
Its bounded gate adds `-t 'fixed history:'`.
Browser commands run from the browser persistence package using
`test:oracles:adapters-browser tests/persisted-baseline-lifecycle-oracle.test.ts`
with an adapter name filter; the same candidate directory enables the overlay.

PowerSync final Chromium fixed/fresh reach is accepted/hydrate 29/27,
cleanup 13/14, empty replacement 6/11, receipt rejection 7/7, reload 9/6,
omission 20/25, overlap 20/13 and initial source failure 4/6. Original Chromium
fixed/fresh reach is accepted 27/25, cleanup 16/16, empty 6/5, receipt rejection
5/5, reload 6/4, omission 18/17, overlap 17/14 and source failure 5/7.
Both runs include all fixed histories, builder calibrations and determinism.
PowerSync final controlled fixed/fresh reach is accepted/hydrate 29/22,
cleanup 13/13, empty 6/3, receipt rejection 7/4, reload 9/5, omission 20/13,
overlap 20/13 and source failure 4/11. Final Node SQLite fixed/fresh reach is
accepted/hydrate 29/26, cleanup 13/16, empty 6/8, receipt rejection 7/6, reload
9/4, omission 20/14, overlap 20/17 and source failure 4/7. Both normal properties
pass all 42 checks. Original controlled and Node SQLite pass all 40 checks;
original fixed counts equal the original Chromium fixed counts above, and
fresh controlled counts are accepted 27, cleanup 14, empty 13, receipt rejection
6, reload 7, omission 19, overlap 11 and source failure 5. Fresh Node SQLite
counts are accepted 26, cleanup 15, empty 10, receipt rejection 4, reload 7,
omission 14, overlap 15 and source failure 6.

## RED controls and model corrections

Removing only RxDB's post-hydrate subscription fence produces candidate
`4d89712fb798866ce12394772c119f777f7e225ffb0090be43c7af326a5b5182`.
All four fixed stream-error comparisons on controlled and Node SQLite reject
it at checkpoint `lifecycle`, law `persisted source lifecycle`, difference
`accepted obligations changed after terminal source failure`. Both histories
have prior bitset 3, old bitset 1 and batch size 1, with replacement 0 or 6.
The log contains a positive exact transform/hash witness. This proves an
observable public/durable distinction for the fence, without imposing a
zero-internal-work law. Both fixed Chromium stream-error comparisons reject
the same mutant at the identical law/checkpoint, with an exact hash witness.
The clean final candidate passes those two histories again.

A generated-only recorder control suppresses `cleanup-held-continuation` only
on a generated builder output whose serialized history differs from every
seed-derived construction in the running campaign. A test-only framework
transform records the seed-derived signatures; the shared model, production
observations and comparisons remain unchanged. A fresh run draws campaign seed
`-661318797`, then fails at path `29:0:0:0:0`, checkpoint `reach`, law
`constructed builder reach`, difference
`generated construction omitted cleanup-held-continuation`. It shrinks from
prior 0/old 4/replacement 5/batch 2 to all-empty memberships/batch 1, cleanup,
default rendering. The registered owner’s guarded replay records exactly one
completed execution;
mutant witness has `failed:true`, clean witness `failed:false`.

Several initial red results indicted the proposed test rule, not production:

- Requiring reload to reject the Collection's retained preload promise was
  wrong. Reload keeps that promise and replacement readiness fulfills it;
  cleanup rejects it with AbortError. The original trace remains in
  `/private/tmp/pr2394-baseline-lifecycle-rx-fixed.log`.
- A synthetic acknowledgment rejection does not itself retire the source.
  The first model froze omitted saved rows too soon. Counterexample prior 1,
  old 0, replacement 0 validly accepted omission before `fail()` observed the
  rejection. The corrected judgment requires every delivered source row,
  permits each omitted saved row to remain or leave, and still checks exact
  failure identity, no successful readiness, resource release and handled
  rejection. `/private/tmp/pr2394-baseline-lifecycle-rx-candidate.log` retains
  the rejected prediction. No production repair was made for it.
- Before a genuinely held restore completes, the persisted wrapper may defer
  public failure. The adapter must report the exact error and release its
  provider while held; public failure is checked after restore. In RxDB's
  terminal stream-error branch the genuine restore already completed, so
  public failure is required while only the adapter return remains held.
- PowerSync diagnostics contain an opaque random private tracking-table
  suffix. Determinism rejected two equal failures with different suffixes.
  The recorder now replaces only `__rows_tracking_[hex]`, keeping message
  remainder, order/count and injected error identity. This changes no HEALTH-5
  exception. The unprojected failures remain in the original browser logs.
- An early no-fence run had no positive transform witness and used stale Vite
  cache. Its survival is discarded. Content-keyed plugin/cache names and
  positive exact hash output establish the credited mutant execution.

## Integration checks, limits and review

Strict `tsc --noEmit` passes for RxDB, PowerSync and browser persistence.
Scoped ESLint passes and Prettier was applied to every owned file. Branch-wide
`lint:changed` completed with exit 0 after the support edits. Existing Playwright
portfolios and run budgets remain; the dedicated browser config receives these
additional properties and default Vitest discovery excludes their browser-only
owners. Property registration and direct-replay metadata are maintained by the
parent integration agent.

ORC-001/2/3/5/9/14: accepted authorities, independent judgment, prose and shared
receiving comparisons are above and beside executable code. ORC-004/7/15:
grammar controls, equal budgets, replay and enforced generated reach are above.
ORC-006/10/13: wrong durable rows and per-builder omissions calibrate the same
check; the genuine stream-error fence mutant rejects a nearby wrong design;
cleanup preserves primary errors through `withOracleCleanup`. ORC-008 does not
apply to a new state machine: this receiver adds a differential preservation
law and imports the existing row judgment. ORC-011: an independent reviewer
challenged the mistaken receipt-retirement prediction against the contract.
Its correction is documented above. No remaining concrete shared-semantic-fault
hypothesis requiring a different formulation was identified. This is not an
exhaustive semantic search. ORC-016: every fixed history uses the
same declared grammar/check; no ordinary unit tests were added to oracle files.
ORC-012: this record separates executed results, corrections and remaining gates.

Limits: one prior run and one replacement, three keys, local SDK data, no remote
replication, arbitrary concurrent user mutation, failed storage I/O, arbitrary
partial-construction cleanup, synchronous Observable registration failure or
all intermediate publication states. The receiver proves lifecycle behavior
at the named cuts; startup cost and batching cardinality belong to separate
measurement and work-refinement evidence. No whole-PR readiness or universal
bug-class closure is claimed. These finite lifecycle receiving gates pass;
primary startup, retained reload and work-refinement gates remain separate
evidence.
