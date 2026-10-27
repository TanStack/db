/**
 * # Which Browser coordinator outcomes are safe to acknowledge?
 *
 * RFC #1659 requires every adapter operation to use the elected owner for its
 * collection. Complete committed transactions must cross that boundary
 * without losing metadata. A mutating RPC may replay only through the same
 * known leader and term, and one envelope id cannot identify two mutation
 * request types. Remote subset request data must be clone-safe, and each
 * accepted physical acquisition creates one exact acquisition lease. Retained
 * coordinator demand survives remote-owner replacement; each replacement
 * acquisition has its own lease and release obligation. The Collection-level
 * mapping is documented in `per-collection-coordinator-oracle.test.ts`. A
 * passive heartbeat can update a route, but only a local participant may join
 * that collection's leadership. After a no-write handoff, a passive follower
 * that accepted the successor keeps that route through a delayed former
 * heartbeat. The Web Lock holder also keeps its own route. A mutation
 * requested before the first leader
 * is known waits for a route up to the RPC deadline. The sole participant
 * applies it locally if elected; an unsuccessful election cannot hold it forever.
 * A late follower requests the leader route without sending a mutation. A
 * current leader answers before its next periodic heartbeat is due.
 * Election must still finish when scheduled hydration awaits that first
 * source commit, even when a different collection has a queued write. Regular
 * work must enter the shared scheduler before taking the database-wide writer
 * lock. A queued write must recheck ownership before persistence if leadership
 * changes while it waits. Durable stream positions advance after the adapter
 * accepts the write, and failed release transport retains its retry route.
 *
 * The adapter call logs, transport controls, owner callbacks, and internal-map
 * snapshots are focused reference ledgers. Histories vary local and follower
 * routes, response loss, leadership change, owner replacement, duplicate
 * delivery, paced leadership retry, release, failure, and disposal. The
 * production driver is the real `BrowserCollectionCoordinator`, which names
 * the shared broadcast coordination engine for this host; only
 * BroadcastChannel and Web Locks are replaced with deterministic seams.
 *
 * Checkpoints sit at adapter entry, RPC response delivery, acquisition
 * acceptance, acquisition release, lifecycle failure, and disposal. Fault
 * controls drop or duplicate messages, reject owner work, change leaders, and
 * advance the released-tombstone clock. Exact call counts and error identities
 * prevent a final-state-only false green.
 *
 * Known omissions: the composed public-Collection and generated route models
 * live in `per-collection-coordinator-oracle.test.ts`. These seams do not prove
 * real browser scheduling, Web Locks, BroadcastChannel, OPFS ownership, or
 * worker behavior. Bounded replay retry is covered for retryable transport and
 * admission failures, including cancellation on release and disposal.
 *
 * Fixed scenarios with literal expectations live in
 * `browser-coordinator.test.ts`. This file keeps the generated histories and
 * the per-election need cells, which check their laws against a model or a
 * generated history.
 */

import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-config'
import {
  bindTransportControls,
  cleanupGlobals,
  createCoordinator,
  createDeferred,
  createQueuedReadAdapter,
  createStubAdapter,
  durableTerms,
  flush,
  inspectCoordinator,
  installGlobals,
  liveCoordinators,
  withUnusedUnloadSubset,
} from './browser-coordinator-support'
import type { BrowserCollectionCoordinator } from '../src/browser-coordinator'
import type { PersistedTx } from '@tanstack/db-sqlite-persistence-core'

let dropNextMessageWhen: ((data: unknown) => boolean) | undefined
let observePostedMessage: ((data: unknown) => void) | undefined
let dropNextBroadcastMessage: ((data: unknown) => boolean) | undefined
let duplicateNextBroadcastMessage:
  ((data: unknown) => unknown | undefined) | undefined
let observeBroadcastMessage: ((data: unknown) => void) | undefined
// The mock in browser-coordinator-support.ts reads and clears these transport
// controls. The binding lets this file's tests assign them directly.
bindTransportControls({
  get dropNextMessageWhen() {
    return dropNextMessageWhen
  },
  set dropNextMessageWhen(value) {
    dropNextMessageWhen = value
  },
  get observePostedMessage() {
    return observePostedMessage
  },
  set observePostedMessage(value) {
    observePostedMessage = value
  },
  get dropNextBroadcastMessage() {
    return dropNextBroadcastMessage
  },
  set dropNextBroadcastMessage(value) {
    dropNextBroadcastMessage = value
  },
  get duplicateNextBroadcastMessage() {
    return duplicateNextBroadcastMessage
  },
  set duplicateNextBroadcastMessage(value) {
    duplicateNextBroadcastMessage = value
  },
  get observeBroadcastMessage() {
    return observeBroadcastMessage
  },
  set observeBroadcastMessage(value) {
    observeBroadcastMessage = value
  },
})

/**
 * Law: a leadership need posts one RPC of its request kind. A remote
 * `ensureRemoteSubset` need may post several, all under one acquisition ID.
 * A holder's own need, and `ensureLeadership`, post nothing. The expected
 * posts come from the need table, not from production.
 */
function compareNeedPosts(
  kind: string,
  need: { readonly request: string | undefined },
  callerIsHolder: boolean,
  posts: ReadonlyArray<{ acquisitionId?: string }>,
): void {
  if (need.request === undefined || callerIsHolder) {
    expect(posts).toEqual([])
  } else if (kind === `remote subset`) {
    expect(posts.length).toBeGreaterThan(0)
    expect(new Set(posts.map((post) => post.acquisitionId)).size).toBe(1)
  } else {
    expect(posts).toHaveLength(1)
  }
}
declareOracle({ check: [compareNeedPosts] })

describe(`BrowserCollectionCoordinator`, () => {
  beforeEach(() => {
    installGlobals()
  })

  afterEach(async () => {
    for (const coordinator of liveCoordinators) coordinator.dispose()
    liveCoordinators.clear()
    await flush(0)
    cleanupGlobals()
  })

  /**
   * # When may an election wait behind queued reads?
   *
   * Law: a Web Lock holder reserves its durable election term only after the
   * reads already queued on its shared scheduler, unless some caller needs a
   * leader first. A leadership need ends that wait at once: a local route
   * wait, an outbound RPC, `ensureLeadership`, or an inbound route request or
   * RPC from another tab. Without that rule, a hydrate that waits for its
   * first writer route would wait for an election that waits for the hydrate.
   * A need belongs to one election: it is still waiting at the grant, or it
   * arrives before the term. A need that an earlier leader served, for this
   * tab or another, does not exempt a later election. The lock is exclusive,
   * so its holder has no route to another leader: a delayed heartbeat from
   * the departed leader does not restore one, and a request made during the
   * election is a need.
   *
   * Model: the reference is the need table below. Every listed request is a
   * leadership need, so the term must exist while the queued read is still
   * held. The read is a deferred hydrate: the scheduler barrier
   * (`runInRegularScope.afterQueuedWork`) and all regular work wait for it,
   * so it also holds the leader-side write for mutating requests. After
   * the read is released, each request settles well before the RPC timeout.
   * A remote request posts one RPC of its kind. Remote subset demand may also
   * replay once when its first leader becomes known; every post carries the
   * same acquisition ID, and the lease oracle owns exact lease accounting.
   *
   * Grammar: each request kind × a local requester (the lock holder itself)
   * or a remote requester (a later tab whose lock request is queued). Remote
   * `ensureLeadership` is excluded: the holder keeps the lock, so the remote
   * caller has no route to its own leadership. Release of an unacquired
   * subset sends no RPC and is not a leadership need.
   *
   * Checkpoints: before the request (premise: no term while the read is
   * held), after bounded turns with the read still held (term and route), and
   * after release (settlement and RPC count). Hostile mutants that skip any
   * need mark fail the held-read checkpoint or the settlement deadline.
   *
   * Per-election cells: a follower takes over from a leader that served an
   * earlier need, from another tab or from the follower itself, while the
   * follower's queued read is held. The model has no term until the read is
   * released. A third cell delivers the departed leader's heartbeat during
   * the follower's election and then makes a request; the model has the
   * follower's term while the read is still held.
   */
  describe(`leadership need under a queued read`, () => {
    const collectionId = `needed`

    const transaction = (txId: string): PersistedTx => ({
      txId,
      term: 0,
      seq: 0,
      rowVersion: 0,
      mutations: [{ type: `insert`, key: txId, value: { id: txId } }],
    })

    const leadershipNeeds = {
      'local mutation': {
        request: `rpc:applyLocalMutations:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.requestApplyLocalMutations(collectionId, [
            {
              mutationId: `needed-mutation`,
              type: `insert`,
              key: `needed-mutation`,
              value: { id: `needed-mutation` },
            },
          ]),
      },
      'source commit': {
        request: `rpc:applyCommittedTx:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.requestApplyCommittedTx(
            collectionId,
            transaction(`needed-commit`),
          ),
      },
      reconciliation: {
        request: `rpc:reconcileCommittedTx:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.reconcileCommittedTx(
            collectionId,
            transaction(`needed-reconcile`),
            { latestRowVersion: 0, resetEpoch: 0 },
          ),
      },
      'remote subset': {
        request: `rpc:ensureRemoteSubset:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.requestEnsureRemoteSubset(collectionId, { limit: 1 }),
      },
      pullSince: {
        request: `rpc:pullSince:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.pullSince(collectionId, 0),
      },
      'persisted index': {
        request: `rpc:ensurePersistedIndex:req`,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.requestEnsurePersistedIndex(collectionId, `needed-idx`, {
            expressionSql: [`id`],
          }),
      },
      ensureLeadership: {
        request: undefined,
        run: (coordinator: BrowserCollectionCoordinator) =>
          coordinator.ensureLeadership(collectionId),
      },
    } as const

    const cells = Object.keys(leadershipNeeds).flatMap((kind) =>
      (kind === `ensureLeadership`
        ? ([`local`] as const)
        : ([`local`, `remote`] as const)
      ).map((requester) => ({
        kind: kind as keyof typeof leadershipNeeds,
        requester,
      })),
    )

    it.each(cells)(
      `elects for a $requester $kind while a queued read holds the scheduler`,
      async ({ kind, requester }) => {
        const need = leadershipNeeds[kind]
        const { adapter, queuedRead } = createQueuedReadAdapter()
        const holder = createCoordinator(adapter)
        holder.registerRemoteSubsetOwner(
          collectionId,
          withUnusedUnloadSubset(async () => {}),
        )
        holder.subscribe(collectionId, () => {})
        await flush(20)
        const caller =
          requester === `local` ? holder : createCoordinator(adapter)
        if (caller !== holder) caller.subscribe(collectionId, () => {})
        await flush(20)
        // Premise: the holder has the Web Lock, but its term waits behind
        // the queued read because no caller has needed a leader yet.
        expect(durableTerms.get(collectionId)).toBeUndefined()
        expect(holder.isLeader(collectionId)).toBe(false)

        const posts: Array<{ acquisitionId?: string }> = []
        observePostedMessage = (data) => {
          const payload = (
            data as { payload?: { type?: string; acquisitionId?: string } }
          ).payload
          if (need.request !== undefined && payload?.type === need.request) {
            posts.push({ acquisitionId: payload.acquisitionId })
          }
        }
        let settled = false
        const pending = Promise.resolve(need.run(caller)).finally(() => {
          settled = true
        })
        void pending.catch(() => undefined)
        try {
          await flush(50)
          // The need ended the wait before the read finished.
          expect(durableTerms.get(collectionId)).toBe(1)
          expect(holder.isLeader(collectionId)).toBe(true)
          expect(caller.isLeader(collectionId)).toBe(caller === holder)

          queuedRead.resolve()
          await Promise.race([pending, flush(1_000)])
          expect(settled).toBe(true)
          await pending
          compareNeedPosts(kind, need, caller === holder, posts)
        } finally {
          queuedRead.resolve()
          observePostedMessage = undefined
          // A request stuck on an RPC timeout must not hide the assertion;
          // disposal in afterEach rejects it.
          await Promise.race([pending.catch(() => undefined), flush(0)])
        }
      },
    )
  })

  describe(`RPC - applyLocalMutations`, () => {
    it(`preserves one durable mutation result across generated response-delivery histories`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              mutationCount: fc.integer({ min: 1, max: 4 }),
              dropFirstSuccess: fc.boolean(),
            }),
            async ({ mutationCount, dropFirstSuccess }) => {
              run++
              const collectionId = `delivery-history-${run}`
              const adapter = createStubAdapter()
              let leadershipRead!: () => void
              const leadershipReadPromise = new Promise<void>((resolve) => {
                leadershipRead = resolve
              })
              let firstSuccessDropped!: () => void
              const firstSuccessDroppedPromise = new Promise<void>(
                (resolve) => {
                  firstSuccessDropped = resolve
                },
              )
              adapter.getStreamPosition = async () => {
                leadershipRead()
                return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
              }

              const leader = createCoordinator(adapter)
              const follower = createCoordinator(adapter)
              try {
                leader.subscribe(collectionId, () => {})
                await leadershipReadPromise
                await Promise.resolve()
                follower.subscribe(collectionId, () => {})

                if (dropFirstSuccess) {
                  dropNextMessageWhen = (data) => {
                    const payload = (
                      data as { payload?: { type?: string; ok?: boolean } }
                    ).payload
                    if (
                      payload?.type === `rpc:applyLocalMutations:res` &&
                      payload.ok === true
                    ) {
                      firstSuccessDropped()
                      return true
                    }
                    return false
                  }
                }

                const mutations = Array.from(
                  { length: mutationCount },
                  (_, index) => ({
                    mutationId: `mut-${run}-${index}`,
                    type: `insert` as const,
                    key: `${index}`,
                    value: { id: `${index}`, title: `row ${index}` },
                  }),
                )
                const responsePromise = follower.requestApplyLocalMutations(
                  collectionId,
                  mutations,
                )
                if (dropFirstSuccess) {
                  await firstSuccessDroppedPromise
                  await vi.advanceTimersByTimeAsync(10_200)
                }

                const response = await responsePromise
                expect(response).toMatchObject({
                  ok: true,
                  acceptedMutationIds: mutations.map(
                    (mutation) => mutation.mutationId,
                  ),
                })
                expect(adapter.appliedTxs).toHaveLength(1)
              } finally {
                dropNextMessageWhen = undefined
                follower.dispose()
                leader.dispose()
                for (let microtask = 0; microtask < 4; microtask++) {
                  await Promise.resolve()
                }
              }
            },
          ),
          { seed: 1868, numRuns: 12, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe(`RPC - ensurePersistedIndex`, () => {
    it(`routes generated collection and RPC histories through their owning adapter`, async () => {
      let run = 0
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 4 }).chain((collectionCount) =>
            fc.record({
              collectionCount: fc.constant(collectionCount),
              registrationOrder: fc.shuffledSubarray(
                Array.from({ length: collectionCount }, (_, index) => index),
                { minLength: collectionCount, maxLength: collectionCount },
              ),
              targetIndex: fc.integer({ min: 0, max: collectionCount - 1 }),
              rpcKind: fc.constantFrom(`index`, `pull`, `mutation`),
            }),
          ),
          async ({
            collectionCount,
            registrationOrder,
            targetIndex,
            rpcKind,
          }) => {
            run++
            const collectionIds = Array.from(
              { length: collectionCount },
              (_, index) => `routing-${run}-${index}`,
            )
            const adapters = collectionIds.map(() => createStubAdapter())
            const ensureCalls = adapters.map(() => vi.fn())
            const pullCalls = adapters.map(() => vi.fn())
            adapters.forEach((adapter, index) => {
              adapter.ensureIndex =
                ensureCalls[index]!.mockResolvedValue(undefined)
              adapter.pullSince = pullCalls[index]!.mockResolvedValue({
                latestRowVersion: index,
                requiresFullReload: false,
                changedKeys: [],
                deletedKeys: [],
              })
            })

            let leadershipRead!: () => void
            const leadershipReadPromise = new Promise<void>((resolve) => {
              leadershipRead = resolve
            })
            adapters[targetIndex]!.getStreamPosition = async () => {
              leadershipRead()
              return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
            }

            const leader = createCoordinator(adapters[0])
            const follower = createCoordinator(adapters.at(-1))
            const targetCollectionId = collectionIds[targetIndex]!
            try {
              for (const index of registrationOrder) {
                leader.setAdapterForCollection(
                  collectionIds[index]!,
                  adapters[index]!,
                )
              }
              leader.subscribe(targetCollectionId, () => {})
              await leadershipReadPromise
              await vi.waitFor(() =>
                expect(leader.isLeader(targetCollectionId)).toBe(true),
              )
              follower.subscribe(targetCollectionId, () => {})

              if (rpcKind === `index`) {
                await follower.requestEnsurePersistedIndex(
                  targetCollectionId,
                  `idx-${run}`,
                  { expressionSql: [`title`] },
                )
              } else if (rpcKind === `pull`) {
                await follower.pullSince(targetCollectionId, 0)
              } else {
                const response = await follower.requestApplyLocalMutations(
                  targetCollectionId,
                  [
                    {
                      mutationId: `mut-${run}`,
                      type: `insert`,
                      key: `${run}`,
                      value: { id: `${run}`, title: `row ${run}` },
                    },
                  ],
                )
                expect(response.ok).toBe(true)
              }

              adapters.forEach((adapter, index) => {
                const callCount =
                  rpcKind === `index`
                    ? ensureCalls[index]!.mock.calls.length
                    : rpcKind === `pull`
                      ? pullCalls[index]!.mock.calls.length
                      : adapter.appliedTxs.length
                expect(callCount).toBe(index === targetIndex ? 1 : 0)
              })
            } finally {
              follower.dispose()
              leader.dispose()
              for (let microtask = 0; microtask < 4; microtask++) {
                await Promise.resolve()
              }
            }
          },
        ),
        { seed: 1868, numRuns: 18, endOnFailure: true },
      )
    })
  })

  describe(`dispose`, () => {
    it(`makes disposal terminal across generated RPC kinds and lifecycle phases`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              rpcKind: fc.constantFrom(`index`, `pull`, `mutation`),
              disposePhase: fc.constantFrom(
                `before-request`,
                `pending`,
                `retry-delay`,
              ),
            }),
            async ({ rpcKind, disposePhase }) => {
              run++
              const collectionId = `dispose-history-${run}`
              const adapter = createStubAdapter()
              let leadershipRead!: () => void
              const leadershipReadPromise = new Promise<void>((resolve) => {
                leadershipRead = resolve
              })
              let firstRequestPosted!: () => void
              const firstRequestPostedPromise = new Promise<void>((resolve) => {
                firstRequestPosted = resolve
              })
              adapter.getStreamPosition = async () => {
                leadershipRead()
                return { latestTerm: 0, latestSeq: 0, latestRowVersion: 0 }
              }

              const leader = createCoordinator(adapter)
              const follower = createCoordinator(adapter)
              let requestPosts = 0
              const requestType =
                rpcKind === `index`
                  ? `rpc:ensurePersistedIndex:req`
                  : rpcKind === `pull`
                    ? `rpc:pullSince:req`
                    : `rpc:applyLocalMutations:req`

              try {
                leader.subscribe(collectionId, () => {})
                await leadershipReadPromise
                await Promise.resolve()
                follower.subscribe(collectionId, () => {})

                observePostedMessage = (data) => {
                  if (
                    (data as { payload?: { type?: string } }).payload?.type ===
                    requestType
                  ) {
                    requestPosts++
                    if (requestPosts === 1) firstRequestPosted()
                  }
                }
                dropNextMessageWhen = (data) =>
                  (data as { payload?: { type?: string } }).payload?.type ===
                  requestType

                if (disposePhase === `before-request`) {
                  follower.dispose()
                }
                const request =
                  rpcKind === `index`
                    ? follower.requestEnsurePersistedIndex(
                        collectionId,
                        `idx-${run}`,
                        { expressionSql: [`title`] },
                      )
                    : rpcKind === `pull`
                      ? follower.pullSince(collectionId, 0)
                      : follower.requestApplyLocalMutations(collectionId, [
                          {
                            mutationId: `mut-${run}`,
                            type: `insert`,
                            key: `${run}`,
                            value: { id: `${run}`, title: `row ${run}` },
                          },
                        ])
                const settled = request.then(
                  () => `resolved` as const,
                  () => `rejected` as const,
                )

                if (disposePhase !== `before-request`) {
                  await firstRequestPostedPromise
                  if (disposePhase === `retry-delay`) {
                    await vi.advanceTimersByTimeAsync(10_000)
                  }
                  follower.dispose()
                }

                await expect(settled).resolves.toBe(`rejected`)
                expect(requestPosts).toBe(
                  disposePhase === `before-request` ? 0 : 1,
                )
              } finally {
                observePostedMessage = undefined
                dropNextMessageWhen = undefined
                follower.dispose()
                leader.dispose()
                for (let microtask = 0; microtask < 4; microtask++) {
                  await Promise.resolve()
                }
              }
            },
          ),
          { seed: 1868, numRuns: 18, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe(`collection and retry-result retention`, () => {
    it(`releases generated collection-owned state after the last subscriber`, async () => {
      let run = 0
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 4 }).chain((collectionCount) =>
            fc.record({
              collectionCount: fc.constant(collectionCount),
              releaseOrder: fc.shuffledSubarray(
                Array.from({ length: collectionCount }, (_, index) => index),
                { minLength: collectionCount, maxLength: collectionCount },
              ),
            }),
          ),
          async ({ collectionCount, releaseOrder }) => {
            run++
            const coordinator = createCoordinator()
            const collectionIds = Array.from(
              { length: collectionCount },
              (_, index) => `lifecycle-${run}-${index}`,
            )
            const readyCollections = new Set<string>()
            const allReady = createDeferred()
            observePostedMessage = (data) => {
              const envelope = data as {
                collectionId?: string
                payload?: { type?: string }
              }
              if (
                envelope.payload?.type === `leader:heartbeat` &&
                envelope.collectionId &&
                collectionIds.includes(envelope.collectionId)
              ) {
                readyCollections.add(envelope.collectionId)
                if (readyCollections.size === collectionCount) {
                  allReady.resolve()
                }
              }
            }
            for (const collectionId of collectionIds) {
              coordinator.setAdapterForCollection(
                collectionId,
                createStubAdapter(),
              )
            }
            const releases = collectionIds.map((collectionId) =>
              coordinator.subscribe(collectionId, () => {}),
            )

            try {
              await allReady.promise
              observePostedMessage = undefined
              expect(
                inspectCoordinator(coordinator).collectionAdapters.size,
              ).toBe(collectionCount)

              let remaining = collectionCount
              for (const releasedIndex of releaseOrder) {
                releases[releasedIndex]!()
                remaining--
                expect({
                  adapters:
                    inspectCoordinator(coordinator).collectionAdapters.size,
                  collections: inspectCoordinator(coordinator).collections.size,
                }).toEqual({
                  adapters: remaining,
                  collections: remaining,
                })
              }
            } finally {
              observePostedMessage = undefined
              for (const release of releases) release()
              coordinator.dispose()
            }
          },
        ),
        { seed: 1868, numRuns: 12, endOnFailure: true },
      )
    })

    it(`bounds generated retry-result histories by retention and collection lifecycle`, async () => {
      vi.useFakeTimers()
      let run = 0
      try {
        await fc.assert(
          fc.asyncProperty(
            fc.record({
              mutationCount: fc.integer({ min: 1, max: 4 }),
              terminal: fc.constantFrom(`retention`, `unsubscribe`, `dispose`),
            }),
            async ({ mutationCount, terminal }) => {
              run++
              vi.setSystemTime(0)
              const adapter = createStubAdapter()
              const coordinator = createCoordinator(adapter)
              const collectionId = `envelope-retention-${run}`
              const ready = createDeferred()
              observePostedMessage = (data) => {
                const envelope = data as {
                  collectionId?: string
                  payload?: { type?: string }
                }
                if (
                  envelope.collectionId === collectionId &&
                  envelope.payload?.type === `leader:heartbeat`
                ) {
                  ready.resolve()
                }
              }
              const release = coordinator.subscribe(collectionId, () => {})

              try {
                await ready.promise
                observePostedMessage = undefined
                for (let index = 0; index < mutationCount; index++) {
                  await coordinator.requestApplyLocalMutations(collectionId, [
                    {
                      mutationId: `mutation-${run}-${index}`,
                      type: `insert`,
                      key: `${index}`,
                      value: { id: `${index}`, title: `row ${index}` },
                    },
                  ])
                }
                expect(
                  inspectCoordinator(coordinator).appliedEnvelopes.size,
                ).toBe(mutationCount)

                if (terminal === `retention`) {
                  await vi.advanceTimersByTimeAsync(60_000)
                } else if (terminal === `unsubscribe`) {
                  release()
                } else {
                  coordinator.dispose()
                }

                expect(
                  inspectCoordinator(coordinator).appliedEnvelopes.size,
                ).toBe(0)
              } finally {
                observePostedMessage = undefined
                release()
                coordinator.dispose()
                vi.clearAllTimers()
              }
            },
          ),
          { seed: 1868, numRuns: 12, endOnFailure: true },
        )
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
