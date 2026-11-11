/**
 * The checks of the per-collection coordinator oracle in
 * per-collection-coordinator-oracle.test.ts: subset wire and acknowledgement
 * checks, the remote lease takeover model and checks, the raw SQLite-state and
 * fresh-registry checks, the collection-route checks, and the write-owner
 * check. Owns nothing and registers no tests: the oracle drives production and
 * applies them, and per-collection-coordinator-calibration.test.ts calibrates
 * them against hand-built wrong answers.
 */
import {
  semanticValue,
  subsetSemantics,
} from './per-collection-coordinator-support'
import type { TransportedLoadSubsetOptions } from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions } from '@tanstack/db'
import type {
  CollectionName,
  SemanticValue,
} from './per-collection-coordinator-support'

export type SubsetAckTrace = {
  ownerInvocation: `coordinator` | `fixture-fallback`
  decoded: SemanticValue | undefined
  expected: SemanticValue
  prematureResponses: number
  acknowledgedBeforeResponseDelivery: boolean
  ownerCompletedBeforeResponse: boolean
  acknowledgedAfterResponseDelivery: boolean
}

export type SubsetWireTrace = {
  outcome: { ok: true } | { ok: false; errorName: string } | undefined
  decoded: ReadonlyArray<SemanticValue>
  expected: SemanticValue
}

// Clone-safe projection may remove live ownership callbacks. It must preserve
// every supported request-data value that determines subset semantics.
export function subsetWireViolations(trace: SubsetWireTrace): Array<string> {
  const violations: Array<string> = []
  if (trace.outcome?.ok !== true) violations.push(`subset-transport-failed`)
  if (
    trace.decoded.length !== 1 ||
    JSON.stringify(trace.decoded[0]) !== JSON.stringify(trace.expected)
  ) {
    violations.push(`subset-semantics-mismatch`)
  }
  return violations
}

// A follower acknowledgement is valid only after the registered leader owner
// has accepted and completed the exact remote subset acquisition attempt.
export function subsetAckViolations(trace: SubsetAckTrace): Array<string> {
  const violations: Array<string> = []
  if (trace.ownerInvocation !== `coordinator`) {
    violations.push(`leader-owner-not-invoked-by-coordinator`)
  }
  if (JSON.stringify(trace.decoded) !== JSON.stringify(trace.expected)) {
    violations.push(`decoded-subset-mismatch`)
  }
  if (trace.prematureResponses !== 0) {
    violations.push(`response-before-owner-completion`)
  }
  if (trace.acknowledgedBeforeResponseDelivery) {
    violations.push(`ack-before-response-delivery`)
  }
  if (!trace.ownerCompletedBeforeResponse) {
    violations.push(`response-before-owner-completion-checkpoint`)
  }
  if (!trace.acknowledgedAfterResponseDelivery) {
    violations.push(`missing-ack-after-response`)
  }
  return violations
}

export type RemoteLeaseEvent = {
  phase: `load` | `unload`
  token: number
  semantics: SemanticValue
  exactLoadedObject?: boolean
}

export class RemoteLeaseOwnerLedger {
  private nextToken = 0
  private readonly tokens = new WeakMap<object, number>()
  private readonly loaded = new WeakSet<object>()
  readonly active = new Set<object>()
  readonly events: Array<RemoteLeaseEvent> = []

  private token(options: TransportedLoadSubsetOptions): number {
    let token = this.tokens.get(options)
    if (token === undefined) {
      token = ++this.nextToken
      this.tokens.set(options, token)
    }
    return token
  }

  readonly loadSubset = async (
    options: TransportedLoadSubsetOptions,
  ): Promise<void> => {
    const token = this.token(options)
    this.loaded.add(options)
    this.active.add(options)
    this.events.push({
      phase: `load`,
      token,
      semantics: subsetSemantics(options as unknown as LoadSubsetOptions),
    })
  }

  readonly unloadSubset = (options: TransportedLoadSubsetOptions): void => {
    const token = this.token(options)
    const exactLoadedObject = this.loaded.has(options)
    this.active.delete(options)
    this.events.push({
      phase: `unload`,
      token,
      semantics: subsetSemantics(options as unknown as LoadSubsetOptions),
      exactLoadedObject,
    })
  }

  /** Callable for today's owner boundary; properties are the crash-only owner. */
  readonly boundary = Object.assign(
    (options: TransportedLoadSubsetOptions) => this.loadSubset(options),
    {
      loadSubset: this.loadSubset,
      unloadSubset: this.unloadSubset,
      onError: () => {},
    },
  )

  snapshot() {
    return {
      loads: this.events.filter(({ phase }) => phase === `load`).length,
      unloads: this.events.filter(({ phase }) => phase === `unload`).length,
      active: this.active.size,
      exactUnloads: this.events
        .filter(
          (event): event is RemoteLeaseEvent & { phase: `unload` } =>
            event.phase === `unload`,
        )
        .every(({ exactLoadedObject }) => exactLoadedObject === true),
    }
  }
}

export type RemoteLeaseTakeoverTrace = {
  initialOwnerAfterAcquire: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  retiredOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
}

export type RemoteLeaseTakeoverViolation = {
  checkpoint: string
  field: keyof ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  expected: number | boolean
  actual: number | boolean
}

export const expectedRemoteLeaseTakeoverTrace: RemoteLeaseTakeoverTrace = {
  initialOwnerAfterAcquire: {
    loads: 1,
    unloads: 0,
    active: 1,
    exactUnloads: true,
  },
  retiredOwnerAfterTakeover: {
    loads: 1,
    unloads: 1,
    active: 0,
    exactUnloads: true,
  },
  newOwnerAfterTakeover: {
    loads: 1,
    unloads: 0,
    active: 1,
    exactUnloads: true,
  },
  newOwnerAfterRelease: {
    loads: 1,
    unloads: 1,
    active: 0,
    exactUnloads: true,
  },
}

export function remoteLeaseTakeoverViolations(
  actual: RemoteLeaseTakeoverTrace,
): Array<RemoteLeaseTakeoverViolation> {
  const violations: Array<RemoteLeaseTakeoverViolation> = []
  for (const checkpoint of Object.keys(
    expectedRemoteLeaseTakeoverTrace,
  ) as Array<keyof RemoteLeaseTakeoverTrace>) {
    const expected = expectedRemoteLeaseTakeoverTrace[checkpoint]
    for (const field of Object.keys(expected) as Array<keyof typeof expected>) {
      if (actual[checkpoint][field] !== expected[field]) {
        violations.push({
          checkpoint,
          field,
          expected: expected[field],
          actual: actual[checkpoint][field],
        })
      }
    }
  }
  return violations
}

export type CollectionScopedLeaseSnapshot = Record<
  `alpha` | `beta`,
  { loads: number; unloads: number; active: number }
>

export function collectionScopedLeaseViolations(
  actual: CollectionScopedLeaseSnapshot,
  expected: CollectionScopedLeaseSnapshot,
): Array<string> {
  const violations: Array<string> = []
  for (const collectionId of [`alpha`, `beta`] as const) {
    for (const field of [`loads`, `unloads`, `active`] as const) {
      if (actual[collectionId][field] !== expected[collectionId][field]) {
        violations.push(`${collectionId}:${field}`)
      }
    }
  }
  return violations
}

export type RawCollectionSnapshot = {
  registryRowCount: number
  schemaVersion: number
  resetEpoch: number
  rowCount: number
}

export type RawSnapshotViolation = {
  field: keyof RawCollectionSnapshot
  expected: number
  actual: number
}

export function rawSnapshotViolations(
  actual: RawCollectionSnapshot,
  expected: RawCollectionSnapshot,
): Array<RawSnapshotViolation> {
  return (
    [`registryRowCount`, `schemaVersion`, `resetEpoch`, `rowCount`] as const
  ).flatMap((field) =>
    actual[field] === expected[field]
      ? []
      : [{ field, expected: expected[field], actual: actual[field] }],
  )
}

export type FreshInitOutcome =
  { status: `fulfilled` } | { status: `rejected`; error: string }

export type FreshInitViolation =
  | { kind: `missing-outcome`; index: number }
  | { kind: `unexpected-outcome`; index: number }
  | { kind: `rejected`; index: number; error: string }

export function freshInitViolations(
  outcomes: ReadonlyArray<FreshInitOutcome>,
): Array<FreshInitViolation> {
  const violations: Array<FreshInitViolation> = []
  for (let index = 0; index < 2; index++) {
    const outcome = outcomes[index]
    if (!outcome) {
      violations.push({ kind: `missing-outcome`, index })
    } else if (outcome.status === `rejected`) {
      violations.push({ kind: `rejected`, index, error: outcome.error })
    }
  }
  for (let index = 2; index < outcomes.length; index++) {
    violations.push({ kind: `unexpected-outcome`, index })
  }
  return violations
}

export type RoutedApply = {
  phase: `initial-owner` | `after-takeover`
  collectionId: CollectionName
  adapterId: string
}

export type RouteViolation = {
  kind: `missing-apply` | `duplicate-apply` | `misrouted-apply`
  checkpoint: RoutedApply[`phase`]
  collectionId: CollectionName
  expectedAdapterId: string
  actualAdapterIds: Array<string>
}

export type CoordinatorRouteObservation = {
  phase: RoutedApply[`phase`]
  operation: `remote-subset` | `index` | `pull`
  collectionId: CollectionName
  calls: Array<{
    adapterId: string
    collectionId: string
    argument?: SemanticValue
  }>
  result: SemanticValue
}

export type CoordinatorRouteViolation = {
  operation: CoordinatorRouteObservation[`operation`]
  checkpoint: CoordinatorRouteObservation[`phase`]
  collectionId: CollectionName
  field: `calls` | `result`
  expected: SemanticValue
  actual: SemanticValue
}

export function coordinatorRouteViolations(
  observed: ReadonlyArray<CoordinatorRouteObservation>,
  expected: ReadonlyArray<CoordinatorRouteObservation>,
): Array<CoordinatorRouteViolation> {
  const violations: Array<CoordinatorRouteViolation> = []
  for (const expectedCell of expected) {
    const actualCell = observed.find(
      ({ phase, operation, collectionId }) =>
        phase === expectedCell.phase &&
        operation === expectedCell.operation &&
        collectionId === expectedCell.collectionId,
    )
    for (const field of [`calls`, `result`] as const) {
      const expectedValue = semanticValue(expectedCell[field])
      const actualValue = semanticValue(actualCell?.[field] ?? [])
      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        violations.push({
          operation: expectedCell.operation,
          checkpoint: expectedCell.phase,
          collectionId: expectedCell.collectionId,
          field,
          expected: expectedValue,
          actual: actualValue,
        })
      }
    }
  }
  return violations
}

export function routeViolationDiscriminant(violation: RouteViolation): string {
  return `${violation.kind}:${violation.checkpoint}:${violation.collectionId}`
}

export function routeViolations(
  observed: ReadonlyArray<RoutedApply>,
  expected: ReadonlyArray<RoutedApply>,
): Array<RouteViolation> {
  const violations: Array<RouteViolation> = []
  for (const expectedRoute of expected) {
    const actualAdapterIds = observed
      .filter(
        ({ phase, collectionId }) =>
          phase === expectedRoute.phase &&
          collectionId === expectedRoute.collectionId,
      )
      .map(({ adapterId }) => adapterId)
    if (actualAdapterIds.length === 0) {
      violations.push({
        kind: `missing-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
      continue
    }
    if (actualAdapterIds.length !== 1) {
      violations.push({
        kind: `duplicate-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
      continue
    }
    if (actualAdapterIds[0] !== expectedRoute.adapterId) {
      violations.push({
        kind: `misrouted-apply`,
        checkpoint: expectedRoute.phase,
        collectionId: expectedRoute.collectionId,
        expectedAdapterId: expectedRoute.adapterId,
        actualAdapterIds,
      })
    }
  }
  return violations
}

export type OwnershipObservation = {
  collectionId: string
  ownerAtCall?: string
}

// A source commit may apply only while the elected persistence owner holds the
// writer boundary. Collection visibility alone does not establish ownership.
export function findUnownedWrites(
  observations: ReadonlyArray<OwnershipObservation>,
  electedOwner: string,
): Array<OwnershipObservation> {
  return observations.filter(
    (observation) => observation.ownerAtCall !== electedOwner,
  )
}
