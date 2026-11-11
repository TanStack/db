/**
 * Calibrations of the per-collection coordinator checks and models in
 * per-collection-coordinator-checks-oracle.ts against hand-built wrong answers:
 * clone safety, subset acknowledgement, collection-scoped acquisitions, the
 * lease takeover check, SQLite-state and fresh-registry checks, collection-key
 * routing, and write ownership. They run no production, so they are ordinary
 * tests. The oracle that drives production is
 * per-collection-coordinator-oracle.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  complexSubsetDemand,
  semanticValue,
  subsetSemantics,
} from './per-collection-coordinator-support'
import {
  collectionScopedLeaseViolations,
  coordinatorRouteViolations,
  expectedRemoteLeaseTakeoverTrace,
  findUnownedWrites,
  freshInitViolations,
  rawSnapshotViolations,
  remoteLeaseTakeoverViolations,
  routeViolationDiscriminant,
  routeViolations,
  subsetAckViolations,
  subsetWireViolations,
} from './per-collection-coordinator-checks-oracle'
import type {
  CollectionScopedLeaseSnapshot,
  CoordinatorRouteObservation,
  FreshInitOutcome,
  RawCollectionSnapshot,
  RemoteLeaseTakeoverTrace,
  RoutedApply,
  SubsetAckTrace,
  SubsetWireTrace,
} from './per-collection-coordinator-checks-oracle'

describe(`per-collection coordinator oracle calibrations`, () => {
  it(`calibrates the clone checker against safe and function-valued payloads`, () => {
    const safe = {
      collectionId: `alpha`,
      where: { type: `eq`, field: `group`, value: `kept` },
      limit: 2,
    }
    const unsafe = { ...safe, callback: () => {} }

    expect(structuredClone(safe)).toEqual(safe)
    expect(() => structuredClone(unsafe)).toThrowError(
      expect.objectContaining({ name: `DataCloneError` }),
    )

    const expected = subsetSemantics(complexSubsetDemand(false))
    const allowed: SubsetWireTrace = {
      outcome: { ok: true },
      decoded: [expected],
      expected,
    }
    expect(subsetWireViolations(allowed)).toEqual([])
    expect(
      subsetWireViolations({
        ...allowed,
        outcome: { ok: false, errorName: `DataCloneError` },
      }),
    ).toContain(`subset-transport-failed`)
    expect(
      subsetWireViolations({ ...allowed, decoded: [semanticValue({})] }),
    ).toContain(`subset-semantics-mismatch`)
  })

  it(`calibrates acknowledgement checks against entry-only and false-success faults`, () => {
    const expected = subsetSemantics(complexSubsetDemand(false))
    const allowed: SubsetAckTrace = {
      ownerInvocation: `coordinator`,
      decoded: expected,
      expected,
      prematureResponses: 0,
      acknowledgedBeforeResponseDelivery: false,
      ownerCompletedBeforeResponse: true,
      acknowledgedAfterResponseDelivery: true,
    }
    expect(subsetAckViolations(allowed)).toEqual([])
    expect(
      subsetAckViolations({
        ...allowed,
        ownerCompletedBeforeResponse: false,
      }),
    ).toContain(`response-before-owner-completion-checkpoint`)
    expect(
      subsetAckViolations({
        ...allowed,
        ownerInvocation: `fixture-fallback`,
        prematureResponses: 1,
      }),
    ).toEqual([
      `leader-owner-not-invoked-by-coordinator`,
      `response-before-owner-completion`,
    ])
  })

  it(`calibrates collection-scoped acquisition identity against a global-id mutant`, () => {
    const expected: CollectionScopedLeaseSnapshot = {
      alpha: { loads: 1, unloads: 0, active: 1 },
      beta: { loads: 1, unloads: 0, active: 1 },
    }
    expect(collectionScopedLeaseViolations(expected, expected)).toEqual([])
    expect(
      collectionScopedLeaseViolations(
        {
          alpha: { loads: 2, unloads: 0, active: 2 },
          beta: { loads: 1, unloads: 0, active: 1 },
        },
        expected,
      ),
    ).toEqual([`alpha:loads`, `alpha:active`])
  })

  it(`calibrates the lease checker against leak, missing replay, and inexact release mutants`, () => {
    expect(
      remoteLeaseTakeoverViolations(expectedRemoteLeaseTakeoverTrace),
    ).toEqual([])
    const mutant: RemoteLeaseTakeoverTrace = structuredClone(
      expectedRemoteLeaseTakeoverTrace,
    )
    mutant.retiredOwnerAfterTakeover = {
      loads: 1,
      unloads: 0,
      active: 1,
      exactUnloads: true,
    }
    mutant.newOwnerAfterTakeover = {
      loads: 0,
      unloads: 0,
      active: 0,
      exactUnloads: true,
    }
    mutant.newOwnerAfterRelease.exactUnloads = false
    expect(
      remoteLeaseTakeoverViolations(mutant).map(
        ({ checkpoint, field }) => `${checkpoint}:${field}`,
      ),
    ).toEqual([
      `retiredOwnerAfterTakeover:unloads`,
      `retiredOwnerAfterTakeover:active`,
      `newOwnerAfterTakeover:loads`,
      `newOwnerAfterTakeover:active`,
      `newOwnerAfterRelease:exactUnloads`,
    ])
  })

  it(`calibrates SQLite-state and fresh-registry checks against mutant results`, () => {
    const expected: RawCollectionSnapshot = {
      registryRowCount: 1,
      schemaVersion: 11,
      resetEpoch: 0,
      rowCount: 1,
    }
    expect(rawSnapshotViolations(expected, expected)).toEqual([])
    expect(
      rawSnapshotViolations(
        {
          registryRowCount: 0,
          schemaVersion: 22,
          resetEpoch: 1,
          rowCount: 0,
        },
        expected,
      ).map(({ field }) => field),
    ).toEqual([`registryRowCount`, `schemaVersion`, `resetEpoch`, `rowCount`])

    const allowed: Array<FreshInitOutcome> = [
      { status: `fulfilled` },
      { status: `fulfilled` },
    ]
    expect(freshInitViolations(allowed)).toEqual([])
    expect(
      freshInitViolations([
        allowed[0]!,
        {
          status: `rejected`,
          error: `UNIQUE constraint failed: collection_registry`,
        },
      ]),
    ).toEqual([
      {
        kind: `rejected`,
        index: 1,
        error: `UNIQUE constraint failed: collection_registry`,
      },
    ])
    expect(freshInitViolations([allowed[0]!])).toEqual([
      { kind: `missing-outcome`, index: 1 },
    ])
  })

  it(`calibrates collection-key comparison against one peer-routed apply`, () => {
    const expected: Array<RoutedApply> = [
      {
        phase: `initial-owner`,
        collectionId: `alpha`,
        adapterId: `leader-alpha`,
      },
      {
        phase: `initial-owner`,
        collectionId: `beta`,
        adapterId: `leader-beta`,
      },
    ]
    const misrouted: Array<RoutedApply> = [
      expected[0]!,
      { ...expected[1]!, adapterId: `leader-alpha` },
    ]

    expect(routeViolations(expected, expected)).toEqual([])
    const [violation] = routeViolations(misrouted, expected)
    expect(violation).toEqual({
      kind: `misrouted-apply`,
      checkpoint: `initial-owner`,
      collectionId: `beta`,
      expectedAdapterId: `leader-beta`,
      actualAdapterIds: [`leader-alpha`],
    })
    expect(routeViolationDiscriminant(violation!)).toBe(
      `misrouted-apply:initial-owner:beta`,
    )

    const routedCell: CoordinatorRouteObservation = {
      phase: `initial-owner`,
      operation: `index`,
      collectionId: `alpha`,
      calls: [
        {
          adapterId: `leader-alpha`,
          collectionId: `alpha`,
          argument: semanticValue({ signature: `alpha-index` }),
        },
      ],
      result: semanticValue({ status: `fulfilled` }),
    }
    expect(coordinatorRouteViolations([routedCell], [routedCell])).toEqual([])
    expect(
      coordinatorRouteViolations(
        [{ ...routedCell, calls: [] }],
        [routedCell],
      ).map(({ operation, checkpoint, collectionId, field }) => ({
        operation,
        checkpoint,
        collectionId,
        field,
      })),
    ).toEqual([
      {
        operation: `index`,
        checkpoint: `initial-owner`,
        collectionId: `alpha`,
        field: `calls`,
      },
    ])
  })

  it(`calibrates the owner checker against one bypass and one owned write`, () => {
    expect(
      findUnownedWrites(
        [
          { collectionId: `alpha`, ownerAtCall: `tab-b` },
          { collectionId: `beta` },
        ],
        `tab-b`,
      ),
    ).toEqual([{ collectionId: `beta` }])
  })
})
