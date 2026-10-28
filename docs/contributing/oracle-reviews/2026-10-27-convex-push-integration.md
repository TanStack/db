# Convex lazy-paging push integration

Local implementation parent: `929e3533e358ba70d79941fa8c195b4bb6cf1748`.
Incoming PR branch parent: `26bc43454ddfbdfa65d32afb2a72d06b19c64baf`.
The adjacent [source manifest](2026-10-27-convex-push-integration-source.json)
binds the merged sources and rebuilt DB runtime checked below. Earlier review
records and frozen artifacts retain their original source bindings.

The remote branch advanced while the lazy-paging work remained local. This
normal merge preserves its main merges, documentation validation and shared
oracle helpers. The only textual conflict was the DB `test:oracles` command;
the resolution retains every incoming entry and adds the joint-replay receiver.

Incoming oracle lint requires shared run-budget scaling. Literal budgets now
use `oracleRuns`, and the lazy profile composes the shared multiplier with its
existing optional multiplier. Normal budgets and direct-replay overrides stay
the same. No histories, scientific predictions, public observations or oracle
comparisons change in this integration. The Convex production and model/comparator modules recorded in the source
manifest are byte-identical to the local parent.
The merged DB core and React adapter were rebuilt before receiving validation.

The new lazy-paging guide example supplies its server-query type explicitly;
a generated Convex API normally supplies it. The snippet checker now resolves
provider imports through the documented adapter before treating an absent root
dependency as untyped. This uses the actual installed provider declarations;
it does not suppress the type comparisons.

## Validation

- Convex package: 112 cases across 21 files, no type errors.
- Actual isolated backend: 23 cases across 8 files, both real SDK paths.
- Core joint-replay receiver: one generated campaign owner, fixed/random reach
  at all five declared states; 35 histories per campaign.
- React receiving path: four cases, no type errors.
- Shared-multiplier witness: value two makes all outcome/abort states reach
  60 histories in each fixed/random campaign, versus the normal 30.
- Oracle lint, affected-file ESLint, checker ESLint, formatting and diff against
  the incoming branch pass. No normal budget was lowered.
- The changed Convex snippet compiles with actual provider types.

The full documentation sweep is not green in this dependency environment.
It reports six PowerSync examples with absent `list_id`/`completed` fields and
one stale Svelte baseline entry. The incoming checker with the incoming Convex
guide reproduces those same six failures and stale entry. PowerSync docs,
PowerSync sources, DB sources and the snippet syntax helper match the incoming
branch. These diagnostics are retained in the task-local integration evidence;
no baseline was expanded to hide them. The new Convex example is the additional
769th example and passes its focused compilation.

Earlier intermediate diagnostics are retained: backend setup without local-port
permission, missing React coverage instrumentation, a temporary unused import
during run-budget integration, and snippet checks before provider type resolution.
The final backend run has local-port access, the React receiving run disables
coverage instrumentation, and the final package/static checks pass. These setup
and integration diagnostics are not semantic oracle counterexamples.

Law, reach, RED/GREEN, mutant and limit evidence for the implementation remains
in the earlier versioned records. This merge does not claim a new product-defect
RED, new mutant campaign, TLA+ execution or independent delegated review. Its
new evidence is integration and unchanged-model receiving validation. Prospective
immediate core abort for uncooperative adapters remains #2168 work.

The local `baseline-browser-mapping` 2.11.32 to 2.11.30 override and its lockfile
changes remain excluded from commits. No reinstall was needed.
