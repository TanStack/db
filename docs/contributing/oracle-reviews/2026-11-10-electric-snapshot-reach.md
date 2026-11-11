# Electric snapshot campaign reach repair

Subject: PR #2380, parent `7838a1c8d73e820e8f56383a90624fa28a6ca67b`.
The initially tested oracle blob was `116ecabd33bcd503c120c78e2b7f270a5924f316`;
pre-commit sorted its imports. Initial implementation commit:
`9bdb61b9248c99f1e5b17ce04555ee2ae25c146d`.
The refresh entry below identifies the current reviewed test.

## Evidence

- **Law:** Installed-SDK subset delivery preserves the overlapping source
  snapshots. Retried subset requests and live pauses do not report a source
  outage. Five failed shape-log attempts report the fifth failure. Retired
  evidence becomes usable when the restarted run is ready. Authority: HEALTH-4,
  EVID-2, META-1 and the existing maintainer decisions of 2026-10-30 and
  2026-11-02, cited beside `checkSnapshots` and in the coverage map.
- **RED:** On the parent, the command below failed the campaign census with
  `live-outage-crossed-by-throw` missing. The semantic comparisons passed.
  This was a sampled reach gap, not a demonstrated production defect.
- **GREEN:** The same command passes after the repair. The full changed file,
  with coverage and typechecking enabled, passes 130 tests with no type errors.
  `pnpm lint:changed` and the changed file's ESLint check pass.
- **Mutant:** Seven native calibrations remove one reach observation each.
  Every removal fails the per-history check with law `constructed reach`.
  A direct replay with `TANSTACK_DB_ELECTRIC_SDK_DELIVERY_FAULT=snapshot-rows`
  fails the unchanged product comparison at `snapshot 0 applied rows`.
  This is an assertion failure, not a timeout or setup failure.
- **Limits:** Controlled HTTP through the installed SDK; no live Electric
  service or native-host claim. The original finite predicates, retry bounds,
  row checks and run budget remain. No production or product-model change.

RED / reseeded GREEN command (from the repository root):

```sh
TANSTACK_DB_ORACLE_SEED=361651584 pnpm --config.verifyDepsBeforeRun=false \
  --filter @tanstack/electric-db-collection exec vitest run \
  tests/electric-sdk-delivery-oracle.property.test.ts --maxWorkers=1 \
  --fsModuleCache=false --typecheck.enabled=false --coverage.enabled=false \
  -t 'electric.sdk-snapshot-delivery > random seed'
```

The repaired property was also run with `-t 'electric.sdk-snapshot-delivery'`
so its determinism and missing-state calibrations executed. The normal full-file
run omitted the seed, name filter and typecheck/coverage overrides.
The dropped-row replay uses the same file with seed `361651584`, path `0`,
property `electric.sdk-snapshot-delivery` and the fault switch above.

Reach counts in the repaired fixed / reseeded campaigns (40 generated runs plus
one seed-derived construction in each):

| Declared state | Fixed 20260917 | Reseeded 361651584 |
| --- | ---: | ---: |
| subset-attempts-past-threshold | 34 | 30 |
| live-pauses-past-threshold | 31 | 25 |
| live-outage | 24 | 21 |
| live-outage-with-synchronous-throws | 24 | 21 |
| live-outage-led-by-throw | 24 | 15 |
| live-outage-crossed-by-throw | 23 | 17 |
| retired-evidence-after-restart | 41 | 41 |

The minimum is one for each state, enforced on each seed-derived construction
and on every fresh generated construction. The builder preserves generated
width, name, middle live failure kinds, retry suffixes and optional extra loads.
It splices five subset retries, at least five actual snapshot requests, and a
live sequence led and crossed by a throw. Removing the splice loses guaranteed
reach. The original arbitrary still explores zero-to-four failures and other
orders; every constructed tuple remains within its bounds. Invalid payloads
outside the requested predicate remain excluded by the original driver.

## Self-review against the rubric

ORC-001/002/003: Product authority, independent source Map and health judgment,
public observation cuts, literate contract and limits remain unchanged.
ORC-004: The original grammar remains available; the constructed subset is
within its bounds and preserves the known throw-crossing witness. The preceding
paragraph records reconstruction, ablation, ranges and exclusion.
ORC-005: Reach is recorded after actual requests/retries and completed restart
comparisons, rather than inferred from the intended input. No concrete missing
source-information hypothesis arose in this generator repair.
ORC-006/007: Missing-state controls and dropped-row replay reject their intended
wrong answers. Fixed/random campaigns use the same 40-run budget and driver;
the checked direct replay reaches the original product checkpoint.
ORC-008/009: No product reference-model state or vocabulary changes; the new
WeakMaps track test construction obligations and observations only.
ORC-010: The existing assertion transport, same-violation shrinking and cleanup
controls remain; all pass in the full-file run. Product failures precede reach
failures in the new comparison.
ORC-011: No shared semantic fault hypothesis was identified; a second product
formulation is not triggered by this reach-only repair.
ORC-012: This versioned record bounds the claim to this oracle's reach gap.
ORC-013: The original threshold comparisons and unconstrained histories remain;
this repair adds no new reusable product-boundary claim.
ORC-014: No transfer from controlled HTTP to a live service is claimed.
ORC-015: All seven states are declared, constructed and counted; missing-state
calibrations exercise the per-history enforcement used for generated outputs.
ORC-016: New tests are checker calibrations through the shared comparison.

## Revalidation after the release bot refresh

Main merged the oracle API migration #2407 as
`e332f6134eb26b241cc5025da63ffef9bf0b0519`. The release bot replaced its
branch with `4888c630b7cab8f61f1e72ae57396716732c6a91`, dropping the repair.
The repair was reapplied to that parent without reverting the migration:
`owns` stays on every `oracleProperty`, and `law.owner` stays removed.
Current reviewed oracle blob: `7b76acc6902f4e8778d29b04fd9e117c49d6cbd9`.

With the new locked framework `d1b508a`, the RED command above again fails
for the missing `live-outage-crossed-by-throw` state on the refreshed parent.
The repaired fixed and reseeded campaigns and all seven missing-state controls
pass (10 tests). Their reach counts match the table above. The full file with
normal fixed/random campaigns and typechecking passes 130 tests with no type
errors. The same direct replay mutant fails `snapshot 0 applied rows`.
Changed-file lint passes with the migrated ESLint plugin. No installation
overrides were needed. The law, grammar bounds, product comparisons and limits
in the original review remain unchanged.
