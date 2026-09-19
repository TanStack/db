# Workflow 3 — CI gate

## 1. Assumptions

- The CI provider is GitHub Actions on Linux, and the repository already has Node, pnpm, the Trust CLI, and the endpoints Trust module in its lockfile. The exact package/import names are not assumed.
- The checked-in Trust configuration is equivalent to the packet's `base` and `endpoints` fragments and exports a `ci` policy whose default action is `block`.
- A read-only CI transport identity can read the Trust service and the checkout but cannot call any `trust.command.*` operation. Query authentication and capability names are not specified by the packet.
- The first simulated checkout contains a fictional endpoint mutation use named `updateTodo` whose `completeEffects` premise lacks applicable evidence. The second simulation is a separate run in which source inspection fails after configuration resolves.
- GitHub's artifact uploader is trusted to copy files after the Trust process exits. Uploading a local file is not a Trust-state mutation.

## 2. Code and calls

The checked-in Trust configuration consumed by the job would have this body (imports are omitted because the packet does not name packages):

```ts
export default defineTrustConfig([
  config('base', {
    modules: { endpoints: endpointsTrust },
    extends: [endpointsTrust.configs.recommended],
  }),
  config('endpoints', {
    subjects: endpointsTrust.subjects.endpoints(),
    levels: { endpoints: 'standard' },
    rules: {
      'endpoints/safe-skip-refetch': {
        enabled: true,
        options: { level: 'standard' },
      },
    },
  }),
])

export const policies = definePolicies({
  development: policy({ defaultAction: 'warn' }),
  ci: policy({ defaultAction: 'block' }),
})
```

I would run only the documented CI operation, with one invented output option called out in section 6:

```sh
trust ci --profile ci --report "$RUNNER_TEMP/trust-artifacts/trust-report.json"
```

No LSP, MCP, Devtools, or `trust.command.*` call belongs in this job. In particular, the job must not call `contexts.put`, `runs.plan`, `runs.execute`, `runs.submit`, `work.*`, or `overrides.*`. An override must already exist before the pinned evaluation instant to participate.

A concrete GitHub Actions job is:

```yaml
name: Trust CI

on:
  pull_request:
  merge_group:

permissions:
  contents: read

jobs:
  trust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - name: Install locked dependencies
        run: pnpm install --frozen-lockfile

      - name: Evaluate the pinned Trust snapshot
        shell: bash
        run: |
          set -uo pipefail
          artifact_dir="$RUNNER_TEMP/trust-artifacts"
          mkdir -p "$artifact_dir"

          set +e
          pnpm exec trust ci \
            --profile ci \
            --report "$artifact_dir/trust-report.json" \
            2>&1 | tee "$artifact_dir/trust-ci.log"
          trust_status=${PIPESTATUS[0]}
          set -e

          if [[ ! -s "$artifact_dir/trust-report.json" ]]; then
            echo "Trust produced no machine-readable report." | tee -a "$artifact_dir/trust-ci.log"
            trust_status=2
          fi

          case "$trust_status" in
            0) summary="Trust allowed this snapshot" ;;
            1) summary="Trust policy blocked this snapshot" ;;
            2) summary="Trust could not produce a valid decision" ;;
            *)
              summary="Trust exited unexpectedly; treating the result as unable to evaluate"
              trust_status=2
              ;;
          esac

          echo "### $summary" >> "$GITHUB_STEP_SUMMARY"
          echo "Exit code: $trust_status" >> "$GITHUB_STEP_SUMMARY"
          exit "$trust_status"

      - name: Upload Trust report and human log
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: trust-ci-report
          path: ${{ runner.temp }}/trust-artifacts/
          if-no-files-found: error
```

The CLI's ordinary terminal output supplies the human explanation; the report file is the machine artifact. The wrapper preserves documented exits 0, 1, and 2, maps any undocumented process exit to 2, and also maps a missing report to 2. The upload step uses `always()` so both blocking and unable-to-evaluate runs retain their output. If upload fails, the overall provider job remains non-green even if Trust returned 0; that is CI infrastructure failure, not a rewritten Trust decision.

### Simulated policy-blocking output

The illustrative human output is:

```text
BLOCK endpoints/safe-skip-refetch — updateTodo
Required completeEffects evidence is missing for updateTodo.
snapshot: S-block
result: policy blocked (exit 1)
```

The corresponding `TrustReport` has `decision = D-block`, one active `TrustDiagnostic` with `kind = 'observation.missing'`, `action = 'block'`, `severity = 'error'`, and the report snapshot `S-block`. Its `condition`, `rule`, `claimUse`, locations, causes, authority, actions, and message fields are populated with the same refs/details shown in the human output. `operationErrors` is empty. The report does not claim that the missing premise has evidence and does not create work.

### Simulated operation failure output

The second independent run resolves configuration, then its read-only source-provider operation cannot inspect one required source input:

```text
UNABLE operation.failed — source inspection did not complete
No valid policy decision was produced.
snapshot: S-error
result: unable to evaluate (exit 2)
```

That `TrustReport` has the valid resolved-config ref and `snapshot = S-error`, `decision = null`, an `operation.failed` diagnostic, and a corresponding entry in `operationErrors`. It exits 2, not 1: absence of a decision is not a policy block. No override can turn a failed evaluation into evidence. (A configuration-resolution failure should also exit 2, but the packet does not explain how its non-null `TrustReport.config` field is represented when no resolved config exists.)

## 3. State trace

### Run A: valid decision that blocks

1. **Checkout and install.** Local files and dependencies appear in the runner. Trust conditions, evidence, work, overrides, and durable snapshots are unchanged.
2. **Start `trust ci`.** The CLI resolves the checked-in configuration and pins `S-block = { version, cursor, configRevision, evaluatedAt }`. Every condition query and policy evaluation for this process must use that exact token. It performs no command and runs no evidence method.
3. **Read condition/evidence state.** `endpoints/safe-skip-refetch` is applicable to `updateTodo`. The `completeEffects` premise has no applicable observation, so an `observation.missing` condition is active. Existing evidence history is merely read; no successful, failed, or synthetic observation is added. Existing work, if any, is merely read and no work item is created or closed.
4. **Evaluate policy.** The `ci` profile projects the strictest applicable action. With no active exact override for this condition/use/profile/action, the diagnostic action is `block`. Policy evaluation returns non-null `D-block`, bound to `S-block`, the `ci` profile, the override set, its evaluation instant, and its validity deadline.
5. **Emit and exit.** The same `S-block` appears at report level and on its diagnostic/action descriptors. The CLI writes the report, prints the explanation, and exits 1. These outputs cause no Trust-state transition.
6. **Upload.** CI uploads the already-written report and log without re-querying. Therefore the artifact cannot accidentally combine a later condition cursor or override set with `D-block`.

### Run B: unable to evaluate

1. **Checkout, install, and pin.** A separate invocation resolves config and pins `S-error`; durable evidence, conditions, work, and overrides remain unchanged.
2. **Operation fails.** Read-only source inspection fails before a complete subject/evidence view is available. No observation is added. No work transition occurs.
3. **Evaluate result.** Because the input set is incomplete, there is no valid decision token. The report has `decision = null`, describes `operation.failed`, includes an operation error, and retains `S-error` as the attempted evaluation boundary. The process exits 2.
4. **Upload.** The partial-but-schema-valid report and log upload under `always()`. They are not reused as an allow/block decision.

### Snapshot, override, and expiry behavior

- A single report must never contain diagnostics from multiple snapshot tokens. If `cursor`, `configRevision`, or any policy input changes during evaluation, the CLI must either re-pin and recompute the whole report or return exit 2; it must not splice results.
- An active override is evaluated only if its exact condition, use, profile, and action targets match at the pinned evaluation instant and it has the required authority. It may change the projected action/decision, but the underlying condition remains in `conditions` and the override remains visible in `overrides`. Expired, unused, shadowed, and ambiguous records are reportable but must not silently hide the condition.
- Exit 0 is meaningful only while the decision token remains valid. If the token expires or any bound input changes before the CLI finalizes, evaluation must run again or exit 2. If merge/deployment happens later than the token validity deadline, the consumer must re-run policy evaluation; a previously uploaded green artifact is historical evidence of a decision, not perpetual deployment permission.
- The uploader must copy exactly the report already used to choose the process exit. It must not call Trust again. Upload failure keeps the provider gate non-green but cannot mutate the report's decision or turn exit 1 into exit 2 retrospectively.

## 4. Clear parts

- `trust ci --profile ci` is the discoverable operation, it must not run hidden evidence methods, and 0/1/2 unambiguously mean allow/block/no valid decision.
- Configuration activates obligations while policy only changes visibility/severity/fallback/action; policy cannot manufacture evidence.
- `TrustReport` gives one top-level place for the pinned snapshot, resolved config, profile, decision, diagnostics, operation errors, overrides, and deprecations.
- Queries are side-effect-free, and every command is clearly segregated under `trust.command`, making a query-only CI principal conceptually straightforward.
- Decision tokens are explicitly bound to snapshot, profile, override set, evaluation instant, and deadline. Overrides never hide conditions and are evaluated for expiry at the policy instant.
- A missing observation, an operation failure, and a configuration failure have distinct condition/error semantics. Work state and agent assertions cannot satisfy a premise.

## 5. Friction

- The only documented CI syntax has no report path or serialization option and no guarantee that a `TrustReport` is emitted on exits 1 and 2. That blocks the required artifact without inventing CLI behavior.
- It is not stated whether human output and machine JSON use stdout, stderr, separate files, or an envelope. Redirecting stdout could corrupt JSON if human text is mixed in.
- The packet does not say how a clean checkout is associated with a snapshot, how the CLI discovers the config, or how local source-provider inspection remains side-effect-free while Trust retains condition occurrence history.
- Snapshot-bound query input shapes are omitted, as are the internal calls used by `trust ci`; a user cannot independently verify that every read used the report snapshot.
- `DecisionToken` is opaque in the shown schema. Although its deadline binding is specified, the consumer has no shown field/query for checking the deadline before a delayed merge.
- `TrustReport.config` is non-null even though invalid configuration is an explicit unable-to-evaluate case. The failed-config report representation is therefore unclear.
- Query authentication and a read-only CI capability are not specified. Filesystem `contents: read` permission does not prove that the Trust transport cannot issue commands.
- Override precedence is described, but the required CI result for an ambiguous/invalid override set is not explicitly tied to exit 2.
- GitHub ultimately presents nonzero statuses as red, so the step summary/report is needed to distinguish expected policy block (1) from evaluator failure (2).

## 6. Invented API ledger

| Invented item | Need | Why it was needed |
| --- | --- | --- |
| `trust ci --report <path>` | **Essential** | The packet requires a machine artifact but specifies no output destination or format. |
| `--report` writes one JSON `TrustReport` atomically on normal exits 0, 1, and 2 | **Essential** | Prevents a report/exit mismatch and permits upload after block/failure. |
| Human-readable output remains on the terminal while `--report` is separate | **Essential** | Satisfies simultaneous human and machine output without mixed streams. |
| The CLI discovers the checked-in Trust config and current checkout without `contexts.put` | **Essential** | The documented command has no config/checkout input, and this workflow prohibits mutations. |
| The CLI pins one snapshot before reads and uses it for every diagnostic, action, override, and decision | **Essential** | The packet says queries are snapshot-bound but does not specify the CI orchestration. |
| On a mid-run snapshot/input/deadline change, CI recomputes as a whole or exits 2 | **Essential** | The packet forbids stale deployment tokens but gives no CLI race rule. |
| A schema-valid report is available for the simulated operation failure, with the attempted snapshot retained | **Essential** | Required for a machine artifact on exit 2; failure-report construction is unspecified. |
| A read-only CI transport principal exists and cannot invoke commands | **Essential** | Authority is present in diagnostics/commands, but query/CLI auth behavior is not defined. |
| Unknown process exits and a missing report are normalized by the wrapper to exit 2 | **Essential (wrapper)** | Makes the three-way CI result deterministic despite process-level failures. This is wrapper behavior, not claimed Trust behavior. |
| `updateTodo`, missing `completeEffects`, `S-block`, `D-block`, `S-error`, and the source-inspection failure | **Merely convenient** | Fictional identifiers/data make the two traces concrete; they are not API additions. |
| The blocking diagnostic uses severity `error` under the `ci` profile | **Merely convenient** | `action = block` is required by the scenario, but the packet does not fix its severity mapping. |
| The operation failure is represented both by an `operation.failed` condition and an `operationErrors` entry | **Essential for this simulation** | Both schema locations exist, but their exact relationship and error payload are unspecified. |
| Source-provider failure leaves durable condition occurrence history unchanged and is represented in this report view only | **Essential** | The workflow forbids state mutation, while the packet otherwise says occurrences are retained. |
| GitHub Actions, triggers, Ubuntu, pnpm commands, action versions, artifact name/path, and step-summary text | **Merely convenient** | CI-provider and package-manager choices are outside the Trust design. |
| Artifact upload failure makes the provider job non-green but does not alter the Trust exit/report | **Merely convenient** | This is the selected CI provider's orchestration rule, not a Trust policy rule. |
| A merge system will require policy re-evaluation after token expiry | **Essential consumer behavior** | The packet requires re-evaluation after the deadline but does not define merge-provider integration. |

I did not invent an MCP tool, command-side operation, observation, work transition, automatic override, fallback allow rule, or authority escalation.

## 7. Safety check

- The job calls no evidence plan/execute/submit path. A successful checkout, dependency install, CLI invocation, report upload, green workflow, agent statement, edit, PR, note, or work closure is never recorded as an observation.
- A missing premise remains `observation.missing`; the CI profile can block or an authorized exact override can permit, but neither changes evidence or applicability.
- `operation.failed` yields no observation and no decision. Mapping it to policy block would conceal an evaluator outage; mapping it to allow would be fail-open.
- An override is authority-bearing policy input, not evidence. It remains visible, is exact-scoped, and is ineffective after expiry. The job has no override-management authority.
- Upload uses the already-evaluated file and cannot fetch fresher conditions while retaining an older decision token.
- The largest unclosed safety gap is enforcement of query-only authority: the packet says commands are authorized but does not define a CI capability that mechanically prevents command calls. The workflow relies on the CLI contract plus an assumed read-only identity.

## 8. Smallest repair

Add one normative CLI I/O contract: `trust ci --profile <profile> --report <path>` pins one snapshot, performs only side-effect-free reads, never runs evidence methods, atomically writes exactly one JSON `TrustReport` for documented exits 0/1/2, and keeps human diagnostics on the terminal. This single addition removes the largest invention and makes the exit, displayed explanation, and uploaded artifact provably refer to the same evaluation.
