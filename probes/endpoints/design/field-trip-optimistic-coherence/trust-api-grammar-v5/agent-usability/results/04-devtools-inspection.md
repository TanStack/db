# Workflow 4 report — Devtools live inspection

## 1. Assumptions

- The browser receives an authenticated, read-capable `trust` TypeScript client from the Devtools host. The screen issues no commands.
- For the simulation, the selected scope is the Endpoints module and the selected policy profile is `ci`; neither is treated as an API default.
- The sample live state contains two active conditions, one inactive historical occurrence, an expired observation, one ready work item, one admitted rule definition, and one active override. These records are fixtures for the state trace, not additional product claims.
- Durable refs can be used as map keys after stable wire serialization. Whether ref strings are directly comparable is not specified.
- Query input/output shapes, paging, cursor-expiry errors, and admission reads are absent from the packet. The minimum contracts invented to make the sketch executable are all called out in section 6.

## 2. Code and calls

The UI has one immutable, snapshot-coherent frame. It never mutates that frame with a change record. `changes.since` is an incremental invalidation feed: when it names a later snapshot, the controller builds a complete frame at that snapshot off-screen and swaps it into React atomically.

```ts
// Types present in the packet are imported unchanged.
import type {
  ActionDescriptor,
  ConditionRef,
  DecisionToken,
  EvidenceRef,
  OverrideRef,
  PolicyProfileRef,
  ResolvedConfigRef,
  RuleRef,
  SnapshotToken,
  TrustDiagnostic,
  TrustReport,
  WorkRef,
} from '@tanstack/trust'

type Scope = { module: '@tanstack/db-endpoints'; namespace: 'endpoints' }

// Everything below marked `packet-omitted` is an invented service read shape.
type SnapshotBound<T> = { snapshot: SnapshotToken; value: T } // packet-omitted

interface HistoryRecord { // packet-omitted
  condition: ConditionRef
  occurrences: Array<{
    diagnostic: TrustDiagnostic
    firstSeenAt: string
    lastSeenAt: string
    activeIntervals: Array<{ openedAt: string; closedAt: string | null }>
  }>
}

interface ExplanationRead { // packet-omitted
  condition: TrustDiagnostic
  claim: { ref: string; statement: string }
  premises: Array<{ id: string; supported: boolean; evidence: EvidenceRef[] }>
  routes: Array<{
    id: string
    premiseIds: string[]
    satisfied: boolean
    evidence: EvidenceRef[]
    limits: TrustDiagnostic['limits']
  }>
  evidenceRefs: EvidenceRef[]
  workRefs: WorkRef[]
  admissionRefs: string[]
}

interface EvidenceRead { // packet-omitted
  ref: EvidenceRef
  method: string
  outcome: 'applicable' | 'inapplicable' | 'inconclusive' | 'expired'
  supports: string[]
  observedAt: string
  dependencies: string[]
  limits: TrustDiagnostic['limits']
}

interface WorkRead { // packet-omitted
  ref: WorkRef
  condition: ConditionRef
  state: 'ready' | 'claimed' | 'closed'
  action: ActionDescriptor
}

interface AdmissionRead { // packet-omitted; no admission query is listed
  ref: string
  rule: RuleRef
  definitionVersion: string
  status: 'pending' | 'admitted' | 'rejected'
  decidedAt: string | null
}

interface ConfigInspection { // packet-omitted
  resolved: ResolvedConfigRef
  revision: string
  contributingLayers: Array<{ name: string; sourceSpans: unknown[] }>
  excludedLayers: Array<{ name: string; reason: string }>
  conflicts: unknown[]
  moduleVersions: Record<string, string>
}

interface PolicyRead { // packet-omitted
  profile: PolicyProfileRef
  decision: DecisionToken | null
  action: 'allow' | 'note' | 'warn' | 'block' | null
  evaluatedAt: string
  validityDeadline: string | null
}

interface OverrideRead { // packet-omitted
  ref: OverrideRef
  condition: ConditionRef
  profile: PolicyProfileRef
  action: 'allow' | 'note' | 'warn' | 'block'
  state: 'active' | 'expired' | 'unused' | 'shadowed' | 'ambiguous'
  rationale: string
  expiresAt: string
}

interface DevtoolsFrame {
  snapshot: SnapshotToken
  report: TrustReport
  history: HistoryRecord[]
  readyWork: WorkRead[]
  admissions: AdmissionRead[]
  config: ConfigInspection
  policy: PolicyRead
  overrides: OverrideRead[]
}

const scope: Scope = {
  module: '@tanstack/db-endpoints',
  namespace: 'endpoints',
}

const sameSnapshot = (a: SnapshotToken, b: SnapshotToken) =>
  a.version === b.version &&
  a.cursor === b.cursor &&
  a.configRevision === b.configRevision &&
  a.evaluatedAt === b.evaluatedAt

function assertBound(
  expected: SnapshotToken,
  reads: Array<SnapshotBound<unknown>>,
): void {
  for (const read of reads) {
    if (!sameSnapshot(expected, read.snapshot)) {
      throw new Error('snapshot.mismatch') // local UI error, not a Trust error
    }
  }
}

async function loadFrame(at?: SnapshotToken): Promise<DevtoolsFrame> {
  // Invented input fields are explicit: scope, profile, and optional snapshot.
  const report: TrustReport = await trust.query.conditions.active({
    scope,
    profile: { name: 'ci' },
    snapshot: at,
  })
  const snapshot = report.snapshot

  const [history, readyWork, admissions, config, policy, overrides] =
    await Promise.all([
      trust.query.conditions.history({ scope, snapshot }),
      trust.query.work.ready({ scope, snapshot }),
      // Essential invented operation; the packet lists no admission read.
      trust.query.admissions.list({ scope, snapshot }),
      trust.query.config.inspect({ scope, snapshot }),
      trust.query.policy.evaluate({ profile: { name: 'ci' }, snapshot }),
      trust.query.overrides.list({
        profile: { name: 'ci' },
        states: ['active', 'expired', 'unused', 'shadowed', 'ambiguous'],
        snapshot,
      }),
    ]) as [
      SnapshotBound<HistoryRecord[]>,
      SnapshotBound<WorkRead[]>,
      SnapshotBound<AdmissionRead[]>,
      SnapshotBound<ConfigInspection>,
      SnapshotBound<PolicyRead>,
      SnapshotBound<OverrideRead[]>,
    ]

  assertBound(snapshot, [history, readyWork, admissions, config, policy, overrides])
  return {
    snapshot,
    report,
    history: history.value,
    readyWork: readyWork.value,
    admissions: admissions.value,
    config: config.value,
    policy: policy.value,
    overrides: overrides.value,
  }
}
```

The controller uses `useSyncExternalStore` so every component observes the same frame. A detail request captures the current token; all joins use that token, and the result is discarded if the store has advanced before it completes.

```tsx
type StoreState =
  | { status: 'loading' }
  | { status: 'ready'; frame: DevtoolsFrame }
  | { status: 'error'; message: string }

const frameStore = createExternalStore<StoreState>({ status: 'loading' })

async function initialLoad() {
  // No snapshot argument means "current" only in this invented input contract.
  frameStore.set({ status: 'ready', frame: await loadFrame() })
}

async function followChanges(signal: AbortSignal) {
  while (!signal.aborted) {
    const state = frameStore.get()
    if (state.status !== 'ready') return

    try {
      const page = await trust.query.changes.since({
        cursor: state.frame.snapshot.cursor,
        limit: 100,
      }) as {
        toSnapshot: SnapshotToken
        nextCursor: string
        touched: Array<{ kind: string; ref: string }>
      }

      // `touched` can drive loading indicators, but is never patched into S(n).
      const next = await loadFrame(page.toSnapshot)
      frameStore.set({ status: 'ready', frame: next })
    } catch (error) {
      if (isOperationError(error, 'cursor.expired')) {
        // Full current-snapshot reload. No S(n) record survives into this frame.
        frameStore.set({ status: 'ready', frame: await loadFrame() })
        continue
      }
      throw error
    }
  }
}

async function loadConditionDetail(
  condition: ConditionRef,
  snapshot: SnapshotToken,
) {
  const [explanation, history] = await Promise.all([
    trust.query.conditions.explain({ condition, snapshot }),
    trust.query.conditions.history({ condition, snapshot }),
  ]) as [SnapshotBound<ExplanationRead>, SnapshotBound<HistoryRecord>,]
  assertBound(snapshot, [explanation, history])

  const [evidence, work] = await Promise.all([
    Promise.all(explanation.value.evidenceRefs.map(ref =>
      trust.query.evidence.get({ evidence: ref, snapshot })
    )),
    Promise.all(explanation.value.workRefs.map(ref =>
      trust.query.work.get({ work: ref, snapshot })
    )),
  ]) as [Array<SnapshotBound<EvidenceRead>>, Array<SnapshotBound<WorkRead>>]
  assertBound(snapshot, [...evidence, ...work])

  const now = frameStore.get()
  if (now.status !== 'ready' || !sameSnapshot(now.frame.snapshot, snapshot)) {
    return null
  }
  return {
    snapshot,
    explanation: explanation.value,
    history: history.value,
    evidence: evidence.map(x => x.value),
    work: work.map(x => x.value),
  }
}

function TrustDevtools() {
  const state = useSyncExternalStore(
    frameStore.subscribe,
    frameStore.get,
    frameStore.get,
  )
  const [selected, setSelected] = useState<ConditionRef | null>(null)
  if (state.status !== 'ready') return <LoadingOrError state={state} />
  const { frame } = state

  return <main data-snapshot={frame.snapshot.version}>
    <SnapshotBadge token={frame.snapshot} />
    <ConditionList
      title="Active conditions"
      rows={frame.report.conditions}
      overrides={frame.overrides}
      onSelect={setSelected}
    />
    <HistoryList title="Retained history" rows={frame.history} onSelect={setSelected} />
    <WorkPanel rows={frame.readyWork} />
    <AdmissionPanel rows={frame.admissions} />
    <ConfigPanel inspection={frame.config} />
    <PolicyPanel policy={frame.policy} />
    <OverridePanel rows={frame.overrides} />
    {selected && <ConditionDetail
      key={`${frame.snapshot.version}:${stableRef(selected)}`}
      condition={selected}
      snapshot={frame.snapshot}
      load={loadConditionDetail}
    />}
  </main>
}
```

`ConditionDetail` renders the claim statement; each alternate support route and its joint premises; supporting evidence, dependencies, and limits; linked work; linked admission; the diagnostic's action and severity; and every active interval. If a selected active condition becomes inactive, the snapshot-keyed detail is destroyed. The same ref is then resolved from `conditions.history` at the new snapshot. If the new history cannot resolve it, the UI says that the selection is unavailable at this snapshot rather than retaining stale detail.

An overridden condition is still rendered in `Active conditions`. `ConditionList` adds an “override active” badge by joining the exact condition ref, profile ref, and action against `frame.overrides`; it does not filter the diagnostic. Inactive occurrences appear only in `Retained history`, including expired evidence and closed active intervals.

## 3. State trace

The identifiers below are illustrative fixture refs.

| Step | Snapshot/cursor | Conditions and history | Evidence and work | Admission/config | Policy and overrides | UI behavior |
|---|---|---|---|---|---|---|
| 0. Open | none | Unknown | Unknown | Unknown | Unknown | Loading shell only; no partial panels. |
| 1. Root read | `S41` / `c41`, config revision `R9` | Active `C1: observation.missing` for claim use `U1`; active `C2: challenge.open` for `U2`. History is not yet published. | Not yet published. | Not yet published. | `TrustReport.conditions` already gives per-condition CI actions. | `conditions.active` supplies the anchor token, but the frame remains hidden. |
| 2. Hydrate `S41` | every read echoes `S41/c41/R9` | History contains inactive `C0: observation.expired` and its closed interval. | Expired `E17` is linked to `C1`; derived and certificate routes are unsatisfied. `W9` is ready for `gatherEvidence`. | `A4` says the rule definition is admitted. Resolved Endpoints config enables the rule at `standard`; contributing/excluded layers and module version are shown. | CI blocks `C1`. CI would block `C2`, but active override `O3` changes its policy action to allow. Expired override `O2` remains listed. `C2` remains visible. | One atomic publish shows all panels at `S41`. |
| 3. Drill into `C1` | still `S41/c41` | Explanation shows claim `U1`, the `derived` four-premise route, the alternate `certificate` route, causes, locations, and intervals. | `evidence.get(E17)` shows its dependency and limit; `work.get(W9)` shows ready work. Neither query writes. | The linked admission is joined from the `S41` frame. | Severity/action are copied from the diagnostic, not recomputed in React. | If any result is not bound to `S41`, the entire detail result is rejected. |
| 4. Incremental notice | feed from `c41` returns `toSnapshot: S42`, `nextCursor: c42` | The change is expected to close `C1`'s active interval after a valid new observation. `C2` remains active. | New adequate effect-oracle observation `E19` supports all four derived premises. The UI does not infer whether `W9` is still in `work.ready`; it accepts the `S42` response. The work record is not treated as evidence. | `A4` and `R9` are unchanged. | With `C1` inactive and `O3` still allowing `C2`, the `S42` CI decision allows. | The feed is only an invalidation signal. `S41` stays visible while all `S42` reads run. |
| 5. Atomic update | `S42/c42/R9` | Active list contains only `C2`. History now contains `C1` with a closed interval as well as `C0`. | `E19` is visible on `C1`'s historical drill-down, with coverage and limits. Work state is exactly what `work.ready/get` returned. | Still bound to `S42`. | `C2` and `O3` are both visible; the condition was not hidden by policy. | The store swaps once. A previously selected `C1` is reloaded from `S42` history; no `S41` detail is retained. |
| 6. Cursor expired | request from `c42` returns invented `cursor.expired` | No live Trust state changes merely because the read failed. | No evidence or work is created. | No changes inferred. | No policy change inferred. | Discard any in-progress candidate frame and perform a full current load. |
| 7. Resync | current root read returns `S51/c51/R11`; all dependent reads echo it | `C2` remains active; `C1` and `C0` remain in retained history. Any intervening occurrences come from the `S51` history response. | Evidence/work are rebuilt from `S51`, never replayed from skipped deltas. | Admission and resolved config are rebuilt at `S51/R11`. | Active, expired, unused, shadowed, and ambiguous overrides are rebuilt; `C2` is still shown even if overridden. | Atomically replace the complete frame and resume from `c51`. |

The transition in step 4 from adequate evidence to an inactive missing-evidence condition is the expected rule evaluation for this fixture. The packet does not define change-event payloads, whether work readiness changes automatically, or the exact condition-occurrence close semantics; the UI therefore never derives those records from the event.

## 4. Clear parts

- `SnapshotToken` provides the four values a coherent view can display and carry between reads.
- `TrustReport` is a natural root model: it binds configuration, profile, decision, diagnostics, overrides, errors, and deprecations to one snapshot.
- Active and retained condition history are deliberately separate reads, which maps cleanly to two panes.
- A diagnostic already carries locations, causes, affected uses, limits, authority, policy action, actions, and snapshot, so the active list needs little interpretation.
- `conditions.explain`, `evidence.get`, `work.ready/get`, `config.inspect`, `policy.evaluate`, and `overrides.list` identify the intended drill-down sources.
- The separation of queries from commands makes a read-only Devtools safe by construction at the top level.
- Override behavior is unambiguous: it affects the policy result and never hides the condition.
- Retained occurrence history and separate active intervals directly support showing inactive conditions without pretending they are currently active.

## 5. Friction

- The largest concrete gap is admission: Devtools is required to render admission records, and there is an `admissions.decide` command, but there is no `query.admissions.list` or `query.admissions.get`.
- None of the listed query input or output schemas are included. In particular, the packet does not say how a caller requests an exact snapshot or whether every response echoes the full token. “Snapshot-bound” is the right invariant, but it is not yet a usable TypeScript contract.
- `changes.since` has no described result, pagination, long-poll behavior, cursor lifetime, or expiry error. Applying deltas would therefore be unsafe. The conservative design must use it only to trigger a complete next-snapshot read.
- `conditions.explain` does not expose a stated join shape for claim, premises, routes, evidence refs, work refs, or admission refs. The prose promises those concepts, but the component cannot be typed from the packet.
- Evidence, work, config-inspection, policy-evaluation, override-list, and history record shapes are omitted. Even elementary presentation fields such as evidence outcome, work state, contributing config layer, or override status have to be guessed.
- `Cause`, `Limit`, ref wire representations, `OperationError`, `DecisionToken`, and several referenced record types are not expanded. That makes exhaustive rendering, stable React keys, and reliable error discrimination uncertain.
- Override expiry is derived at policy evaluation time, but the packet does not say how a read-only Devtools learns that a validity deadline passed when the snapshot cursor does not advance. A cursor-only follower might keep showing a stale action.
- It is not specified whether `conditions.active` returns a `TrustReport` directly, whether `report.conditions` is filtered to active conditions for that query, or how paging preserves a single report snapshot.

## 6. Invented API ledger

Local React choices such as `useSyncExternalStore`, atomic replacement, component names, and hiding an incomplete candidate frame are UI implementation details. The following are the service contracts or domain behavior the sketch had to invent.

| Kind | Invented item | Need |
|---|---|---|
| Operation | `trust.query.admissions.list` | **Essential**: there is otherwise no way to render the required admission records. |
| Existing-operation input | `conditions.active({ scope, profile, snapshot? })`; omitted `snapshot` means current. | **Essential** for anchoring initial/resync reads; the default is invented. |
| Existing-operation input | `conditions.history({ scope?, condition?, snapshot })`. | **Essential** for snapshot-bound global history and one-condition drill-down. |
| Existing-operation input | `conditions.explain({ condition, snapshot })`. | **Essential** for coherent drill-down. |
| Existing-operation input | `work.ready({ scope, snapshot })` and `work.get({ work, snapshot })`. | **Essential** for coherent work panels. |
| Existing-operation input | `evidence.get({ evidence, snapshot })`. | **Essential** for coherent evidence detail. |
| Existing-operation input | `config.inspect({ scope, snapshot })`. | **Essential** for coherent resolved-config detail. |
| Existing-operation input | `policy.evaluate({ profile, snapshot })`. | **Essential** for coherent policy action. |
| Existing-operation input | `overrides.list({ profile, states, snapshot })`. | **Essential** to show every promised override class at the same snapshot. |
| Existing-operation input | `changes.since({ cursor, limit })`, with invented `limit: 100`. | Cursor is **essential**; the numeric limit and value are merely **convenient**. |
| Common output type | `SnapshotBound<T> { snapshot, value }` for every dependent read. | **Essential** to detect mixed-snapshot responses. |
| Root output rule | `conditions.active` returns `TrustReport`, with `conditions` containing active diagnostics for the requested scope/profile. | **Essential**; only the shared report schema, not this operation's output mapping, is stated. |
| Snapshot rule | Exact binding means equality of `version`, `cursor`, `configRevision`, and `evaluatedAt`; exact tokens may be passed back as query inputs. | **Essential** for the coherence check, but the comparison/pass-back rule is not specified. |
| Change output type | `{ toSnapshot, nextCursor, touched[] }`; `touched` items have `{ kind, ref }`. | `toSnapshot` is **essential**. `nextCursor` is **essential** if it can differ from the token cursor. `touched` is merely **convenient** and is not trusted as state. |
| Change error | `OperationError.code === 'cursor.expired'` is the resync signal. | **Essential** for deterministic recovery; the code and error access are invented. |
| Cursor state transition | An expired cursor causes no domain write; client performs a current root read, full same-snapshot hydration, atomic swap, then follows the new cursor. | **Essential** client recovery behavior; server expiry semantics are not given. |
| Explanation type | `condition`, `claim { ref, statement }`, `premises[]`, `routes[] { id, premiseIds, satisfied, evidence, limits }`, plus `evidenceRefs`, `workRefs`, and `admissionRefs`. | **Essential** to render and join the requested condition, claim, alternate routes, evidence, work, and admission. Every listed field is invented. |
| History type | `condition`, `occurrences[] { diagnostic, firstSeenAt, lastSeenAt, activeIntervals[] { openedAt, closedAt } }`; `closedAt: null` means active. | **Essential** to render retained occurrences and intervals. Field names and the null convention are invented. |
| Evidence type | `ref`, `method`, `outcome`, `supports`, `observedAt`, `dependencies`, `limits`; invented outcome values are `applicable`, `inapplicable`, `inconclusive`, and `expired`. | **Essential** for the requested evidence/limit display; exact schema and enum are invented. |
| Work type | `ref`, `condition`, `state`, `action`; invented states are `ready`, `claimed`, and `closed`. | **Essential** for the requested work display; exact schema and enum are invented. |
| Admission type | `ref`, `rule`, `definitionVersion`, `status`, `decidedAt`; invented statuses are `pending`, `admitted`, and `rejected`. | **Essential** for the admission panel; the entire read model is invented. |
| Config-inspection type | `resolved`, `revision`, `contributingLayers { name, sourceSpans }`, `excludedLayers { name, reason }`, `conflicts`, and `moduleVersions`. | **Essential** to present the resolution details promised in prose; field names/shapes are invented. |
| Policy-evaluation type | `profile`, `decision`, `action`, `evaluatedAt`, `validityDeadline`; `action` is nullable when no valid decision exists. | **Essential** to present the current action and expiry; the nullable rule and fields are invented beyond the prose-level token binding. |
| Override-list type | `ref`, `condition`, `profile`, `action`, `state`, `rationale`, `expiresAt`; invented states exactly mirror the five prose categories. | **Essential** to render and join overrides; fields and enum are invented. |
| Ref behavior | Refs have a stable wire serialization usable for React keys and equality joins across snapshots. | **Essential** for selection continuity; opaque/wire-safe does not itself define equality or serialization APIs. |
| Read authority | The host supplies a read-capable authenticated session; queries do not prompt for command capabilities. | **Essential** operational assumption. Query authentication behavior is absent; commands alone are described as receiving an actor session from transport. |
| Fixture transition | A new adequate `effectOracle` observation satisfying the four derived premises makes fixture condition `C1: observation.missing` inactive in the next evaluated snapshot. | **Essential** for the simulated update; broadly implied by the rule, but exact reevaluation/interval behavior is not specified. |
| Work transition rule | The client does not infer a work transition when evidence changes; it trusts the next `work.ready/get` response. | **Essential** safety choice because automatic work behavior is unspecified. |
| Detail invalidation rule | A detail response whose full snapshot token differs from the currently published frame is discarded, and selection is re-resolved from history at the new snapshot. | **Essential** client state transition to avoid mixed records. |
| Local errors | `snapshot.mismatch` is a local UI error and blocks publication of the candidate frame. | **Essential** client guard, not a claimed Trust `OperationError`. |

No invented command, mutation, automatic evidence run, authority grant, or evidence-producing transition is used.

## 7. Safety check

- The screen calls queries only. It does not invoke `work.note`, `work.close`, admission decisions, override commands, run commands, proposals, or context writes.
- Work state is displayed beside evidence but never included in route satisfaction. A ready, claimed, noted, or closed work item cannot make a premise supported.
- An active override changes the displayed policy action but leaves the condition in the active list and labels the override separately. It cannot change evidence, applicability, claim support, or history.
- Admission is displayed as definition authority state, not as proof of any premise. Likewise, resolved config activates obligations but does not satisfy them.
- Agent text, an applied edit, a successful delivery, and an explanation are never mapped into `EvidenceRead`. Only evidence returned by `evidence.get` participates in the evidence panel.
- A diagnostic's `actions` are presented as descriptors. The Devtools does not execute them as automatic fixes, and a disabled or capability-requiring descriptor is not treated as permission.
- The UI copies policy action/severity from the snapshot-bound service results. It does not reinterpret severity as evidence or create a decision when `decision` is null.
- Snapshot mismatch, cursor expiry, or a failed dependent query prevents publication of the candidate frame. Stale records are not merged into a newer frame.
- If mutation controls are later added, the packet requires authenticated actor sessions, idempotency keys, expected versions, run tickets for external evidence, fenced work leases, and discriminated receipts. This read-only sketch deliberately does not invent shortcuts around those requirements.

## 8. Smallest repair

Add one versioned, snapshot-bound `trust.query.admissions.list({ scope, snapshot })` operation and its read model. It should echo the exact `SnapshotToken` and return admission refs, rule/definition refs and versions, status, authority/decision metadata, and relevant timestamps. That is the smallest change that makes every record the packet explicitly requires Devtools to render actually reachable; the rest of the screen is awkward without published query schemas, but admission is currently impossible rather than merely underspecified.
