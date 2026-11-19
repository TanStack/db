# Persisted-startup gap CLI audit

Reviewed oracle integration: `348ddac2ceeb486cf6cf5995363a50e4698a0220`.
Production is unchanged from `66cbad438b7982cd64e83bba560292b62cd34a80`.
Diff base: `ea3c920c1540486d0fb7410e089baa3a1583299c` (`origin/main`).
The oracle author performed this audit. It is not an independent review.

## Law and scope

The shared persisted-startup owner judges complete replacement of saved rows,
with scoped ownership for Query, before refresh can repair the result. Its
network-first histories also preserve saved public and durable rows during
fallback and replace them after the first complete source result. The authority,
generated reach, original RED evidence and real-host limits remain in
[network-first startup](2026-11-10-network-first-startup.md) and
[adapter startup](2026-11-10-persisted-startup-adapters.md).

This audit selects every operator mutant on production lines changed by this
PR, plus five authored semantic controls. It selects 24 of 2,651 Query mutants,
5 of 131 RxDB mutants, 5 of 528 PowerSync mutants, and 7 of 368 TrailBase
mutants. This is a diff-focused audit, not a whole-file audit. Convex and
Electric production files do not change in this PR. Their startup receiving
comparisons still run in the normal six-adapter validation.

The CLI is the locked `@tanstack/oracles` package at `fe532f4`. Each package
runs both unmutated baselines with seed 2367 before its selected mutations.
Ordinary tests are not credited as oracle kills. Authored controls are
attributed to `/root (oracle author; sensitivity control, not independent
review)`.

```sh
pnpm gap-report --package packages/rxdb-db-collection \
  --source src/rxdb.ts --diff-base origin/main --seed 2367 --contexts 3 \
  --only rxdb.ts:M5,rxdb.ts:M6,rxdb.ts:M7,rxdb.ts:M8,rxdb.ts:M9,authored:pending-baseline-is-not-snapshot \
  --mutants <authored-mutant-directory> --out <output-directory>
```

The other packages use their corresponding changed-line IDs below. Scratch
artifacts retain the exact selection JSON, authored transformations, logs,
partial captures and completed `results.json` reports. The local dependency
recovery overrides remain uncommitted. Commands add
`--config.verifyDepsBeforeRun=false` for that local installation only.

## Test integration repairs

Each of the six startup registration files now declares ownership of its
adapter entry point. The shared model and checks remain shared. The Node
production driver reports its existing violation list through Vitest's assertion
at the original comparison cut, so the CLI can distinguish a law rejection
from an uncaught runtime failure. Browser receivers retain structured errors.
No expected value, history, observation cut, or run budget changed.

Calibration tests declare the calibration route. The dropped-write calibration
first runs the clean candidate and skips a candidate already rejected by the
normal law. Clean and corrupted runs use distinct fresh storage hosts, since
the controlled host models one Collection rather than multiple IDs.

Initial attempts exposed missing ownership and failure classification. Their
setup/runtime errors do not count as behavioral kills. Stopped full-file scans
are not completed audits. The normal test run also found ignored temporary CLI
copies left by stopped scans. Those copies were removed, and validation was
repeated with the temporary-copy pattern excluded. No product test was excluded.

## Results

| Receiver | Selected | Classified | Law rejections | Survivors | No final classification |
| --- | ---: | ---: | ---: | ---: | ---: |
| Query | 26 | 21 | 16 | 5 | 5 |
| RxDB | 6 | 6 | 5 | 1 | 0 |
| PowerSync | 6 | 6 | 5 | 1 | 0 |
| TrailBase | 8 | 8 | 7 | 1 | 0 |
| Total | 46 | 41 | 33 | 8 | 5 |

There are no reported production crashes among the classified mutants.
Completed report IDs are `debe30ba9ef2` (RxDB), `9c853138a811` (PowerSync),
`2938619712c4` (TrailBase), and `4e559092f456` (Query authored controls).
Query's operator evidence combines the preserved partial result streams from
`gaps-query-diff` and `gaps-query-remaining`, without counting duplicate results.

All five authored controls fail the shared startup comparison on a reproducible
fixed-history route. The CLI stops at the first rejecting receiver: these
kills credit the controlled host, not an additional Node SQLite or OPFS run.
The earlier real-host RED evidence remains separate.

| Authored control | Transformation | Rejecting history |
| --- | --- | --- |
| Query `skip-baseline-await` | Replace the hydrated-baseline condition with `false`. | fetched response before restore, previous mask 1, next mask 2 |
| Query `cached-results-ignore-baseline` | Keep only retained-query revalidation in `needsPersistedBaseline`. | fetched response before restore, previous mask 1, next mask 2 |
| RxDB `pending-baseline-is-not-snapshot` | Remove the persistence-capability operand from snapshot selection. | response before restore, previous mask 1, next mask 2 |
| PowerSync `pending-baseline-is-not-snapshot` | Remove the persistence-capability operand from snapshot selection. | response before restore, previous mask 1, next mask 2 |
| TrailBase `sweep-before-baseline` | Replace baseline hydration with `await Promise.resolve()`. | response before restore, previous mask 1, next mask 2 |

Query operator mutants `M1451` through `M1455` have no final classification.
The CLI repeatedly aborts their group with `has no unit and no earlier kill`
for `includes-work-counter-oracle.test.ts` or `ssr-dehydration-oracle.test.ts`.
A one-context retry also fails. A reduced group fails at `M1455`. The dependency
was not patched to manufacture a result. These five are neither kills nor
survivors. The Query authored-only run completes independently.

Selected operator IDs are Query `M1451–M1458`, `M1462–M1470`, `M1733`,
`M1775–M1780`; RxDB `M5–M9`; PowerSync `M160–M164`; and TrailBase `M36`,
`M145–M150`. The remaining CLI work is to repair or upgrade the CLI's unit
accounting and rerun the five unclassified Query operators. This audit remains
incomplete rather than reporting a fabricated whole-PR mutation score.

## Surviving distinctions

A surviving mutant is a coverage signal, not proof of a product defect or
permission to remove a guard. None below is approved as globally equivalent.
The coverage map retains these exact open distinctions.

- **RxDB `M9` and PowerSync `M164`:** remove the negation of
  `acceptedSyncedEntries().next().done`. Persistence makes the left operand
  true, so these mutations cannot alter snapshot selection on the persisted
  receiving path. The bare eager-source grammar reaches the right operand but
  starts empty after cleanup and does not reload retained rows. The missing
  receiving witness is an unwrapped retained-row reload that changes or omits
  a key, plus a fresh empty load while an optimistic transaction is persisting.
  Authority: the glossary's reload/snapshot contract and accepted sync ordering.
  The shared eager-source owner explicitly excludes reload. The Collection
  subscription-lifecycle grammar owns the core boundary and needs adapter
  receivers for this distinction. This audit does not establish the broader
  unwrapped reload claim.
- **TrailBase `M150`:** replace `if (cancelled) return` after
  `hydrateBaseline()` with `if (false) return`. Classified `generator-gap`:
  no startup history cleans up during that held await. The needed witness holds
  persisted restore, completes the list, cleans up, optionally starts a new
  sync run, then releases the old restore. Compare old-work rejection, current
  public/durable rows and resource release. Its lifecycle owner is
  `tests/lifecycle-oracle.property.test.ts` under `tests/ORACLE.md`; the startup
  composition supplies the real persistence receiving path. Core fencing may
  make the extra work publicly inert, but that hypothesis is not an executed
  equivalence result.
- **Query `M1466`:** always await optional baseline hydration, including
  branches that retain the scoped baseline path. No observed difference in
  the reached histories. A distinguishing case must show an owed work/order
  difference for an on-demand or retained-query result. Owner:
  `tests/ownership-lifecycle.oracle.test.ts`, with the persistence reload work
  owner for scan counts. No new performance promise follows from this survivor.
- **Query `M1458`:** replace `queryToRows.has(queryHash)` with `undefined`, so
  every eager persisted result takes the reconciliation route. The normal
  startup law cannot distinguish redundant selection after its first result.
  The next witness needs a later result with established ownership and an
  observable work or ordering difference. Owner: Query ownership lifecycle
  and the persistence reload work oracle. This is not evidence of repeated
  physical row reads.
- **Query `M1778` and `M1779`:** change or omit the recorded fetch-start
  generation fallback. The missing distinction is an older fetch/application
  crossing a newer direct write while persisted reconciliation is held. Owner:
  `tests/persisted-direct-write-window.oracle.test.ts` and its shared reload
  receiving driver. The physical-fetch clock can supply redundant evidence,
  so source inspection alone cannot prove a public violation.
- **Query `M1733`:** omit the baseline classifier in the derived-select branch
  whose cache envelope has no inverse. The next witness crosses that branch
  with a retained persisted baseline and a newer direct write, then compares
  rows and durability at application settlement. Owner: Query ownership
  lifecycle and direct-write window. Ordinary startup histories do not supply
  this combination.

These records do not retire any law, approve an exclusion, or classify an
unreproduced product violation as fixed. The initial complete-result replacement
claim keeps its original scope. A broader claim that all changed decisions are
fully judged remains unproven.

## GREEN and limits

After the integration repairs, all 208 normal shared startup checks pass:
160 fixed histories, 24 generated campaigns (80 histories each), and 24
calibrations. Every adapter/host/campaign keeps its own enforced reach.
All 80 fixed Chromium worker/OPFS histories pass the same comparisons.
The first local OPFS attempt timed out before page completion. Its rerun
completed in 21.4 seconds. That timeout supplies no behavioral RED evidence.
The shared package typecheck, ESLint, Prettier and `pnpm lint:changed` pass.

No production repair follows from this audit. The integration repair preserves
model independence, finite history domains, original checkpoint enforcement,
first-source readiness/applied receipts, and error-preserving cleanup. There is
no new grammar or model rule, so ORC-004/008/009 controls remain those recorded
for the original owner. ORC-001/002/003/005/007/010/013/014/015/016 remain at the
same boundaries. ORC-006 gains the CLI evidence, with internal CLI failures
kept separate from law rejections. ORC-011 has no newly identified shared
semantic fault. This record supplies the ORC-012 integration audit and its
explicit unresolved mutation distinctions.
