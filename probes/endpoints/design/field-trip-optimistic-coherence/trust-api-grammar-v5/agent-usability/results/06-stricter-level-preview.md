# Workflow 6 report — preview a stricter global level

## 1. Assumptions

The following facts are fixtures for the simulation, not facts supplied by the packet:

- The current snapshot is `S0 = { version: "41", cursor: "c-908", configRevision: "cfg-17", evaluatedAt: "2026-09-17T16:00:00Z" }`.
- The installed and candidate module is `@tanstack/db-endpoints@0.1.0`, and its lowered rule definitions are unchanged between the live and candidate bundles.
- The project has three endpoint-mutation subjects: `checkout.update`, `orders.patch`, and `invoices.cancel`.
- At Endpoints level `standard`, only the `checkout.update` claim use is active. At `strict`, claim uses for `orders.patch` and `invoices.cancel` also become active for `endpoints/safe-skip-refetch`.
- Observation `obs-checkout-44`, produced by `effectOracle`, adequately supports the `derived` route for `checkout.update`. Observation `obs-orders-12` is retained, current, and adequate for `orders.patch`, even though that use is not active at `S0`. No applicable observation exists for `invoices.cancel`.
- Neither the subjects, method version, dependencies, nor cases covered by the two observations change in the candidate, so the candidate comparison may reuse them.
- The selected policy profile is `ci`; in this fixture, an active `observation.missing` diagnostic blocks under that profile. There are no relevant overrides.
- The candidate includes the same `ci` policy as the live bundle. Only configuration changes.

## 2. Code and calls

### Candidate configuration

I would preserve the live fragments and append one named fragment so provenance can show the override rather than replacing the live configuration wholesale:

```ts
const candidateConfig = defineTrustConfig([
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
  config('preview-strict', {
    subjects: endpointsTrust.subjects.endpoints(),
    levels: { endpoints: 'strict' },
    rules: {
      'endpoints/safe-skip-refetch': {
        enabled: true,
        options: { level: 'strict' },
      },
    },
  }),
])
```

`base`, the recommended config, `endpoints`, and `preview-strict` are therefore contributing layers, in that merge order. The final level and rule option come from `preview-strict`; the earlier `standard` values remain visible as overridden provenance. No layer is excluded in this fixture.

### Discover and inspect the current state

The operation names below are in the packet. Their concrete input and result envelopes are not, so those details are explicitly inventoried in section 6.

```ts
const capabilities = await trust.query.capabilities.get()

const current = await trust.query.snapshots.get({ selector: 'current' })
// current.snapshot === S0

const liveResolution = await trust.query.config.inspect({
  snapshot: S0,
  subjects: [
    { provider: 'typescript', key: 'checkout.update' },
    { provider: 'typescript', key: 'orders.patch' },
    { provider: 'typescript', key: 'invoices.cancel' },
  ],
})

// Expected abbreviated projection:
liveResolution.layers = [
  { name: 'base', disposition: 'contributing' },
  { name: '@tanstack/db-endpoints/recommended', disposition: 'contributing' },
  { name: 'endpoints', disposition: 'contributing' },
]
liveResolution.final.levels.endpoints = 'standard'
liveResolution.final.rules['endpoints/safe-skip-refetch'].options.level = 'standard'
```

The real response should retain source spans, exact module versions, defaults, conflicts, contributing and excluded layers, and `cfg-17`; I would present that provenance to the maintainer instead of merely saying “standard became strict.”

### Construct the sealed candidate bundle

The packet requires a sealed bundle with complete module locks, definitions, configuration, and policy but gives no serialization contract. This is the minimum invented shape I would need to make the call concrete:

```ts
const candidateDraft = {
  schemaVersion: 1,
  moduleLocks: [
    {
      name: '@tanstack/db-endpoints',
      namespace: 'endpoints',
      version: '0.1.0',
      trustApi: '^0.1.0',
      definitionDigest: 'sha256:def-endpoints-010',
    },
  ],
  definitions: {
    modules: [endpointsTrust.loweredDefinition],
  },
  config: candidateConfig,
  policy: policies,
}

const candidateBundle = sealCandidateBundle(candidateDraft)
// {
//   ...candidateDraft,
//   sealed: true,
//   digest: 'sha256:candidate-strict-01'
// }
```

Before the successful comparison, I would expect two bounded failure checks to prove that preview errors do not contaminate live state.

First, a bundle whose config refers to `endpoints/strict-write-audit` while the complete definitions omit that rule:

```ts
const missingDefinition = await trust.query.policy.compare({
  snapshot: S0,
  profile: { name: 'ci' },
  candidateBundle: bundleReferringToMissingStrictWriteAudit,
})

// Expected invented error envelope:
// {
//   status: 'invalid-candidate',
//   operationErrors: [{
//     code: 'candidate.definition.missing',
//     path: '/config/rules/endpoints~1strict-write-audit',
//     definition: 'endpoints/strict-write-audit',
//     message: 'Candidate config refers to a definition absent from the sealed bundle.'
//   }],
//   snapshot: S0
// }
```

I would explain that this is a candidate construction failure, not live `definition.unadmitted`, not missing evidence, and not maintenance work. The candidate is not complete enough to compare.

Second, a complete bundle with `options: { level: 'severe' }`, which violates the shown rule option schema:

```ts
const invalidConfig = await trust.query.policy.compare({
  snapshot: S0,
  profile: { name: 'ci' },
  candidateBundle: bundleWithSevereOption,
})

// Expected invented error envelope:
// {
//   status: 'invalid-candidate',
//   operationErrors: [{
//     code: 'candidate.config.invalid',
//     path: '/config/fragments/preview-strict/rules/endpoints~1safe-skip-refetch/options/level',
//     sourceSpan: { /* preview-strict source */ },
//     expected: ['basic', 'standard', 'strict'],
//     actual: 'severe'
//   }],
//   resolution: {
//     contributingLayers: ['base', '@tanstack/db-endpoints/recommended', 'endpoints', 'preview-strict'],
//     excludedLayers: [],
//   },
//   snapshot: S0
// }
```

Again, the invalid candidate produces no live `config.invalid` occurrence. It is a read-only preview error tied to the candidate. If the product instead represents this as a hypothetical `config.invalid` diagnostic, that projection needs to be specified.

The successful comparison is:

```ts
const preview = await trust.query.policy.compare({
  snapshot: S0,
  profile: { name: 'ci' },
  candidateBundle,
})

// Abbreviated expected result:
preview.delta.newlyActiveObligations = [
  { rule: 'endpoints/safe-skip-refetch@1', subject: 'orders.patch', claimUse: 'cu-orders-strict' },
  { rule: 'endpoints/safe-skip-refetch@1', subject: 'invoices.cancel', claimUse: 'cu-invoices-strict' },
]

preview.delta.reusableEvidence = [
  {
    evidence: 'obs-checkout-44',
    claimUse: 'cu-checkout-live',
    route: 'derived',
    premises: ['sameArtifact', 'confirmedBaseline', 'completeEffects', 'noOverlap'],
  },
  {
    evidence: 'obs-orders-12',
    claimUse: 'cu-orders-strict',
    route: 'derived',
    premises: ['sameArtifact', 'confirmedBaseline', 'completeEffects', 'noOverlap'],
  },
]

preview.delta.newConditions = [
  {
    kind: 'observation.missing',
    rule: 'endpoints/safe-skip-refetch@1',
    claimUse: 'cu-invoices-strict',
    severity: 'error',
    action: 'block',
    causes: [{ premise: 'sameArtifact' }, { premise: 'confirmedBaseline' },
      { premise: 'completeEffects' }, { premise: 'noOverlap' }],
    actions: [{ kind: 'evidence.plan', expectedSnapshot: S0 }],
  },
]

preview.delta.hypotheticalWork = [
  {
    forCondition: 'candidate-condition-invoices-missing',
    actionKind: 'evidence.plan',
    subject: 'invoices.cancel',
    method: 'effectOracle',
  },
]
```

The comparison should also return the candidate-resolved config provenance and a candidate `TrustReport` using the same diagnostic schema. In the fixture, the `ci` candidate decision blocks solely because of the new `invoices.cancel` condition. The `orders.patch` obligation is newly active but already supported, so it creates no condition or work.

### MCP and CLI projections

The same comparison through the deliberately narrow MCP surface would be:

```json
{
  "tool": "trust_policy",
  "input": {
    "schemaVersion": 1,
    "operation": "compare",
    "snapshot": {
      "version": "41",
      "cursor": "c-908",
      "configRevision": "cfg-17",
      "evaluatedAt": "2026-09-17T16:00:00Z"
    },
    "profile": { "name": "ci" },
    "candidateBundle": {
      "sealed": true,
      "digest": "sha256:candidate-strict-01",
      "moduleLocks": "<complete locks>",
      "definitions": "<complete lowered definitions>",
      "config": "<all candidate fragments>",
      "policy": "<complete policies>"
    }
  }
}
```

I would expect its output to be the same versioned compare result, not an MCP-specific summary. A CLI projection, using inferred operation-aligned spelling, would be:

```sh
trust policy compare \
  --snapshot-version 41 \
  --snapshot-cursor c-908 \
  --config-revision cfg-17 \
  --profile ci \
  --candidate ./trust-candidate-strict.sealed.json \
  --format json
```

Neither call may execute `effectOracle`, claim/close work, create an override, or edit configuration. If the preview shows missing evidence, the maintainer can later choose the advertised `evidence.plan` action in a separate authorized command flow.

## 3. State trace

| Step | Conditions | Evidence | Work | Policy | Snapshot |
|---|---|---|---|---|---|
| 0. Live `standard` baseline | No active condition for `checkout.update`; strict-only uses are absent | `obs-checkout-44` and retained `obs-orders-12` exist; no invoice observation | No ready work relevant to this change | Live `ci` evaluation allows | `S0 / cfg-17` |
| 1. Inspect live config | Unchanged | Unchanged | Unchanged | Unchanged | Exactly `S0` |
| 2. Compare bundle missing a referenced definition | No live or hypothetical evidence condition; candidate validation error only | Unchanged | No hypothetical evidence work because comparison cannot be formed | No valid candidate decision | Exactly `S0` |
| 3. Compare bundle with invalid `severe` option | No live condition; candidate validation failure, with layer/source provenance | Unchanged | No hypothetical work | No valid candidate decision | Exactly `S0` |
| 4. Compare valid sealed `strict` bundle | Live conditions unchanged; preview contains one hypothetical `observation.missing` for invoices | No write; preview identifies two reusable observations | No live work; one hypothetical invoice evidence-plan item | Live decision unchanged; candidate `ci` decision blocks | Exactly `S0` |
| 5. Maintainer merely reviews or discards preview | Unchanged | Unchanged | Unchanged | Unchanged | Exactly `S0` |
| 6. Maintainer later edits and applies config through the project-owned config workflow | New active claim uses for orders and invoices become durable; invoice missing-observation occurrence and active interval become durable | Existing observations remain evidence history; adequate orders evidence is associated with the activated use; no new observation is fabricated | A ready work item becomes durable only if activation is specified to materialize ready work | A fresh live evaluation under `ci` blocks and returns a token bound to the new inputs | New `S1`, new config revision, new cursor |

Step 6 is intentionally not executed here. The packet exposes no Trust command for applying configuration. Consequently the exact commit/refresh boundary and whether ready work is automatically materialized are unknown. What is certain is that `policy.compare` itself writes none of it.

## 4. Clear parts

- The live snapshot and the sealed candidate are distinct comparison inputs.
- A candidate must carry complete locks, definitions, config, and policy; it cannot silently borrow unspecified live parts.
- Comparison is a query and therefore cannot alter conditions, evidence, work, overrides, or the current snapshot.
- The expected semantic outputs are explicit: newly active obligations, reusable evidence, new conditions, and hypothetical work.
- Configuration provenance must retain contributing and excluded layers, defaults, conflicts, source spans, exact module versions, and revision.
- Missing evidence is not equivalent to a work item, edit, or agent assertion. Planning or executing evidence is a separate command flow.
- Policy may turn the previewed condition into a block without changing evidence or applicability.
- A failed, unreachable, invalid, cancelled, or cleanup-failed run could not add an observation even after the candidate is applied.

## 5. Friction

The most consequential gap is that “sealed candidate bundle” is a required input with no public type, canonical serialization, sealing/digest procedure, builder, or validation result schema. A caller cannot know how to include executable TypeScript definitions in a wire-safe MCP or CLI artifact, whether the bundle contains lowered definitions or source references, or what exactly makes it sealed.

Related friction:

- `policy.compare(input)` has no shown input or output types. It is unclear whether `profile` is inside the candidate policy, supplied separately, or both.
- There is no stated projection for candidate errors. A missing definition or invalid config might be an `OperationError`, a hypothetical `TrustDiagnostic`, a rejected receipt (even though this is a query), or a thrown transport error.
- `config.inspect` clearly explains live resolution, but the packet does not state whether it accepts a candidate bundle or whether compare embeds the candidate-resolution provenance.
- “Reusable evidence” lacks an explained record shape. The caller needs to know the target claim use, route/premises, method/definition versions, dependency checks, and any limits on reuse.
- “Hypothetical work” is promised, but the point at which work becomes durable is unspecified. Configuration activation might automatically materialize it or merely make it discoverable through `work.ready`.
- The packet does not expose a Trust-side config-application operation, so the exact transition from a reviewed bundle to a new durable config revision belongs to an unstated project/source-provider workflow.
- Opaque refs are correct for durable objects, but candidate-only refs need a stable representation if the result is to connect a hypothetical condition, work item, and later durable object.
- CLI operation naming and flags are not given, despite the assurance that CLI commands use service operation names.

## 6. Invented API ledger

No invented item below is claimed as part of the proposal.

| Invented item | Kind | Need |
|---|---|---|
| `snapshots.get({ selector: 'current' })` input and a `{ snapshot }` result | Input/result fields | **Essential** to acquire the compare token concretely; only the operation name is given. |
| `config.inspect({ snapshot, subjects })` and its `layers`, `disposition`, and `final` fields | Input/result fields | **Essential** to show per-subject contributing layers; only the required provenance concepts are stated. |
| `{ provider: 'typescript', key }` subject selectors | Type/fields | Convenient; any wire-safe subject selector would work. |
| `CandidateBundleV1` draft layout with `schemaVersion`, `moduleLocks`, `definitions.modules`, `config`, and `policy` | Type/fields | **Essential** to make the required sealed bundle concrete. The four conceptual contents are stated, but their shape is not. |
| Module-lock fields `name`, `namespace`, `version`, `trustApi`, and `definitionDigest` | Fields | **Essential** for a complete/version-bound example; exact lock fields are unspecified. |
| `endpointsTrust.loweredDefinition` as a serializable definition export | Field/export behavior | **Essential** for transporting “complete definitions”; no export or serialization mechanism is supplied. |
| `sealCandidateBundle`, `sealed: true`, `digest`, SHA-256 spelling, and deterministic local sealing | Operation/type/algorithm | **Essential** because compare requires a sealed candidate; the sealing operation and digest contract are absent. |
| `policy.compare({ snapshot, profile, candidateBundle })` exact input shape | Input fields | **Essential**; the operation and conceptual inputs are stated, not their wire shape. |
| Compare result `status`, `delta`, `newlyActiveObligations`, `reusableEvidence`, `newConditions`, and `hypotheticalWork` envelopes | Result type/fields | **Essential** to consume the four promised outputs; their schemas are absent. |
| Compare embedding candidate config `resolution` and a candidate `TrustReport` | Result fields | **Essential** to explain candidate layers and use the common report schema without another unstated query. |
| String renderings such as `cu-orders-strict`, `obs-orders-12`, and `endpoints/safe-skip-refetch@1` | Ref encoding | Convenient fixture labels; real opaque refs are unspecified. |
| Reuse entries containing `route` and `premises` | Result fields | **Essential** to explain why evidence is reusable rather than merely name it. |
| Hypothetical-work fields `forCondition`, `actionKind`, `subject`, and `method` | Result fields | **Essential** for an actionable maintenance account; its schema is absent. |
| Candidate validation statuses and codes `invalid-candidate`, `candidate.definition.missing`, and `candidate.config.invalid` | Error rules/codes | **Essential** to distinguish construction/config failures from live Trust conditions. |
| JSON-pointer-like `path`, plus `definition`, `expected`, `actual`, and candidate `sourceSpan` error fields | Error fields | Convenient but high-value diagnostics; exact error schema is absent. |
| Rule: any missing referenced definition invalidates the comparison atomically | Error rule | **Essential** interpretation of the requirement that definitions be complete; explicit rejection behavior is not stated. |
| Rule: a schema-invalid candidate yields no candidate decision and no hypothetical work | Error/state rule | **Essential** safety interpretation; the packet states invalid config conditions exist but not compare behavior. |
| Rule: candidate validation failures are operation errors rather than hypothetical `config.invalid`/`definition.unadmitted` diagnostics | Projection rule | **Essential** for this report, but genuinely ambiguous. |
| Candidate-only condition ref `candidate-condition-invoices-missing` | Type/ref behavior | **Essential** to correlate hypothetical work with a hypothetical condition; the namespace/lifetime of preview refs is unspecified. |
| `trust_policy` input discriminator `operation: 'compare'` and the exact JSON envelope | MCP fields | **Essential** to call the five-tool MCP surface; each tool is said to be versioned but its schema is not shown. |
| CLI spelling `trust policy compare` and flags `--snapshot-version`, `--snapshot-cursor`, `--config-revision`, `--profile`, `--candidate`, and `--format` | CLI operation/fields | **Essential** for a concrete CLI call; no syntax is supplied. |
| Local file `trust-candidate-strict.sealed.json` | Transport convention | Convenient; the CLI could accept stdin or another artifact mechanism. |
| Read-only compare requires no mutating capability and confers no evidence, override, config-edit, or deployment authority | Authority behavior | **Essential** safety assumption beyond the stated side-effect-free query property; authentication requirements for queries are not given. |
| Candidate profile `ci` is separately selected even though complete policy is bundled | Default/ownership behavior | **Essential** to get one candidate decision, but profile selection ownership is unspecified. No default profile is assumed. |
| Applying config creates `S1` and atomically activates new claim uses and their initial condition intervals | State transition | **Essential** to explain later durability; activation is stated, exact transaction boundary is not. |
| Existing adequate evidence becomes associated with a newly activated use without copying or rewriting the observation | State transition | **Essential** interpretation of evidence reuse; exact linkage behavior is absent. |
| Configuration activation materializes a durable ready-work item | State transition | Merely convenient and uncertain; the table explicitly conditions this on product behavior. |
| A repo/source-provider edit is the application mechanism | Ownership/operation | **Essential** only to narrate the later transition because no config-apply command is supplied; the actual owner is unspecified. |
| All fixture subjects, snapshots, revisions, evidence refs/results, claim-use refs, definition digests, source spans, profile outcome, and absence of overrides | Data | Convenient simulation fixtures listed in assumptions; none is proposed API. |

I relied on no unstated defaults: profile, snapshot, module version, candidate config, and output format are all explicit in the simulated calls.

## 7. Safety check

- `policy.compare` is kept strictly read-only. Its candidate diagnostics and work are labeled hypothetical and never inserted into `conditions.active`, `conditions.history`, or `work.ready`.
- The config text, successful bundle validation, and a maintainer accepting the preview do not satisfy any premise.
- `obs-orders-12` is reused only because the fixture says the method, covered cases, dependencies, applicability, and adequacy still match. Mere identifier equality or prior agent approval would be insufficient.
- The invoice work item, any note on it, a claimed lease, an applied config edit, a PR, and an agent statement that the endpoint is safe cannot become evidence.
- Candidate policy action `block` neither creates evidence nor changes applicability. Conversely, an override could permit deployment only through its explicit authority, scope, rationale, expiry, and decision-token path; it would not hide the missing-observation condition.
- No evidence method runs implicitly during compare or CLI preview. A later run must be planned and then executed/submitted through authorized, idempotent, version-bound commands. An invalid or failed result adds no observation.
- The invented local sealer must not be treated as admission authority. A syntactically complete definition can still be unadmitted; the packet does not specify how candidate admission status is represented, so a real compare schema must preserve that distinction.
- A candidate decision token, if compare returns one, must not be deployable as though it were the current live decision. The token needs an unmistakable candidate scope; that behavior is not stated and is therefore a safety-sensitive gap.

## 8. Smallest repair

Publish one canonical, versioned `PolicyCompareInputV1` / `PolicyCompareResultV1` contract together with the exported `CandidateBundleV1` schema and a deterministic pure `sealCandidateBundle` helper. The contract should specify serializable lowered definitions, complete lock validation, profile selection, candidate config provenance, the four delta collections, candidate-only refs, and typed invalid-bundle/config errors. This single addition would make the TypeScript, MCP, and CLI workflows recoverable while preserving the existing read-only comparison model.
