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
import {
  bindTransportControls,
  cleanupGlobals,
  createCoordinator,
  createDeferred,
  createStubAdapter,
  flush,
  inspectCoordinator,
  installGlobals,
  liveCoordinators,
} from './browser-coordinator-support'

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
