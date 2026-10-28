import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { fc } from '@fast-check/vitest'
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  eq,
} from '@tanstack/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'
import {
  ControlledBroadcastChannel,
  NO_PRIMARY_FAILURE,
  captureCleanup,
  complexSubsetDemand,
  coordinatorFixtureSnapshot,
  createCoordinator,
  createRealTab,
  createRecordingAdapter,
  disposeCoordinator,
  durableTerms,
  envelopeCollection,
  heldLocks,
  installControlledBrowserSeams,
  liveCoordinators,
  payloadType,
  pumpNetwork,
  queuedLocks,
  readCoordinatorOracleConfig,
  registerCollectionAdapter,
  remoteLeaseGrammarPlan,
  restoreControlledBrowserSeams,
  routingGrammarPlan,
  routingHistoryFromAxes,
  semanticValue,
  subsetSemantics,
  waitFor,
  waitForWithoutDelivery,
  withFailurePreservingCleanup,
  withNativeBrowserTransport,
} from './per-collection-coordinator-support'
import type { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type {
  PersistedCollectionCoordinator,
  PersistedMutationEnvelope,
  PersistenceAdapter,
  TransportedLoadSubsetOptions,
} from '@tanstack/db-sqlite-persistence-core'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'
import type { BrowserWASQLiteDatabase } from '../src'
import type {
  AdapterCall,
  CleanupDiagnostic,
  CollectionName,
  CoordinatorOracleProperty,
  PullFixtureResult,
  RealTabRow,
  RealTabSource,
  RecordedSubsetOptions,
  RecordingAdapter,
  RemoteLeaseHistory,
  RoutingHistory,
  SemanticValue,
  TabName,
} from './per-collection-coordinator-support'

const FIXED_SEED = 165902

type CoordinatorOracleCampaign = {
  mode: `fixed` | `random` | `replay`
  parameters: {
    numRuns: number
    seed?: number
    path?: string
  }
}

const { runs: RUNS, replay: REPLAY } = readCoordinatorOracleConfig()

function coordinatorOracleCampaigns(
  property: CoordinatorOracleProperty,
): Array<CoordinatorOracleCampaign> {
  if (REPLAY) {
    return REPLAY.property === property
      ? [
          {
            mode: `replay`,
            parameters: {
              numRuns: RUNS,
              seed: REPLAY.seed,
              path: REPLAY.path,
            },
          },
        ]
      : []
  }
  return [
    {
      mode: `fixed`,
      parameters: { numRuns: RUNS, seed: FIXED_SEED },
    },
    { mode: `random`, parameters: { numRuns: RUNS } },
  ]
}

/*
Coverage owner and test cards
=============================

This suite owns the RFC #1659 Workstream 2 cut across
BrowserCollectionCoordinator, browser persistence resolution, and the
persisted sync wrapper. browser-coordinator-oracle.test.ts is still the focused RPC
unit owner, and db-sqlite-persistence-core/tests/persisted-oracle.test.ts is still the
single-runtime owner. Putting this history in either file would replace the
other production boundary with a stub and lose the collection x tab x adapter
identity question. The real SQLite witness below extends the existing browser
runtime helper instead of claiming a new driver model.

Routing law and source:
- RFC #1659 release invariants 3, 4, and 9; BrowserCollectionCoordinator's
  collectionId-bearing PersistedCollectionCoordinator API; issues #1589 and
  #1753. Configuration and adapter effects for collection A cannot be handled
  by collection B's adapter, before or after leadership transfer.
- History grammar: two distinct collections, distinct schema versions/policies,
  two tabs, reordered request delivery, local writes, and leadership transfer.
  The reference is a Map keyed by (tab, collection), not the
  coordinator's mutable adapter slot.
- Production/checkpoint: real coordinator RPC plus Web Locks seam; compare the
  adapter identity that applies each collection's transaction after both the
  initial and takeover phases. The fixed witness additionally checks real
  SQLite row count, registry schema, and reset epoch after merely subscribing.

Wire/ack law and source:
- RFC invariant 4, LoadSubsetOptions' immutable-request contract, and
  LoadSubsetFn's applied-receipt contract; issue #1498. The emitted heartbeat,
  RPC, and tx variants exercised by the partition below must survive
  structuredClone. Subset expression/cursor/order/window semantics cross the
  wire; live signal/subscription ownership stays local. A successful follower
  response is permitted only after the leader's exact upstream subset load has
  completed.
- History grammar: a callback-bearing Subscription witness plus clone-safe
  expression, limit, and offset request data. Requests and responses may be
  held separately.
- Production/checkpoint: BrowserCollectionCoordinator.sendRPC and the public
  persisted on-demand leader collection. Record postMessage clone failures,
  upstream load entry/completion, and follower settlement at response delivery.

Acquisition law and source:
- RFC invariant 4 and the remote-subset owner contract. Demand can survive
  leadership transfer, but every accepted physical acquisition creates an
  acquisition lease with one exact release obligation.
- History grammar: sibling logical owners, reused and distinct request-data
  objects, prefix and duplicate release, owner replacement, and leadership
  transfer. `RemoteLeaseOwnerLedger` is a model-only call ledger whose active
  entries represent physical acquisitions and their acquisition leases.
  In the composed history, the outer Collection acquisition calls the
  persisted sync adapter, which retains coordinator demand across leadership
  changes. Each accepted remote-owner load establishes a separate owner-level
  physical acquisition and acquisition lease. Retiring that owner releases
  its lease while the outer Collection acquisition remains active.
- Production/checkpoint: real coordinator ensure/release calls. Compare owner
  load/unload counts, exact request-data identity, active acquisitions, and
  cleanup after each release and takeover cut.

Write-ownership law and source:
- RFC invariants 3 and 9 and issue #1753. A sync-ingested persistent write has
  the same supported-owner requirement as a local write.
- History grammar: public source begin/write/commit after a modeled leadership
  change.
- Production/checkpoint: persistedCollectionOptions' wrapped source commit;
  record collection-visible rows, adapter calls, and the owner active at the
  exact applyCommittedTx call.

Reach, challenge, replay, cleanup, and limits:
- Green calibration tests prove structuredClone rejects a function payload,
  the leader upstream fixture can really enter/complete, and the ownership
  checker rejects an unowned apply. Every production-path test records a
  reached checkpoint before comparing the independent ledger.
- Each generated property uses the same generator, driver, observations, and
  run budget in a retained fixed-seed lane and a seedless random lane. Replay
  registers only the requested property when
  TANSTACK_DB_COORDINATOR_ORACLE_{PROPERTY,SEED,PATH} are supplied together;
  RUNS may adjust the shared budget. The thrown report retains the first
  failing trace and final shrunk candidate.
- Coordinators, Collections, and databases use failure-preserving cleanup. A
  final lifecycle test proves no channel, held lock, queued lock, or delayed
  delivery remains and that a fresh database name elects normally.
- Known omissions: the BroadcastChannel and Web Locks seams below perform real structuredClone
  and real coordinator code but are deterministic Node controls. They do not
  earn real-browser, multi-context, OPFS exclusive-handle, worker, Electric,
  PowerSync, or service credit. The focused Browser coordinator owner proves
  bounded replay after retryable follower transport or remote-owner admission
  failure, plus cancellation on release and disposal.
*/

beforeEach(() => {
  durableTerms.clear()
  installControlledBrowserSeams()
})

afterEach(async () => {
  const cleanupDiagnostics: Array<CleanupDiagnostic> = []
  for (const coordinator of liveCoordinators) {
    await captureCleanup(cleanupDiagnostics, `afterEach live coordinator`, () =>
      coordinator.dispose(),
    )
  }
  liveCoordinators.clear()
  await captureCleanup(
    cleanupDiagnostics,
    `afterEach lock release`,
    async () => {
      await waitForWithoutDelivery(
        () => heldLocks.size === 0 && queuedLocks.size === 0,
        `afterEach lock release`,
      )
    },
  )
  const cleanupSnapshot = coordinatorFixtureSnapshot()
  expect.soft(cleanupSnapshot).toEqual({
    delayed: 0,
    endpoints: 0,
    heldLocks: 0,
    queuedLocks: 0,
  })
  await captureCleanup(
    cleanupDiagnostics,
    `global browser descriptors`,
    restoreControlledBrowserSeams,
  )
  await captureCleanup(cleanupDiagnostics, `vitest timers and mocks`, () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  ControlledBroadcastChannel.reset()
  heldLocks.clear()
  queuedLocks.clear()
  expect.soft(cleanupDiagnostics).toEqual([])
})

type SubsetAckTrace = {
  ownerInvocation: `coordinator` | `fixture-fallback`
  decoded: SemanticValue | undefined
  expected: SemanticValue
  prematureResponses: number
  acknowledgedBeforeResponseDelivery: boolean
  ownerCompletedBeforeResponse: boolean
  acknowledgedAfterResponseDelivery: boolean
}

type SubsetWireTrace = {
  outcome: { ok: true } | { ok: false; errorName: string } | undefined
  decoded: ReadonlyArray<SemanticValue>
  expected: SemanticValue
}

// Clone-safe projection may remove live ownership callbacks. It must preserve
// every supported request-data value that determines subset semantics.
function subsetWireViolations(trace: SubsetWireTrace): Array<string> {
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
function subsetAckViolations(trace: SubsetAckTrace): Array<string> {
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

async function observeOwnerEntryOrResponse(
  ownerEntered: () => boolean,
): Promise<`owner-entered` | `response-queued` | `no-progress`> {
  for (let turn = 0; turn < 20; turn++) {
    if (ownerEntered()) return `owner-entered`
    if (
      ControlledBroadcastChannel.delayed.some(
        ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
      )
    ) {
      return `response-queued`
    }
    await nextTurn()
  }
  return `no-progress`
}

describe(`per-collection coordinator wire and acknowledgement oracle`, () => {
  it(`posts the callback-bearing subset witness as clone-safe wire data`, async () => {
    const decoded: Array<SemanticValue> = []
    const leaderAdapter = createRecordingAdapter({
      id: `leader`,
      remoteSubsetOwner: (_collectionId, options) => {
        decoded.push(subsetSemantics(options))
        return Promise.resolve()
      },
    })
    const followerAdapter = createRecordingAdapter({ id: `follower` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      leader = createCoordinator(`clone-witness`, leaderAdapter)
      follower = createCoordinator(`clone-witness`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter)
      registerCollectionAdapter(follower, `alpha`, followerAdapter)
      leader.subscribe(`alpha`, () => {})
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `clone-witness leader/follower topology`,
      )
      const safeTransportBeforeRequest =
        ControlledBroadcastChannel.cloneAttempts.filter(
          (attempt) => attempt.errorName === undefined,
        ).length
      expect(safeTransportBeforeRequest).toBeGreaterThan(0)

      const options = complexSubsetDemand(true)
      vi.useFakeTimers()
      let outcome: { ok: true } | { ok: false; errorName: string } | undefined
      void follower.requestEnsureRemoteSubset(`alpha`, options).then(
        () => {
          outcome = { ok: true }
        },
        (error: unknown) => {
          outcome = {
            ok: false,
            errorName: error instanceof Error ? error.name : String(error),
          }
        },
      )
      for (let step = 0; step < 12 && outcome === undefined; step++) {
        while (ControlledBroadcastChannel.deliverAt(0)) {
          await Promise.resolve()
        }
        await vi.advanceTimersByTimeAsync(100)
      }

      expect(outcome).toBeDefined()
      // Preserve the current-main DataCloneError as an observation without
      // making the defect a positive reach requirement for the GREEN suite.
      const observedCloneFault = ControlledBroadcastChannel.cloneAttempts.find(
        (attempt) => attempt.errorName !== undefined,
      )
      if (outcome?.ok === false) {
        expect(outcome.errorName).toBe(observedCloneFault?.errorName)
      }
      // D3 refinement: after clone-safe projection, the registered leader owner must
      // receive the exact supported semantics and the follower call succeeds.
      expect(
        subsetWireViolations({
          outcome,
          decoded,
          expected: subsetSemantics(options),
        }),
      ).toEqual([])
    }, [
      [
        `clone witness leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `clone witness follower`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
      [
        `clone witness timers`,
        async () => {
          vi.clearAllTimers()
          vi.useRealTimers()
          await nextTurn()
        },
      ],
    ])
  })

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

  it(`acknowledges a follower subset only after the leader source completed it`, async () => {
    const upstreamEvents: Array<{
      phase: `entered` | `completed`
      semantics: SemanticValue
    }> = []
    const releases: Array<() => void> = []
    const ownerDelegate: {
      invoke?: (
        collectionId: string,
        options: RecordedSubsetOptions,
      ) => Promise<void>
    } = {}
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined
    let cleanupLeaderCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      const leaderAdapter = createRecordingAdapter({
        id: `leader-alpha`,
        remoteSubsetOwner: (collectionId, options) => {
          if (!ownerDelegate.invoke) {
            throw new Error(`leader owner not attached`)
          }
          return ownerDelegate.invoke(collectionId, options)
        },
      })
      const followerAdapter = createRecordingAdapter({
        id: `follower-alpha`,
      })
      leader = createCoordinator(`subset-ack`, leaderAdapter)
      follower = createCoordinator(`subset-ack`, followerAdapter)
      registerCollectionAdapter(leader, `alpha`, leaderAdapter, false)
      registerCollectionAdapter(follower, `alpha`, followerAdapter, false)
      const source: SyncConfig<{ id: string; group: string }, string> = {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              upstreamEvents.push({
                phase: `entered`,
                semantics: subsetSemantics(options),
              })
              return new Promise<void>((resolve) => {
                let released = false
                releases.push(() => {
                  if (released) return
                  released = true
                  upstreamEvents.push({
                    phase: `completed`,
                    semantics: subsetSemantics(options),
                  })
                  resolve()
                })
              })
            },
          }
        },
      }
      const leaderCollection = createCollection(
        persistedCollectionOptions({
          id: `alpha`,
          getKey: (row: { id: string; group: string }) => row.id,
          syncMode: `on-demand`,
          sync: source,
          persistence: { adapter: leaderAdapter, coordinator: leader },
        }),
      )
      cleanupLeaderCollection = () => leaderCollection.cleanup()
      ownerDelegate.invoke = async (collectionId, options) => {
        if (collectionId !== `alpha`) {
          throw new Error(`wrong leader subset collection ${collectionId}`)
        }
        await Promise.resolve(
          leaderCollection._sync.loadSubset(
            options as unknown as LoadSubsetOptions,
          ),
        )
      }

      leaderCollection.startSyncImmediate()
      follower.subscribe(`alpha`, () => {})
      await waitFor(
        () => leader!.isLeader(`alpha`) && !follower!.isLeader(`alpha`),
        `subset-ack leader/follower topology`,
      )

      const demand = complexSubsetDemand(false)
      const expectedSemantics = subsetSemantics(demand)
      let acknowledged = false
      const acknowledgement = follower
        .requestEnsureRemoteSubset(`alpha`, demand)
        .then(() => {
          acknowledged = true
        })

      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            payloadType(data) === `rpc:ensureRemoteSubset:req` &&
            envelopeCollection(data) === `alpha`,
        ),
      ).toBe(true)
      const firstProgress = await observeOwnerEntryOrResponse(() =>
        upstreamEvents.some(({ phase }) => phase === `entered`),
      )
      expect(firstProgress).not.toBe(`no-progress`)
      const prematureResponses = ControlledBroadcastChannel.delayed.filter(
        ({ data }) =>
          payloadType(data) === `rpc:ensureRemoteSubset:res` &&
          envelopeCollection(data) === `alpha`,
      )
      let ownerInvocation: SubsetAckTrace[`ownerInvocation`] = `coordinator`
      let ownerWork: Promise<void> | undefined
      if (!upstreamEvents.some(({ phase }) => phase === `entered`)) {
        ownerInvocation = `fixture-fallback`
        for (const response of prematureResponses) {
          const index = ControlledBroadcastChannel.delayed.indexOf(response)
          if (index >= 0) ControlledBroadcastChannel.delayed.splice(index, 1)
        }
        ownerWork = leaderAdapter.ensureRemoteSubset(`alpha`, demand)
        await waitForWithoutDelivery(
          () => upstreamEvents.some(({ phase }) => phase === `entered`),
          `fallback leader owner entry`,
        )
      }
      const entered = upstreamEvents.find(({ phase }) => phase === `entered`)
      expect(
        ControlledBroadcastChannel.delayed.some(
          ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
        ),
      ).toBe(false)
      expect(acknowledged).toBe(false)
      releases.at(-1)?.()
      await ownerWork
      await waitForWithoutDelivery(
        () => upstreamEvents.some(({ phase }) => phase === `completed`),
        `leader subset completion`,
      )
      if (ownerInvocation === `fixture-fallback`) {
        ControlledBroadcastChannel.delayed.push(...prematureResponses)
      } else {
        await waitForWithoutDelivery(
          () =>
            ControlledBroadcastChannel.delayed.some(
              ({ data }) => payloadType(data) === `rpc:ensureRemoteSubset:res`,
            ),
          `response after leader subset completion`,
        )
      }
      const acknowledgedBeforeResponseDelivery = acknowledged
      expect(acknowledged).toBe(false)
      expect(
        ControlledBroadcastChannel.deliverWhere(
          (data) =>
            payloadType(data) === `rpc:ensureRemoteSubset:res` &&
            envelopeCollection(data) === `alpha`,
        ),
      ).toBe(true)
      await acknowledgement
      const trace: SubsetAckTrace = {
        ownerInvocation,
        decoded: entered?.semantics,
        expected: expectedSemantics,
        prematureResponses: prematureResponses.length,
        acknowledgedBeforeResponseDelivery,
        ownerCompletedBeforeResponse: upstreamEvents.some(
          ({ phase }) => phase === `completed`,
        ),
        acknowledgedAfterResponseDelivery: acknowledged,
      }
      // D13 refinement: one comparator owns both the production verdict and hostile
      // entry-only/false-success calibrations above.
      expect(subsetAckViolations(trace)).toEqual([])
    }, [
      [
        `pending subset source releases`,
        () => {
          for (const release of releases) release()
        },
      ],
      [
        `leader collection`,
        async () => {
          await cleanupLeaderCollection?.()
        },
      ],
      [
        `leader coordinator`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `follower coordinator`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
    ])
  })
})

type RemoteLeaseEvent = {
  phase: `load` | `unload`
  token: number
  semantics: SemanticValue
  exactLoadedObject?: boolean
}

class RemoteLeaseOwnerLedger {
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

type RemoteLeaseTakeoverTrace = {
  initialOwnerAfterAcquire: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  retiredOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  newOwnerAfterRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
}

type RemoteLeaseTakeoverViolation = {
  checkpoint: string
  field: keyof ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  expected: number | boolean
  actual: number | boolean
}

const expectedRemoteLeaseTakeoverTrace: RemoteLeaseTakeoverTrace = {
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

function remoteLeaseTakeoverViolations(
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

type CollectionScopedLeaseSnapshot = Record<
  `alpha` | `beta`,
  { loads: number; unloads: number; active: number }
>

function collectionScopedLeaseViolations(
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

type RemoteLeaseHistoryTrace = {
  firstAfterAcquire: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  firstAfterPrefixRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  firstAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  secondAfterTakeover: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
  secondAfterFinalRelease: ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
}

// Grammar bounds: one to three sibling demands, zero to two prefix releases,
// and both values of each identity, duplicate-release, and final-order switch.
// The surviving-demand law keeps at least one acquisition through takeover:
// the marginal plans are one sibling with no prefix release and three siblings
// with two prefix releases. Zero siblings, release before acquisition, and a
// prefix that retires every demand are outside this generated history.
const remoteLeaseHistoryArbitrary = fc.record({
  siblingCount: fc.integer({ min: 1, max: 3 }),
  releasePrefix: fc.integer({ min: 0, max: 2 }),
  identical: fc.boolean(),
  duplicateRelease: fc.boolean(),
  reverseFinalRelease: fc.boolean(),
})

// Every accepted physical acquisition remains active until its exact
// acquisition lease is released. Leadership transfer releases retired-owner
// acquisitions and establishes replacements only for surviving demand.
function remoteLeaseHistoryViolations(
  history: RemoteLeaseHistory,
  actual: RemoteLeaseHistoryTrace,
): Array<RemoteLeaseTakeoverViolation> {
  const { releaseCount } = remoteLeaseGrammarPlan(history)
  const remaining = history.siblingCount - releaseCount
  const expected: RemoteLeaseHistoryTrace = {
    firstAfterAcquire: {
      loads: history.siblingCount,
      unloads: 0,
      active: history.siblingCount,
      exactUnloads: true,
    },
    firstAfterPrefixRelease: {
      loads: history.siblingCount,
      unloads: releaseCount,
      active: remaining,
      exactUnloads: true,
    },
    firstAfterTakeover: {
      loads: history.siblingCount,
      unloads: history.siblingCount,
      active: 0,
      exactUnloads: true,
    },
    secondAfterTakeover: {
      loads: remaining,
      unloads: 0,
      active: remaining,
      exactUnloads: true,
    },
    secondAfterFinalRelease: {
      loads: remaining,
      unloads: remaining,
      active: 0,
      exactUnloads: true,
    },
  }
  const violations: Array<RemoteLeaseTakeoverViolation> = []
  for (const checkpoint of Object.keys(expected) as Array<
    keyof RemoteLeaseHistoryTrace
  >) {
    for (const field of Object.keys(expected[checkpoint]) as Array<
      keyof ReturnType<RemoteLeaseOwnerLedger[`snapshot`]>
    >) {
      if (actual[checkpoint][field] !== expected[checkpoint][field]) {
        violations.push({
          checkpoint,
          field,
          expected: expected[checkpoint][field],
          actual: actual[checkpoint][field],
        })
      }
    }
  }
  return violations
}

describe(`remote subset ownership lease oracle`, () => {
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

  it(`keeps reused option identities independent per collection across bounded histories`, async () => {
    type Action = {
      kind: `ensure` | `release`
      collectionId: `alpha` | `beta`
      objectId: 0 | 1
    }
    const histories: ReadonlyArray<{
      name: string
      actions: ReadonlyArray<Action>
    }> = [
      {
        name: `shared object A-B-A`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
      {
        name: `released object reacquired beside sibling collection`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
      {
        name: `two identities with duplicate releases`,
        actions: [
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 1 },
          { kind: `ensure`, collectionId: `beta`, objectId: 0 },
          { kind: `ensure`, collectionId: `beta`, objectId: 1 },
          { kind: `ensure`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 1 },
          { kind: `release`, collectionId: `beta`, objectId: 1 },
          { kind: `release`, collectionId: `alpha`, objectId: 1 },
          { kind: `release`, collectionId: `alpha`, objectId: 0 },
          { kind: `release`, collectionId: `beta`, objectId: 0 },
        ],
      },
    ]

    for (const [historyIndex, history] of histories.entries()) {
      const owners = {
        alpha: new RemoteLeaseOwnerLedger(),
        beta: new RemoteLeaseOwnerLedger(),
      }
      const live = {
        alpha: new Set<number>(),
        beta: new Set<number>(),
      }
      const expected: CollectionScopedLeaseSnapshot = {
        alpha: { loads: 0, unloads: 0, active: 0 },
        beta: { loads: 0, unloads: 0, active: 0 },
      }
      const coordinator = createCoordinator(
        `collection-scoped-lease-${historyIndex}`,
        createRecordingAdapter({ id: `collection-scoped-${historyIndex}` }),
      )
      const unregisterAlpha = coordinator.registerRemoteSubsetOwner(
        `alpha`,
        owners.alpha.boundary,
      )
      const unregisterBeta = coordinator.registerRemoteSubsetOwner(
        `beta`,
        owners.beta.boundary,
      )
      coordinator.subscribe(`alpha`, () => {})
      coordinator.subscribe(`beta`, () => {})
      const objects: [LoadSubsetOptions, LoadSubsetOptions] = [
        { limit: 1, offset: 0 },
        { limit: 2, offset: 1 },
      ]

      await withFailurePreservingCleanup(async () => {
        await waitFor(
          () => coordinator.isLeader(`alpha`) && coordinator.isLeader(`beta`),
          `${history.name} leadership`,
        )
        for (const [actionIndex, action] of history.actions.entries()) {
          const liveObjects = live[action.collectionId]
          const expectedCollection = expected[action.collectionId]
          if (action.kind === `ensure`) {
            await coordinator.requestEnsureRemoteSubset(
              action.collectionId,
              objects[action.objectId],
            )
            if (!liveObjects.has(action.objectId)) {
              liveObjects.add(action.objectId)
              expectedCollection.loads++
              expectedCollection.active++
            }
          } else {
            await coordinator.requestReleaseRemoteSubset(
              action.collectionId,
              objects[action.objectId],
            )
            if (liveObjects.delete(action.objectId)) {
              expectedCollection.unloads++
              expectedCollection.active--
            }
          }

          const alpha = owners.alpha.snapshot()
          const beta = owners.beta.snapshot()
          const actual: CollectionScopedLeaseSnapshot = {
            alpha: {
              loads: alpha.loads,
              unloads: alpha.unloads,
              active: alpha.active,
            },
            beta: {
              loads: beta.loads,
              unloads: beta.unloads,
              active: beta.active,
            },
          }
          expect(
            collectionScopedLeaseViolations(actual, expected),
            `${history.name} action ${actionIndex}: ${JSON.stringify(action)}; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
          ).toEqual([])
        }
      }, [
        [`${history.name} alpha owner`, unregisterAlpha],
        [`${history.name} beta owner`, unregisterBeta],
        [
          `${history.name} coordinator`,
          async () => {
            await disposeCoordinator(coordinator)
          },
        ],
      ])
    }
  })

  it(`retains the outer Collection acquisition across leader takeover and releases both owner acquisition leases exactly`, async () => {
    type Todo = { id: string; title: string }
    const firstOwner = new RemoteLeaseOwnerLedger()
    const secondOwner = new RemoteLeaseOwnerLedger()
    const dbName = `remote-lease-takeover-fixed`
    const collectionId = `lease-todos`
    let firstLeader: BrowserCollectionCoordinator | undefined
    let secondLeader: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined
    let unregisterFirst: (() => void) | undefined
    let unregisterSecond: (() => void) | undefined
    let cleanupCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      firstLeader = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-first` }),
      )
      secondLeader = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-second` }),
      )
      requester = createCoordinator(
        dbName,
        createRecordingAdapter({ id: `lease-requester` }),
      )
      unregisterFirst = firstLeader.registerRemoteSubsetOwner(
        collectionId,
        firstOwner.boundary,
      )
      unregisterSecond = secondLeader.registerRemoteSubsetOwner(
        collectionId,
        secondOwner.boundary,
      )
      firstLeader.subscribe(collectionId, () => {})
      secondLeader.subscribe(collectionId, () => {})
      await waitFor(
        () =>
          firstLeader!.isLeader(collectionId) &&
          !secondLeader!.isLeader(collectionId),
        `initial remote subset owner`,
      )

      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: collectionId,
          getKey: (todo) => todo.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: {
            adapter: createRecordingAdapter({ id: `lease-requester-runtime` }),
            coordinator: requester,
          },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()

      const demand: LoadSubsetOptions = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([collectionId, `group`]),
          new IR.Value(`owned`),
        ]),
        limit: 2,
      }
      const acquisition = Promise.resolve(collection._sync.loadSubset(demand))
      await pumpNetwork()
      await acquisition
      const initialOwnerAfterAcquire = firstOwner.snapshot()

      await disposeCoordinator(firstLeader)
      await waitFor(
        () => secondLeader!.isLeader(collectionId),
        `remote subset takeover leader`,
      )
      // Deliver the new leader heartbeat and every acquisition replay it
      // causes. The outer Collection acquisition retains coordinator demand
      // while the retired remote-owner acquisition is replaced.
      await pumpNetwork()
      await nextTurn()
      await pumpNetwork()
      const retiredOwnerAfterTakeover = firstOwner.snapshot()
      const newOwnerAfterTakeover = secondOwner.snapshot()

      collection._sync.unloadSubset(demand)
      await pumpNetwork()
      await nextTurn()
      await pumpNetwork()
      const newOwnerAfterRelease = secondOwner.snapshot()

      const trace: RemoteLeaseTakeoverTrace = {
        initialOwnerAfterAcquire,
        retiredOwnerAfterTakeover,
        newOwnerAfterTakeover,
        newOwnerAfterRelease,
      }
      expect(remoteLeaseTakeoverViolations(trace)).toEqual([])
    }, [
      [
        `remote lease requester collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
      [`first remote subset owner`, () => unregisterFirst?.()],
      [`second remote subset owner`, () => unregisterSecond?.()],
      [
        `first remote subset leader`,
        async () => {
          await disposeCoordinator(firstLeader)
        },
      ],
      [
        `second remote subset leader`,
        async () => {
          await disposeCoordinator(secondLeader)
        },
      ],
      [
        `remote subset requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })

  it(`calibrates the lease checker against leak, missing replay, and inexact release mutants`, () => {
    expect(
      remoteLeaseTakeoverViolations(expectedRemoteLeaseTakeoverTrace),
    ).toEqual([])
    const hostile: RemoteLeaseTakeoverTrace = structuredClone(
      expectedRemoteLeaseTakeoverTrace,
    )
    hostile.retiredOwnerAfterTakeover = {
      loads: 1,
      unloads: 0,
      active: 1,
      exactUnloads: true,
    }
    hostile.newOwnerAfterTakeover = {
      loads: 0,
      unloads: 0,
      active: 0,
      exactUnloads: true,
    }
    hostile.newOwnerAfterRelease.exactUnloads = false
    expect(
      remoteLeaseTakeoverViolations(hostile).map(
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

  async function runRemoteLeaseCampaign(
    campaign: CoordinatorOracleCampaign,
  ): Promise<void> {
    let originalHistory: RemoteLeaseHistory | undefined
    let originalViolation: RemoteLeaseTakeoverViolation | undefined
    let targetDiscriminant: string | undefined
    const cleanupDiagnostics: Array<
      CleanupDiagnostic & { history: RemoteLeaseHistory }
    > = []
    const executionDiagnostics: Array<
      CleanupDiagnostic & { history: RemoteLeaseHistory; checkpoint: string }
    > = []
    let propertyFailure: unknown | typeof NO_PRIMARY_FAILURE =
      NO_PRIMARY_FAILURE
    let run = 0

    try {
      await fc.assert(
        fc.asyncProperty(remoteLeaseHistoryArbitrary, async (history) => {
          const firstOwner = new RemoteLeaseOwnerLedger()
          const secondOwner = new RemoteLeaseOwnerLedger()
          const suffix = `${++run}-${history.siblingCount}-${history.releasePrefix}`
          const dbName = `remote-lease-history-${suffix}`
          const collectionId = `lease-history-${suffix}`
          let firstLeader: BrowserCollectionCoordinator | undefined
          let secondLeader: BrowserCollectionCoordinator | undefined
          let requester: BrowserCollectionCoordinator | undefined
          let unregisterFirst: (() => void) | undefined
          let unregisterSecond: (() => void) | undefined
          let cleanupCollection: (() => Promise<void>) | undefined
          let semanticFailure: unknown | typeof NO_PRIMARY_FAILURE =
            NO_PRIMARY_FAILURE
          let checkpoint = `coordinator allocation`

          try {
            firstLeader = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-first` }),
            )
            secondLeader = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-second` }),
            )
            requester = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-requester` }),
            )
            unregisterFirst = firstLeader.registerRemoteSubsetOwner(
              collectionId,
              firstOwner.boundary,
            )
            unregisterSecond = secondLeader.registerRemoteSubsetOwner(
              collectionId,
              secondOwner.boundary,
            )
            firstLeader.subscribe(collectionId, () => {})
            secondLeader.subscribe(collectionId, () => {})
            checkpoint = `initial leadership`
            await waitFor(
              () =>
                firstLeader!.isLeader(collectionId) &&
                !secondLeader!.isLeader(collectionId),
              `generated remote subset owner`,
            )

            const collection = createCollection(
              persistedCollectionOptions<{ id: string }, string>({
                id: collectionId,
                getKey: (row) => row.id,
                syncMode: `on-demand`,
                sync: {
                  sync: ({ markReady }) => {
                    markReady()
                    return {}
                  },
                },
                persistence: {
                  adapter: createRecordingAdapter({ id: `history-runtime` }),
                  coordinator: requester,
                },
              }),
            )
            cleanupCollection = () => collection.cleanup()
            collection.startSyncImmediate()
            const plan = remoteLeaseGrammarPlan(history)
            const demands: Array<LoadSubsetOptions> = plan.demands

            checkpoint = `initial acquisitions`
            for (const demand of demands) {
              const acquisition = Promise.resolve(
                collection._sync.loadSubset(demand),
              )
              await pumpNetwork()
              await acquisition
            }
            const firstAfterAcquire = firstOwner.snapshot()

            checkpoint = `prefix releases`
            for (const index of plan.prefixReleaseIndexes) {
              const demand = demands[index]!
              for (let pass = 0; pass < plan.releasePasses; pass++) {
                collection._sync.unloadSubset(demand)
              }
            }
            await pumpNetwork()
            const firstAfterPrefixRelease = firstOwner.snapshot()

            checkpoint = `leadership takeover`
            await disposeCoordinator(firstLeader)
            await waitFor(
              () => secondLeader!.isLeader(collectionId),
              `generated remote subset takeover`,
            )
            await pumpNetwork()
            await nextTurn()
            await pumpNetwork()
            const firstAfterTakeover = firstOwner.snapshot()
            const secondAfterTakeover = secondOwner.snapshot()

            checkpoint = `final releases`
            for (const index of plan.finalReleaseIndexes) {
              const demand = demands[index]!
              for (let pass = 0; pass < plan.releasePasses; pass++) {
                collection._sync.unloadSubset(demand)
              }
            }
            await pumpNetwork()
            await nextTurn()
            await pumpNetwork()
            const secondAfterFinalRelease = secondOwner.snapshot()

            checkpoint = `semantic comparison`
            const trace: RemoteLeaseHistoryTrace = {
              firstAfterAcquire,
              firstAfterPrefixRelease,
              firstAfterTakeover,
              secondAfterTakeover,
              secondAfterFinalRelease,
            }
            const [violation] = remoteLeaseHistoryViolations(history, trace)
            if (violation) {
              const discriminant = `${violation.checkpoint}:${violation.field}`
              if (targetDiscriminant === undefined) {
                targetDiscriminant = discriminant
                originalHistory = structuredClone(history)
                originalViolation = structuredClone(violation)
              }
              if (discriminant === targetDiscriminant) {
                semanticFailure = new Error(
                  `remote lease mismatch; discriminant=${discriminant}; originalViolation=${JSON.stringify(originalViolation)}; reducedViolation=${JSON.stringify(violation)}; original=${JSON.stringify(originalHistory)}; reduced=${JSON.stringify(history)}; trace=${JSON.stringify(trace)}`,
                )
              }
            }
          } catch (error) {
            executionDiagnostics.push({
              resource: `generated remote lease execution`,
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
              history: structuredClone(history),
              checkpoint,
            })
          }

          const historyCleanupDiagnostics: Array<CleanupDiagnostic> = []
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated remote lease collection`,
            async () => {
              await cleanupCollection?.()
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated first owner registration`,
            () => unregisterFirst?.(),
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated second owner registration`,
            () => unregisterSecond?.(),
          )
          for (const [resource, coordinator] of [
            [`generated first leader`, firstLeader],
            [`generated second leader`, secondLeader],
            [`generated requester`, requester],
          ] as const) {
            await captureCleanup(
              historyCleanupDiagnostics,
              resource,
              async () => {
                await disposeCoordinator(coordinator)
              },
            )
          }
          await captureCleanup(
            historyCleanupDiagnostics,
            `generated remote lease transport and locks`,
            async () => {
              await waitForWithoutDelivery(
                () =>
                  heldLocks.size === 0 &&
                  queuedLocks.size === 0 &&
                  ControlledBroadcastChannel.delayed.length === 0,
                `generated remote lease cleanup`,
              )
            },
          )
          cleanupDiagnostics.push(
            ...historyCleanupDiagnostics.map((diagnostic) => ({
              ...diagnostic,
              history: structuredClone(history),
            })),
          )
          if (semanticFailure !== NO_PRIMARY_FAILURE) throw semanticFailure
        }),
        {
          ...campaign.parameters,
          examples: [
            [
              {
                siblingCount: 2,
                releasePrefix: 1,
                identical: true,
                duplicateRelease: true,
                reverseFinalRelease: true,
              },
            ],
          ],
        },
      )
    } catch (error) {
      propertyFailure = error
    }

    expect.soft(cleanupDiagnostics).toEqual([])
    expect.soft(executionDiagnostics).toEqual([])
    if (propertyFailure !== NO_PRIMARY_FAILURE) throw propertyFailure
  }

  for (const campaign of coordinatorOracleCampaigns(`remote-lease`)) {
    it(`preserves independent sibling leases through release, retry-safe takeover, and cleanup histories (${campaign.mode})`, () =>
      runRemoteLeaseCampaign(campaign))
  }
})

type RawCollectionSnapshot = {
  registryRowCount: number
  schemaVersion: number
  resetEpoch: number
  rowCount: number
}

type RawSnapshotViolation = {
  field: keyof RawCollectionSnapshot
  expected: number
  actual: number
}

function rawSnapshotViolations(
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

type FreshInitOutcome =
  { status: `fulfilled` } | { status: `rejected`; error: string }

type FreshInitViolation =
  | { kind: `missing-outcome`; index: number }
  | { kind: `unexpected-outcome`; index: number }
  | { kind: `rejected`; index: number; error: string }

function freshInitViolations(
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

async function readRawCollectionSnapshot(
  database: BrowserWASQLiteDatabase,
  collectionId: string,
): Promise<RawCollectionSnapshot> {
  const registry = await database.execute<{
    table_name: string
    schema_version: number
  }>(
    `SELECT table_name, schema_version FROM collection_registry WHERE collection_id = ?`,
    [collectionId],
  )
  const row = registry[0]
  if (!row) throw new Error(`missing registry row for ${collectionId}`)
  const reset = await database.execute<{ reset_epoch: number }>(
    `SELECT reset_epoch FROM collection_reset_epoch WHERE collection_id = ?`,
    [collectionId],
  )
  const tableName = `"${row.table_name.replaceAll(`"`, `""`)}"`
  const count = await database.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${tableName}`,
  )
  return {
    registryRowCount: registry.length,
    schemaVersion: row.schema_version,
    resetEpoch: reset[0]?.reset_epoch ?? -1,
    rowCount: count[0]?.count ?? -1,
  }
}

describe(`per-collection adapter and SQLite-state oracle`, () => {
  it(`preserves alpha rows, schema, and reset epoch when beta registers a different adapter`, async () => {
    let directory: string | undefined
    let database: BrowserWASQLiteDatabase | undefined
    let coordinator: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      directory = mkdtempSync(join(tmpdir(), `db-coordinator-routing-`))
      const createdDatabase = createWASQLiteTestDatabase({
        filename: join(directory, `state.sqlite`),
      })
      database = createdDatabase
      const createdCoordinator = createCoordinator(
        `real-sqlite-routing`,
        createRecordingAdapter({ id: `bootstrap` }),
      )
      coordinator = createdCoordinator
      const persistence = createBrowserWASQLitePersistence({
        database: createdDatabase,
        coordinator: createdCoordinator,
      })
      const resolve = (
        collectionId: string,
        schemaVersion: number,
      ): PersistenceAdapter => {
        const resolved = persistence.resolvePersistenceForCollection?.({
          collectionId,
          mode: `sync-present`,
          schemaVersion,
        })
        if (!resolved) throw new Error(`missing per-collection resolver`)
        return resolved.adapter
      }

      const alphaAdapter = resolve(`alpha`, 11)
      await alphaAdapter.applyCommittedTx(
        { kind: `eager`, collectionId: `alpha` },
        {
          txId: `alpha-seed`,
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            {
              type: `insert`,
              key: `a-1`,
              value: { id: `a-1`, group: `kept` },
            },
          ],
        },
      )
      const expected: RawCollectionSnapshot = {
        registryRowCount: 1,
        schemaVersion: 11,
        resetEpoch: 0,
        rowCount: 1,
      }
      const before = await readRawCollectionSnapshot(createdDatabase, `alpha`)
      expect(rawSnapshotViolations(before, expected)).toEqual([])

      // Merely resolving beta replaces the coordinator's one adapter slot.
      // The later alpha leadership read therefore runs through beta's schema.
      const betaAdapter = resolve(`beta`, 22)
      await betaAdapter.loadSubset({ kind: `eager`, collectionId: `beta` }, {})
      createdCoordinator.subscribe(`alpha`, () => {})
      await waitFor(
        () => createdCoordinator.isLeader(`alpha`),
        `alpha leadership after beta registration`,
      )
      const after = await readRawCollectionSnapshot(createdDatabase, `alpha`)

      // D2 fixed cross-collection contamination witness. The shared
      // comparator reports schema, reset, and row losses independently.
      expect(rawSnapshotViolations(after, expected)).toEqual([])
    }, [
      [
        `real SQLite coordinator`,
        async () => {
          await disposeCoordinator(coordinator)
        },
      ],
      [
        `real SQLite database`,
        async () => {
          await Promise.resolve(database?.close?.())
        },
      ],
      [
        `real SQLite directory`,
        () => {
          if (directory) rmSync(directory, { recursive: true, force: true })
        },
      ],
    ])
  })

  it(`initializes one fresh collection safely across matching adapter instances`, async () => {
    let directory: string | undefined
    let database: BrowserWASQLiteDatabase | undefined

    await withFailurePreservingCleanup(async () => {
      directory = mkdtempSync(join(tmpdir(), `db-adapter-init-race-`))
      const createdDatabase = createWASQLiteTestDatabase({
        filename: join(directory, `state.sqlite`),
      })
      database = createdDatabase
      const createAdapter = (): PersistenceAdapter => {
        const persistence = createBrowserWASQLitePersistence({
          database: createdDatabase,
        })
        const resolved = persistence.resolvePersistenceForCollection?.({
          collectionId: `shared`,
          mode: `sync-present`,
          schemaVersion: 7,
        })
        if (!resolved) throw new Error(`missing per-collection resolver`)
        return resolved.adapter
      }
      const first = createAdapter()
      const second = createAdapter()

      const outcomes = await Promise.allSettled([
        first.loadSubset({ kind: `eager`, collectionId: `shared` }, {}),
        second.loadSubset({ kind: `eager`, collectionId: `shared` }, {}),
      ])
      const observed: Array<FreshInitOutcome> = outcomes.map((outcome) =>
        outcome.status === `fulfilled`
          ? { status: outcome.status }
          : {
              status: outcome.status,
              error:
                outcome.reason instanceof Error
                  ? outcome.reason.message
                  : String(outcome.reason),
            },
      )

      const initialized = await readRawCollectionSnapshot(
        createdDatabase,
        `shared`,
      )
      expect(
        rawSnapshotViolations(initialized, {
          registryRowCount: 1,
          schemaVersion: 7,
          resetEpoch: 0,
          rowCount: 0,
        }),
      ).toEqual([])

      // Separate #1753 checkpoint: same collection and same version/policy is
      // legal in two tabs. Both production adapter initializations must finish;
      // this does not rely on the cross-version reset assertion above.
      expect(freshInitViolations(observed)).toEqual([])
    }, [
      [
        `race SQLite database`,
        async () => {
          await Promise.resolve(database?.close?.())
        },
      ],
      [
        `race SQLite directory`,
        () => {
          if (directory) rmSync(directory, { recursive: true, force: true })
        },
      ],
    ])
  })

  it(`calibrates SQLite-state and fresh-registry checks against hostile results`, () => {
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
})

type RoutedApply = {
  phase: `initial-owner` | `after-takeover`
  collectionId: CollectionName
  adapterId: string
}

type RouteViolation = {
  kind: `missing-apply` | `duplicate-apply` | `misrouted-apply`
  checkpoint: RoutedApply[`phase`]
  collectionId: CollectionName
  expectedAdapterId: string
  actualAdapterIds: Array<string>
}

type CoordinatorRouteObservation = {
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

type CoordinatorRouteViolation = {
  operation: CoordinatorRouteObservation[`operation`]
  checkpoint: CoordinatorRouteObservation[`phase`]
  collectionId: CollectionName
  field: `calls` | `result`
  expected: SemanticValue
  actual: SemanticValue
}

function coordinatorRouteViolations(
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

function routeViolationDiscriminant(violation: RouteViolation): string {
  return `${violation.kind}:${violation.checkpoint}:${violation.collectionId}`
}

function routeViolations(
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

// Collection identity and elected ownership jointly select the adapter. The
// model deliberately uses Maps instead of the coordinator's routing storage.
class PerCollectionRouteOracle {
  private readonly routes = new Map<string, string>()
  private readonly owners = new Map<CollectionName, TabName>()

  register(tab: TabName, collection: CollectionName, adapterId: string): void {
    this.routes.set(`${tab}:${collection}`, adapterId)
  }

  setOwner(collection: CollectionName, tab: TabName): void {
    this.owners.set(collection, tab)
  }

  expectedApply(
    phase: RoutedApply[`phase`],
    collectionId: CollectionName,
  ): RoutedApply {
    const owner = this.owners.get(collectionId)
    const adapterId = owner
      ? this.routes.get(`${owner}:${collectionId}`)
      : undefined
    if (!owner || !adapterId) {
      throw new Error(`oracle has no owner/route for ${collectionId}`)
    }
    return { phase, collectionId, adapterId }
  }
}

const orderArbitrary = fc
  .boolean()
  .map((forward): [CollectionName, CollectionName] =>
    forward ? [`alpha`, `beta`] : [`beta`, `alpha`],
  )

// Grammar bounds: alpha schema version 1..50 and positive delta 1..50 give
// distinct versions from (1, 2) through (50, 100). Every order axis uses both
// two-collection permutations. A missing/duplicate registration, equal schema
// versions, or delivery before registration is excluded by construction.
const routingHistoryArbitrary: fc.Arbitrary<RoutingHistory> = fc
  .record({
    alphaVersion: fc.integer({ min: 1, max: 50 }),
    versionDelta: fc.integer({ min: 1, max: 50 }),
    registrationOrder: orderArbitrary,
    firstDeliveryOrder: orderArbitrary,
    secondDeliveryOrder: orderArbitrary,
  })
  .map(routingHistoryFromAxes)

function mutation(
  collectionId: CollectionName,
  phase: RoutedApply[`phase`],
): Array<PersistedMutationEnvelope> {
  return [
    {
      mutationId: `${phase}:${collectionId}`,
      type: `insert`,
      key: `${phase}:${collectionId}`,
      value: { id: `${phase}:${collectionId}`, collectionId },
    },
  ]
}

function applyObservation(
  phase: RoutedApply[`phase`],
  calls: ReadonlyArray<AdapterCall>,
): Array<RoutedApply> {
  return calls
    .filter(
      (call): call is AdapterCall & { collectionId: CollectionName } =>
        call.operation === `apply` &&
        (call.collectionId === `alpha` || call.collectionId === `beta`),
    )
    .map(({ collectionId, adapterId }) => ({
      phase,
      collectionId,
      adapterId,
    }))
    .sort((left, right) => left.collectionId.localeCompare(right.collectionId))
}

async function requestBothCollections(
  requester: BrowserCollectionCoordinator,
  phase: RoutedApply[`phase`],
  deliveryOrder: [CollectionName, CollectionName],
): Promise<void> {
  const pending = ([`alpha`, `beta`] as const).map((collectionId) =>
    requester.requestApplyLocalMutations(
      collectionId,
      mutation(collectionId, phase),
    ),
  )
  for (const collectionId of deliveryOrder) {
    expect(
      ControlledBroadcastChannel.deliverWhere(
        (data) =>
          payloadType(data) === `rpc:applyLocalMutations:req` &&
          envelopeCollection(data) === collectionId,
      ),
    ).toBe(true)
    await nextTurn()
  }
  await pumpNetwork()
  const responses = await Promise.all(pending)
  expect(responses.every((response) => response.ok)).toBe(true)
}

describe(`generated collection-route histories`, () => {
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

  it(`routes every adapter-bound RPC by collection before and after leadership transfer`, async () => {
    const makePullResult = (
      marker: string,
      latestRowVersion: number,
    ): PullFixtureResult => ({
      latestRowVersion,
      requiresFullReload: false,
      changedKeys: [`${marker}:changed`],
      deletedKeys: [`${marker}:deleted`],
    })
    const leaderPullResults = {
      alpha: makePullResult(`leader-alpha`, 101),
      beta: makePullResult(`leader-beta`, 202),
    }
    const followerPullResults = {
      alpha: makePullResult(`follower-alpha`, 303),
      beta: makePullResult(`follower-beta`, 404),
    }
    const createPhaseAdapters = (
      tab: TabName,
      pullResults: Record<CollectionName, PullFixtureResult>,
    ): Record<CollectionName, RecordingAdapter> => ({
      alpha: createRecordingAdapter({
        id: `${tab}-alpha`,
        remoteSubsetOwner: () => Promise.resolve(),
        pullResult: pullResults.alpha,
      }),
      beta: createRecordingAdapter({
        id: `${tab}-beta`,
        remoteSubsetOwner: () => Promise.resolve(),
        pullResult: pullResults.beta,
      }),
    })
    const leaderAdapters = createPhaseAdapters(`leader`, leaderPullResults)
    const followerAdapters = createPhaseAdapters(
      `follower`,
      followerPullResults,
    )
    const requesterAdapter = createRecordingAdapter({ id: `requester` })
    let leader: BrowserCollectionCoordinator | undefined
    let follower: BrowserCollectionCoordinator | undefined
    let requester: BrowserCollectionCoordinator | undefined

    await withFailurePreservingCleanup(async () => {
      const observed: Array<CoordinatorRouteObservation> = []
      const expected: Array<CoordinatorRouteObservation> = []
      const dbName = `adapter-bound-rpc-matrix`
      leader = createCoordinator(dbName, leaderAdapters.alpha)
      follower = createCoordinator(dbName, followerAdapters.alpha)
      for (const collectionId of [`alpha`, `beta`] as const) {
        // Register beta last so a global mutable adapter misroutes alpha.
        registerCollectionAdapter(
          leader,
          collectionId,
          leaderAdapters[collectionId],
        )
        registerCollectionAdapter(
          follower,
          collectionId,
          followerAdapters[collectionId],
        )
        leader.subscribe(collectionId, () => {})
        follower.subscribe(collectionId, () => {})
      }
      await waitFor(
        () =>
          leader!.isLeader(`alpha`) &&
          leader!.isLeader(`beta`) &&
          !follower!.isLeader(`alpha`) &&
          !follower!.isLeader(`beta`),
        `adapter-bound initial leadership`,
      )

      const exercisePhase = async (
        phase: RoutedApply[`phase`],
        rpcRequester: BrowserCollectionCoordinator,
        ownerAdapters: Record<CollectionName, RecordingAdapter>,
        pullResults: Record<CollectionName, PullFixtureResult>,
      ): Promise<void> => {
        for (const operation of [`remote-subset`, `index`, `pull`] as const) {
          for (const collectionId of [`alpha`, `beta`] as const) {
            const before = new Map(
              Object.values(ownerAdapters).map((adapter) => [
                adapter,
                adapter.calls.length,
              ]),
            )
            let requestType: string
            let argument: SemanticValue
            let pending: Promise<unknown>
            let expectedResult: SemanticValue

            if (operation === `remote-subset`) {
              const demand: LoadSubsetOptions = {
                where: new IR.Func(`eq`, [
                  new IR.PropRef([collectionId, `group`]),
                  new IR.Value(`${phase}:${collectionId}`),
                ]),
                limit: collectionId === `alpha` ? 1 : 2,
                offset: phase === `initial-owner` ? 0 : 1,
              }
              requestType = `rpc:ensureRemoteSubset:req`
              argument = subsetSemantics(demand)
              pending = rpcRequester
                .requestEnsureRemoteSubset(collectionId, demand)
                .then(() => ({ status: `fulfilled` }))
              expectedResult = semanticValue({ status: `fulfilled` })
            } else if (operation === `index`) {
              const signature = `${phase}:${collectionId}:index`
              const spec = {
                expressionSql: [`${collectionId}_score`, phase],
              }
              requestType = `rpc:ensurePersistedIndex:req`
              argument = semanticValue({ signature, spec })
              pending = rpcRequester
                .requestEnsurePersistedIndex(collectionId, signature, spec)
                .then(() => ({ status: `fulfilled` }))
              expectedResult = semanticValue({ status: `fulfilled` })
            } else {
              const fromRowVersion =
                (phase === `initial-owner` ? 0 : 100) +
                (collectionId === `alpha` ? 11 : 22)
              requestType = `rpc:pullSince:req`
              argument = semanticValue({ fromRowVersion })
              pending = rpcRequester.pullSince(collectionId, fromRowVersion)
              const pullResult = pullResults[collectionId]
              expectedResult = semanticValue({
                ok: true,
                // A no-write takeover still reserves a distinct durable term.
                latestTerm: phase === `initial-owner` ? 1 : 2,
                latestSeq: 0,
                latestRowVersion: pullResult.latestRowVersion,
                requiresFullReload: false,
                changedKeys: pullResult.changedKeys,
                deletedKeys: pullResult.deletedKeys,
              })
            }

            expect(
              ControlledBroadcastChannel.deliverWhere(
                (data) =>
                  payloadType(data) === requestType &&
                  envelopeCollection(data) === collectionId,
              ),
            ).toBe(true)
            await pumpNetwork()
            const result = await pending
            const calls = Object.values(ownerAdapters)
              .flatMap((adapter) =>
                adapter.calls
                  .slice(before.get(adapter) ?? 0)
                  .filter((call) => call.operation === operation)
                  .map(
                    ({
                      adapterId,
                      collectionId: calledId,
                      argument: callArgument,
                    }) => ({
                      adapterId,
                      collectionId: calledId,
                      ...(callArgument === undefined
                        ? {}
                        : { argument: callArgument }),
                    }),
                  ),
              )
              .sort((left, right) =>
                left.adapterId.localeCompare(right.adapterId),
              )
            const resultValue =
              operation === `pull`
                ? semanticValue(
                    result && typeof result === `object`
                      ? Object.fromEntries(
                          Object.entries(result).filter(
                            ([key]) => key !== `type` && key !== `rpcId`,
                          ),
                        )
                      : result,
                  )
                : semanticValue(result)
            observed.push({
              phase,
              operation,
              collectionId,
              calls,
              result: resultValue,
            })
            expected.push({
              phase,
              operation,
              collectionId,
              calls: [
                {
                  adapterId: ownerAdapters[collectionId].id,
                  collectionId,
                  argument,
                },
              ],
              result: expectedResult,
            })
          }
        }
      }

      await exercisePhase(
        `initial-owner`,
        follower,
        leaderAdapters,
        leaderPullResults,
      )
      await disposeCoordinator(leader)
      await waitFor(
        () => follower!.isLeader(`alpha`) && follower!.isLeader(`beta`),
        `adapter-bound follower takeover`,
      )
      requester = createCoordinator(dbName, requesterAdapter)
      await exercisePhase(
        `after-takeover`,
        requester,
        followerAdapters,
        followerPullResults,
      )

      // Each violation retains operation, phase, collection, and whether the
      // loss was the exact routed call or the exact response.
      expect(coordinatorRouteViolations(observed, expected)).toEqual([])
    }, [
      [
        `adapter-bound initial leader`,
        async () => {
          await disposeCoordinator(leader)
        },
      ],
      [
        `adapter-bound takeover leader`,
        async () => {
          await disposeCoordinator(follower)
        },
      ],
      [
        `adapter-bound post-takeover requester`,
        async () => {
          await disposeCoordinator(requester)
        },
      ],
    ])
  })

  async function runRoutingCampaign(
    campaign: CoordinatorOracleCampaign,
  ): Promise<void> {
    let originalFailingTrace: RoutingHistory | undefined
    let originalViolation: RouteViolation | undefined
    let targetDiscriminant: string | undefined
    const cleanupDiagnostics: Array<
      CleanupDiagnostic & { history: RoutingHistory }
    > = []
    const executionDiagnostics: Array<
      CleanupDiagnostic & { history: RoutingHistory; checkpoint: string }
    > = []
    let propertyFailure: unknown | typeof NO_PRIMARY_FAILURE =
      NO_PRIMARY_FAILURE

    try {
      await fc.assert(
        fc.asyncProperty(routingHistoryArbitrary, async (history) => {
          const plan = routingGrammarPlan(history)
          const oracle = new PerCollectionRouteOracle()
          const leaderAdapters = {
            alpha: createRecordingAdapter({
              id: plan.adapterIds.leader.alpha,
              schemaVersion: history.alphaVersion,
              policy: `sync-present-reset`,
            }),
            beta: createRecordingAdapter({
              id: plan.adapterIds.leader.beta,
              schemaVersion: history.betaVersion,
              policy: `sync-absent-error`,
            }),
          }
          const followerAdapters = {
            alpha: createRecordingAdapter({
              id: plan.adapterIds.follower.alpha,
              schemaVersion: history.alphaVersion,
              policy: `sync-present-reset`,
            }),
            beta: createRecordingAdapter({
              id: plan.adapterIds.follower.beta,
              schemaVersion: history.betaVersion,
              policy: `sync-absent-error`,
            }),
          }
          const dbName = `generated-route-${history.alphaVersion}-${history.betaVersion}`
          const initialCollection = plan.initialCollection
          let leader: BrowserCollectionCoordinator | undefined
          let follower: BrowserCollectionCoordinator | undefined
          let requester: BrowserCollectionCoordinator | undefined
          const observed: Array<RoutedApply> = []
          const expected: Array<RoutedApply> = []
          let semanticFailure: unknown | typeof NO_PRIMARY_FAILURE =
            NO_PRIMARY_FAILURE
          let checkpoint = `coordinator allocation`

          try {
            leader = createCoordinator(
              dbName,
              leaderAdapters[initialCollection],
            )
            follower = createCoordinator(
              dbName,
              followerAdapters[initialCollection],
            )

            for (const collectionId of plan.registrationOrder) {
              registerCollectionAdapter(
                leader,
                collectionId,
                leaderAdapters[collectionId],
              )
              registerCollectionAdapter(
                follower,
                collectionId,
                followerAdapters[collectionId],
              )
              oracle.register(
                `leader`,
                collectionId,
                leaderAdapters[collectionId].id,
              )
              oracle.register(
                `follower`,
                collectionId,
                followerAdapters[collectionId].id,
              )
            }

            checkpoint = `initial leadership`
            for (const collectionId of [`alpha`, `beta`] as const) {
              leader.subscribe(collectionId, () => {})
              follower.subscribe(collectionId, () => {})
              oracle.setOwner(collectionId, `leader`)
            }
            await waitFor(
              () =>
                leader!.isLeader(`alpha`) &&
                leader!.isLeader(`beta`) &&
                !follower!.isLeader(`alpha`) &&
                !follower!.isLeader(`beta`),
              `generated initial two-collection leadership`,
            )

            checkpoint = `initial routed applies`
            await requestBothCollections(
              follower,
              `initial-owner`,
              plan.firstDeliveryOrder,
            )
            observed.push(
              ...applyObservation(`initial-owner`, [
                ...leaderAdapters.alpha.calls,
                ...leaderAdapters.beta.calls,
              ]),
            )
            expected.push(
              oracle.expectedApply(`initial-owner`, `alpha`),
              oracle.expectedApply(`initial-owner`, `beta`),
            )

            checkpoint = `leadership transfer`
            await disposeCoordinator(leader)
            for (const collectionId of [`alpha`, `beta`] as const) {
              oracle.setOwner(collectionId, `follower`)
            }
            await waitFor(
              () => follower!.isLeader(`alpha`) && follower!.isLeader(`beta`),
              `generated follower takeover`,
            )

            checkpoint = `post-takeover routed applies`
            requester = createCoordinator(
              dbName,
              createRecordingAdapter({ id: `history-requester` }),
            )
            await requestBothCollections(
              requester,
              `after-takeover`,
              plan.secondDeliveryOrder,
            )
            observed.push(
              ...applyObservation(`after-takeover`, [
                ...followerAdapters.alpha.calls,
                ...followerAdapters.beta.calls,
              ]),
            )
            expected.push(
              oracle.expectedApply(`after-takeover`, `alpha`),
              oracle.expectedApply(`after-takeover`, `beta`),
            )

            const [violation] = routeViolations(observed, expected)
            if (violation) {
              const discriminant = routeViolationDiscriminant(violation)
              if (targetDiscriminant === undefined) {
                targetDiscriminant = discriminant
                originalViolation = structuredClone(violation)
                originalFailingTrace = structuredClone(history)
              }
              // A smaller candidate is a valid reduction only when it reaches
              // the same checkpoint and misroutes the same collection.
              if (discriminant === targetDiscriminant) {
                semanticFailure = new Error(
                  `per-collection route mismatch; discriminant=${discriminant}; originalViolation=${JSON.stringify(originalViolation)}; reducedViolation=${JSON.stringify(violation)}; original=${JSON.stringify(originalFailingTrace)}; reduced=${JSON.stringify(history)}; expected=${JSON.stringify(expected)}; observed=${JSON.stringify(observed)}`,
                )
              }
            }
          } catch (error) {
            executionDiagnostics.push({
              resource: `generated route execution`,
              error:
                error instanceof Error
                  ? `${error.name}: ${error.message}`
                  : String(error),
              history: structuredClone(history),
              checkpoint,
            })
          }

          const historyCleanupDiagnostics: Array<CleanupDiagnostic> = []
          await captureCleanup(
            historyCleanupDiagnostics,
            `leader coordinator`,
            async () => {
              await disposeCoordinator(leader)
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `follower coordinator`,
            async () => {
              await disposeCoordinator(follower)
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `requester coordinator`,
            async () => {
              await disposeCoordinator(requester)
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `coordinator locks`,
            async () => {
              await waitForWithoutDelivery(
                () => heldLocks.size === 0 && queuedLocks.size === 0,
                `generated history lock cleanup`,
              )
            },
          )
          await captureCleanup(
            historyCleanupDiagnostics,
            `coordinator transport`,
            () => {
              const snapshot = {
                endpoints: ControlledBroadcastChannel.endpoints.size,
                delayed: ControlledBroadcastChannel.delayed.length,
              }
              if (snapshot.endpoints !== 0 || snapshot.delayed !== 0) {
                throw new Error(JSON.stringify(snapshot))
              }
            },
          )
          cleanupDiagnostics.push(
            ...historyCleanupDiagnostics.map((diagnostic) => ({
              ...diagnostic,
              history: structuredClone(history),
            })),
          )

          if (semanticFailure !== NO_PRIMARY_FAILURE) throw semanticFailure
        }),
        campaign.parameters,
      )
    } catch (error) {
      propertyFailure = error
    }

    // Cleanup diagnostics are evaluated outside fast-check, so cleanup cannot
    // become the predicate that selects or shrinks a semantic route failure.
    expect.soft(cleanupDiagnostics).toEqual([])
    // Setup/reach/fixture failures are also reported outside the property;
    // only the locked semantic discriminant is eligible for shrinking.
    expect.soft(executionDiagnostics).toEqual([])
    if (propertyFailure !== NO_PRIMARY_FAILURE) throw propertyFailure
  }

  for (const campaign of coordinatorOracleCampaigns(`routing`)) {
    it(`uses the collection's registered adapter before and after leadership transfer (${campaign.mode})`, () =>
      runRoutingCampaign(campaign))
  }
})

type OwnershipObservation = {
  collectionId: string
  ownerAtCall?: string
}

// A source commit may apply only while the elected persistence owner holds the
// writer boundary. Collection visibility alone does not establish ownership.
function findUnownedWrites(
  observations: ReadonlyArray<OwnershipObservation>,
  electedOwner: string,
): Array<OwnershipObservation> {
  return observations.filter(
    (observation) => observation.ownerAtCall !== electedOwner,
  )
}

describe(`sync-ingested write ownership oracle`, () => {
  it(`applies a source commit through the elected persistence owner after leadership changes`, async () => {
    type Todo = { id: string; title: string }
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    let electedOwner = `tab-a`
    let activeWriter: string | undefined
    let sourceParams: SourceParams | undefined
    let ownerRequests = 0
    const adapter = createRecordingAdapter({
      id: `sync-alpha`,
      owner: () => activeWriter,
    })
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `tab-a`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => electedOwner === `tab-a`,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      // Remote subset ownership is unrelated to this write-owner law.
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyCommittedTx: async (collectionId, tx) => {
        ownerRequests++
        const ownerTx = {
          ...tx,
          term: 1,
          seq: ownerRequests,
          rowVersion: ownerRequests,
        }
        activeWriter = electedOwner
        try {
          await adapter.applyCommittedTx(
            { kind: `eager`, collectionId: collectionId },
            ownerTx,
          )
        } finally {
          activeWriter = undefined
        }
        return {
          type: `rpc:applyCommittedTx:res`,
          rpcId: `owned-${ownerRequests}`,
          ok: true,
          term: 1,
          seq: ownerRequests,
          latestRowVersion: ownerRequests,
        }
      },
    }
    let cleanupCollection: (() => Promise<void>) | undefined

    await withFailurePreservingCleanup(async () => {
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `sync-alpha`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      cleanupCollection = () => collection.cleanup()
      collection.startSyncImmediate()
      await waitForWithoutDelivery(
        () => sourceParams !== undefined,
        `wrapped source controls`,
      )

      // Legal leadership history: the original tab loses ownership before an
      // external source callback ingests its next transaction.
      electedOwner = `tab-b`
      sourceParams!.begin()
      sourceParams!.write({
        type: `insert`,
        value: { id: `sync-1`, title: `from source` },
      })
      const receipt = sourceParams!.commit()
      if (receipt !== true) await receipt

      const applies = adapter.calls
        .filter(({ operation }) => operation === `apply`)
        .map(({ collectionId, ownerAtCall }) => ({
          collectionId,
          ownerAtCall,
        }))

      // Positive production reach: the source write became collection-visible
      // and reached exactly one persistence apply call.
      expect(collection.get(`sync-1`)).toMatchObject({
        id: `sync-1`,
        title: `from source`,
      })
      expect(applies).toHaveLength(1)
      // Ownership checkpoint: a direct-adapter bypass runs outside the elected
      // tab-b writer scope. Owner-routed implementations pass this unchanged
      // regardless of request count.
      expect(findUnownedWrites(applies, electedOwner)).toEqual([])
    }, [
      [
        `sync-ingested collection`,
        async () => {
          await cleanupCollection?.()
        },
      ],
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

/*
Follower remote-demand settlement across real tabs
==================================================

Law and source: the applied-settlement law (law 7 in
packages/db/src/query/live/ARCHITECTURE.md) for a follower tab. A follower
routes on-demand demand it cannot serve to the elected owner. Its load, and so
its live query's first ready, settles only when the rows the owner fetched for
it are visible in the follower; if applying the owner's commit fails here, the
load rejects and the follower's source enters error. The single-runtime
`persistence.follower-remote-demand` lane and the follower generation-notice
cells in db-sqlite-persistence-core/tests/persisted-oracle.test.ts own the
runtime mechanism with a coordinator double. The generation-notice cells are
fixed histories: their rotation cell is pinned as failing under the known gap
#2139, and the fix adds their generated campaign back. This lane is their
receiving witness
across the real boundary: two tabs, each with its own real
BrowserCollectionCoordinator over Node's real BroadcastChannel and Web Locks,
and one real SQLite file opened by both tabs.

Independent model: it knows only whether the owner's commit applies in the
follower. While that apply is outstanding, the consumer has not settled. If it
applies, the consumer settles successfully with the owner's row. If it fails,
the consumer rejects without the row. The failed apply is a local persistence
failure, so the follower source crashes.

Grammar: the owner's source is a receipt-awaiting custom source or a real
Query Collection source, crossed with the placement of the owner's broadcast
in the follower (direct, or queued while another subset's hydration holds the
apply mutex), crossed with whether the follower's durable read of that commit
succeeds, crossed with the consumer (a live query, or the follower's load).
The driver holds or fails the first follower read whose rows contain the
owner's row, and for the queued placement it holds the other subset's
hydration read. It does not reorder the channel, which stays FIFO as in a
browser. The custom source delivers each row once; a source that re-inserts
an existing row on every ensure made the follower release and request its
demand again without end, on main as well, and is outside this lane.

Checkpoint and observations: once the owner's reply has reached the follower
and the apply is still outstanding, whether the consumer has settled. After
release: its outcome, the demanded rows it saw when it settled (first-ready
rows, or rows at load settlement), and the follower source's status. A live
query cannot show a load that succeeded after a failed apply, because the
failure errors the source; the load consumer observes it directly.

Calibration: main's persisted.ts (load settles at the reply) fails all 16
histories at the checkpoint. Removing the follower's wait fails all 16.
Removing the terminal check after the wait fails the 4 load histories whose
apply fails. The Query Collection histories pass, so query-db's
`whenSyncAccepted` wait resolves after the owner's broadcast under real
persistence.

Rotation: when only the follower's claim expires, it rotates into a
generation no other tab joins and becomes that generation's owner. The
rotation cell pins that its rows stay visible and new demand settles from its
own source. Another tab never owns the rotated generation in this topology,
so the elected-owner notice path has no receiving witness here.
*/

type RealTabPlacement = `direct` | `queued`
type RealTabHistory = {
  source: RealTabSource
  placement: RealTabPlacement
  apply: `ok` | `fails`
  // A live query over the demand, or the follower Collection's load itself.
  consumer: `live-query` | `load`
}

function expectedRealTabFollower(history: RealTabHistory) {
  const applied = history.apply === `ok`
  return {
    settledWhileApplyHeld: false,
    settled: {
      outcome: applied ? `fulfilled` : `rejected`,
      rows: applied ? [`remote`] : undefined,
      source: applied ? `ready` : `crashed`,
    },
  }
}

function createDeferredVoid() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  void promise.catch(() => undefined)
  return { promise, resolve, reject }
}

function assertRealTabFollowerHistory(history: RealTabHistory): Promise<void> {
  return withNativeBrowserTransport(() => runRealTabFollowerHistory(history))
}

async function runRealTabFollowerHistory(
  history: RealTabHistory,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), `db-real-tab-follower-`))
  const filename = join(directory, `tabs.sqlite`)
  const dbName = `real-tab-follower-${Math.random().toString(36).slice(2)}`
  const upstream = new Map<string, RealTabRow>([
    [`remote`, { id: `remote`, group: `a` }],
  ])
  const applyGate = createDeferredVoid()
  const hydrationGate = createDeferredVoid()
  const upstreamGate = createDeferredVoid()
  let gateApply = false
  let applyReached = false
  let hydrationReached = false
  let gateHydration = false
  let holdLeaderUpstream = false
  const applyFailure = new Error(`follower apply read failed`)
  const tabs: Array<ReturnType<typeof createRealTab>> = []
  const queries: Array<{ cleanup: () => Promise<void> }> = []
  try {
    const leader = createRealTab({
      dbName,
      filename,
      source: history.source,
      upstream,
      holdUpstream: () =>
        holdLeaderUpstream ? upstreamGate.promise : Promise.resolve(),
    })
    tabs.push(leader)
    leader.collection.startSyncImmediate()
    await leader.collection.stateWhenReady()
    const follower = createRealTab({
      dbName,
      filename,
      source: history.source,
      upstream,
      readGate: async (rows) => {
        if (gateHydration) {
          gateHydration = false
          hydrationReached = true
          await hydrationGate.promise
          return
        }
        if (gateApply && JSON.stringify(rows).includes(`remote`)) {
          gateApply = false
          applyReached = true
          await applyGate.promise
          if (history.apply === `fails`) throw applyFailure
        }
      },
    })
    tabs.push(follower)
    follower.collection.startSyncImmediate()

    await vi.waitFor(() => expect(follower.storageCollectionId()).toBeDefined())
    gateApply = true
    if (history.placement === `queued`) holdLeaderUpstream = true
    // The consumer settles at first ready (live query) or when the load
    // settles; `rows` are the demanded rows it sees at that moment.
    let settledAt: { rows: Array<string> } | undefined
    let outcome: Promise<`fulfilled` | `rejected`>
    if (history.consumer === `live-query`) {
      const query = createLiveQueryCollection((q) =>
        q
          .from({ item: follower.collection })
          .where(({ item }) => eq(item.id, `remote`)),
      )
      queries.push(query)
      query.onFirstReady(() => {
        settledAt = { rows: query.toArray.map((row) => row.id).sort() }
      })
      outcome = query.preload().then(
        () => `fulfilled` as const,
        () => `rejected` as const,
      )
    } else {
      outcome = Promise.resolve(
        follower.collection._sync.loadSubset({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`id`]),
            new IR.Value(`remote`),
          ]),
        }),
      ).then(
        () => {
          settledAt = {
            rows: follower.collection.has(`remote`) ? [`remote`] : [],
          }
          return `fulfilled` as const
        },
        () => `rejected` as const,
      )
    }
    if (history.placement === `queued`) {
      // While the owner's upstream load is held, another subset's hydration
      // takes the follower's apply mutex. The owner's broadcast then arrives
      // queued behind it.
      await vi.waitFor(
        () => {
          expect(follower.trace).toContain(`ensure`)
          expect(leader.trace).toContain(`upstream`)
        },
        { timeout: 15_000 },
      )
      gateHydration = true
      const other = createLiveQueryCollection((q) =>
        q
          .from({ item: follower.collection })
          .where(({ item }) => eq(item.id, `other`)),
      )
      queries.push(other)
      void other.preload().catch(() => undefined)
      await vi.waitFor(() => expect(hydrationReached).toBe(true), {
        timeout: 15_000,
      })
      holdLeaderUpstream = false
      upstreamGate.resolve()
    }
    // Checkpoint: the owner's reply has reached the follower, and the apply
    // of the owner's commit is still outstanding here: a direct broadcast's
    // durable read is held, or a queued broadcast waits behind the held
    // hydration. The model says the query has not reached first ready.
    await vi.waitFor(
      () => {
        expect(
          history.placement === `direct` ? applyReached : hydrationReached,
        ).toBe(true)
        expect(follower.trace).toContain(`ensure-settled`)
      },
      { timeout: 15_000 },
    )
    for (let turn = 0; turn < 20; turn++) await nextTurn()
    const expected = expectedRealTabFollower(history)
    expect(settledAt !== undefined).toBe(expected.settledWhileApplyHeld)
    hydrationGate.resolve()
    applyGate.resolve()
    const settled = await outcome
    await vi.waitFor(() =>
      expect(follower.collection.status).toBe(expected.settled.source),
    )
    expect({
      outcome: settled,
      rows: settledAt?.rows,
      source: follower.collection.status,
    }).toEqual(expected.settled)
  } finally {
    hydrationGate.resolve()
    applyGate.resolve()
    upstreamGate.resolve()
    for (const query of queries) await query.cleanup().catch(() => undefined)
    for (const tab of tabs.reverse()) await tab.cleanup().catch(() => undefined)
    rmSync(directory, { recursive: true, force: true })
  }
}

describe(`follower remote-demand settlement across real tabs`, () => {
  const histories: Array<RealTabHistory> = []
  for (const source of [`receipt`, `query-db`] as const)
    for (const placement of [`direct`, `queued`] as const)
      for (const apply of [`ok`, `fails`] as const)
        for (const consumer of [`live-query`, `load`] as const)
          histories.push({ source, placement, apply, consumer })
  it.each(histories)(
    `settles a follower $consumer with the owner's rows: $source source, $placement, apply $apply`,
    (history) => assertRealTabFollowerHistory(history),
    20_000,
  )
})

// The parts this file defines. The checks compare production observations
// with the expectations that the models and grammars produce; the models are
// independent of the coordinator and its adapter routing. Declared last
// because the model classes are defined above and cannot be read earlier.
declareOracle({
  check: [
    subsetWireViolations,
    subsetAckViolations,
    remoteLeaseTakeoverViolations,
    collectionScopedLeaseViolations,
    remoteLeaseHistoryViolations,
    rawSnapshotViolations,
    freshInitViolations,
    coordinatorRouteViolations,
    routeViolations,
    findUnownedWrites,
    runRealTabFollowerHistory,
  ],
  model: [
    RemoteLeaseOwnerLedger,
    PerCollectionRouteOracle,
    expectedRealTabFollower,
  ],
})
