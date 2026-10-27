/**
 * Ordinary regression tests for persisted follower hydration and persisted index lifecycle, as fixed scenarios. The follower and index laws are owned by persisted-oracle.test.ts, which keeps the generated follower and index histories.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  BasicIndex,
  IR,
  SyncTransactionAbortedError,
  createCollection,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  InvalidPersistedCollectionConfigError,
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
  toTransportedLoadSubsetOptions,
} from '../src'
import { Temporal } from './temporal-value-oracle'
import {
  atPersistedOracleCheckpoint,
  cleanupPersistedOracle,
  createCoordinatorHarness,
  createDeferred,
  createEventGate,
  createFailStopCoordinatorHarness,
  createLocalCoordinatorHarness,
  createRecordingAdapter,
  flushAsyncWork,
  recordedStorageId,
  stripVirtualProps,
} from './persisted-support'
import type {
  PersistedCollectionCoordinator,
  PullSinceResponse,
  RemoteSubsetOwner,
  TxCommitted,
} from '../src'
import type { LoadSubsetOptions, PendingMutation } from '@tanstack/db'
import type { Todo, TodoSyncParams } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`hydrates a multiprocess follower locally while only the elected owner acquires remote demand`, async () => {
    const adapter = createRecordingAdapter([
      { id: `persisted`, title: `Persisted follower row` },
    ])
    let releaseRemoteLoad = (): void => {}
    const remoteLoadGate = new Promise<void>((resolve) => {
      releaseRemoteLoad = resolve
    })
    let registeredOwner: RemoteSubsetOwner | undefined
    const ensureRemote = vi.fn(() => remoteLoadGate)
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensureRemote,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: (_collectionId, owner) => {
        registeredOwner = owner
        return () => {
          if (registeredOwner === owner) registeredOwner = undefined
        }
      },
    }
    const followerUpstreamLoad = vi.fn(() => Promise.resolve())
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `multiprocess-follower-subset`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: followerUpstreamLoad,
              unloadSubset: vi.fn(),
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      collection.startSyncImmediate()
      let settled = false
      const load = Promise.resolve(collection._sync.loadSubset(options)).then(
        () => {
          settled = true
        },
      )

      await vi.waitFor(() => {
        expect(adapter.loadSubsetCalls.length).toBeGreaterThan(0)
        expect(ensureRemote).toHaveBeenCalledWith(
          `multiprocess-follower-subset`,
          options,
        )
      })
      const persistedRow = collection.get(`persisted`)
      expect({
        persistedRow: persistedRow
          ? { id: persistedRow.id, title: persistedRow.title }
          : undefined,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
        registeredOwner: registeredOwner !== undefined,
        settled,
      }).toEqual({
        persistedRow: { id: `persisted`, title: `Persisted follower row` },
        followerUpstreamCalls: 0,
        registeredOwner: true,
        settled: false,
      })

      releaseRemoteLoad()
      await load
      expect({
        routedEnsures: ensureRemote.mock.calls.length,
        followerUpstreamCalls: followerUpstreamLoad.mock.calls.length,
      }).toEqual({
        routedEnsures: 1,
        followerUpstreamCalls: 0,
      })
    } finally {
      releaseRemoteLoad()
      await collection.cleanup()
    }
  })

  it.each([`abort`, `signal-abort`, `release`, `offline`] as const)(
    `handles remote ensure after %s without resurrecting cancelled demand`,
    async (action) => {
      vi.useFakeTimers()
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const failure = Object.assign(new Error(action), {
        name: action === `abort` ? `AbortError` : `Error`,
      })
      const ensure = vi.fn(async () => {
        throw failure
      })
      const followerUpstreamLoad = vi.fn(async () => {
        throw new Error(`follower-local source must not own remote demand`)
      })
      const coordinator: PersistedCollectionCoordinator = {
        getNodeId: () => `cancel-ensure`,
        subscribe: () => () => {},
        publish: () => {},
        isLeader: () => true,
        ensureLeadership: async () => {},
        requestEnsurePersistedIndex: async () => {},
        requestApplyCommittedTx: (_collectionId, tx) =>
          Promise.resolve({
            type: `rpc:applyCommittedTx:res`,
            rpcId: tx.txId,
            ok: true,
            term: tx.term,
            seq: tx.seq,
            latestRowVersion: tx.rowVersion,
          }),
        requestEnsureRemoteSubset: ensure,
        // This fixture isolates ensure retry/cancellation, not ownership.
        requestReleaseRemoteSubset: async () => {},
        registerRemoteSubsetOwner: () => () => {},
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `cancel-ensure-${action}`,
          getKey: (row) => row.id,
          syncMode: `on-demand`,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: followerUpstreamLoad,
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        limit: 1,
        ...(action === `signal-abort` ? { signal: controller.signal } : {}),
      }
      try {
        collection.startSyncImmediate()
        const result = await Promise.resolve(
          collection._sync.loadSubset(options),
        ).then(
          () => `ready`,
          (error: unknown) => error,
        )
        if (action === `release`) collection._sync.unloadSubset(options)
        if (action === `signal-abort`) controller.abort()
        const callsBeforeRetry = ensure.mock.calls.length
        await vi.advanceTimersByTimeAsync(200)
        // The old matrix supplied an AbortError or explicitly unloaded demand,
        // but never aborted an already-queued retry. The signal row owns that
        // distinct boundary; offline is its hostile liveness control.
        expect(result).toBe(failure)
        expect(followerUpstreamLoad).not.toHaveBeenCalled()
        if (action === `offline`) {
          expect(ensure.mock.calls.length).toBeGreaterThan(callsBeforeRetry)
        } else {
          expect(ensure).toHaveBeenCalledTimes(callsBeforeRetry)
        }
      } finally {
        await collection.cleanup()
        warning.mockRestore()
        vi.useRealTimers()
      }
    },
  )

  // Remote admission must validate without constructing a discarded wire
  // snapshot. The authorized work bound is at most one detached payload copy per
  // coordinator attempt, and none when hydration retires the demand first.
  // This extends the persisted owner with construction work, not elapsed time.
  // The controlled coordinator calls the real wire encoder; browser/Electron
  // owners separately establish actual transport and local lifecycle delivery.
  it.sequential.each(
    [
      `follower`,
      `leader-to-follower`,
      `retry`,
      `abort`,
      `release`,
      `recovery`,
    ].flatMap((routing) => [0, 1, 33].map((size) => ({ routing, size }))),
  )(
    `copies a wire payload only for a coordinator attempt / $routing / $size bytes`,
    async ({ routing, size }) => {
      const id = `wire-copy-work-${routing}-${size}`
      const adapter = createRecordingAdapter()
      const coordinator = createFailStopCoordinatorHarness(id)
      let leader = routing === `leader-to-follower` || routing === `recovery`
      coordinator.isLeader = () => leader
      const hydrationStarted = createDeferred()
      const hydrationGate = createDeferred()
      const retryFinished = createDeferred()
      const holdHydration = [`leader-to-follower`, `abort`, `release`].includes(
        routing,
      )
      if (holdHydration) {
        const hydrate = adapter.loadSubset
        adapter.loadSubset = async (...args) => {
          hydrationStarted.resolve()
          await hydrationGate.promise
          return hydrate(...args)
        }
      }
      const buffer = new ArrayBuffer(size)
      new Uint8Array(buffer)[0] = 7
      const label = `wire-copy-work-${routing}-${size}`
      const literal = Object.freeze({
        label,
        buffer,
        view: new Uint8Array(buffer),
      })
      const controller = new AbortController()
      const options: LoadSubsetOptions = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`payload`]),
          new IR.Value(literal),
        ]),
        signal: controller.signal,
      }
      const snapshots: Array<
        ReturnType<typeof toTransportedLoadSubsetOptions>
      > = []
      const offline = new Error(`transient transport failure`)
      coordinator.requestEnsureRemoteSubset = (_id, request) => {
        expect(request).toBe(options)
        snapshots.push(toTransportedLoadSubsetOptions(request))
        if (routing === `retry` && snapshots.length === 1) {
          return Promise.reject(offline)
        }
        retryFinished.resolve()
        return Promise.resolve()
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      // Track descendants too: copying a prepared copy is still duplicate work.
      // The positive control fails if the encoder stops using this copy seam.
      const buffers = new WeakSet([buffer])
      const slice = ArrayBuffer.prototype.slice
      let copies = 0
      const copy = vi
        .spyOn(ArrayBuffer.prototype, `slice`)
        .mockImplementation(function (this: ArrayBuffer, start, end) {
          const result = slice.call(this, start, end)
          if (buffers.has(this)) {
            buffers.add(result)
            copies++
          }
          return result
        })
      const defineProperty = Object.defineProperty
      let recordCopies = 0
      const recordCopy = vi
        .spyOn(Object, `defineProperty`)
        .mockImplementation((target, key, descriptor) => {
          if (key === `label` && descriptor.value === label) recordCopies++
          return defineProperty(target, key, descriptor)
        })
      let hasPrimaryFailure = false
      try {
        toTransportedLoadSubsetOptions(options)
        expect({ copies, recordCopies }).toEqual({ copies: 1, recordCopies: 1 })
        copies = 0
        recordCopies = 0
        collection.startSyncImmediate()
        await flushAsyncWork()
        const load = Promise.resolve(collection._sync.loadSubset(options))
        if (holdHydration) {
          await hydrationStarted.promise
          if (routing === `leader-to-follower`) leader = false
          if (routing === `abort`) controller.abort()
          if (routing === `release`) collection._sync.unloadSubset(options)
          hydrationGate.resolve()
        }
        if (routing === `retry`) {
          await expect(load).rejects.toBe(offline)
          await retryFinished.promise
        } else if (routing === `abort`) {
          // Aborting a retained demand rejects rather than reporting a
          // completed load; the transport-attempt prediction remains zero.
          await expect(load).rejects.toMatchObject({ name: `AbortError` })
        } else {
          await load
        }
        if (routing === `recovery`) {
          expect(snapshots).toHaveLength(0)
          leader = false
          coordinator.emit({
            type: `tx:committed`,
            term: 1,
            seq: 2,
            txId: `gap`,
            latestRowVersion: 2,
            changedRows: [],
            deletedKeys: [],
            requiresFullReload: true,
          })
          await retryFinished.promise
        }
        // The independent schedule predicts the number of transport attempts.
        // At settlement, each snapshot must retain its bytes and shared backing
        // buffer after the caller changes its input. Identity remains local.
        const attempts =
          routing === `retry`
            ? 2
            : routing === `abort` || routing === `release`
              ? 0
              : 1
        expect(snapshots).toHaveLength(attempts)
        new Uint8Array(buffer)[0] = 99
        for (const snapshot of snapshots) {
          const expression = snapshot.where
          expect(expression?.type).toBe(`func`)
          if (expression?.type !== `func`)
            throw new Error(`missing wire predicate`)
          const value = expression.args[1]
          expect(value?.type).toBe(`val`)
          if (value?.type !== `val`) throw new Error(`missing wire literal`)
          const received = value.value as typeof literal
          expect(received).not.toBe(literal)
          expect(received.label).toBe(label)
          expect(received.buffer).not.toBe(buffer)
          expect(received.view.buffer).toBe(received.buffer)
          expect(Array.from(received.view)).toEqual(
            Array.from({ length: size }, (_, index) => (index === 0 ? 7 : 0)),
          )
          expect(snapshot).not.toHaveProperty(`signal`)
        }
        expect(options.signal).toBe(controller.signal)
        expect(copies).toBeLessThanOrEqual(attempts)
        expect(recordCopies).toBeLessThanOrEqual(attempts)
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        hydrationGate.resolve()
        await cleanupPersistedOracle(
          [
            () => copy.mockRestore(),
            () => recordCopy.mockRestore(),
            () => warning.mockRestore(),
            () => collection.cleanup(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  // Wire-domain rejection precedes admission to the remote-demand retry path.
  // Ownerless leaders can become followers while hydration waits; string
  // controls must dispatch exactly once, while native input never dispatches.
  // Existing transient-failure histories below retain retry as a separate law.
  it.each([
    [`Instant`, `immediate`],
    [`PlainDate`, `immediate`],
    [`Instant`, `leader-to-follower`],
    [`PlainDate`, `leader-to-follower`],
    [`string`, `immediate`],
    [`string`, `leader-to-follower`],
  ] as const)(
    `applies wire admission before coordinator dispatch / %s / %s`,
    async (kind, routing) => {
      const id = `native-wire-${kind}-${routing}`
      const adapter = createRecordingAdapter()
      const coordinator = createFailStopCoordinatorHarness(id)
      const hydrationStarted = createDeferred()
      const hydrationGate = createDeferred()
      let isLeader = true
      coordinator.isLeader = () => isLeader
      if (routing === `leader-to-follower`) {
        const hydrate = adapter.loadSubset
        adapter.loadSubset = async (...args) => {
          hydrationStarted.resolve()
          await hydrationGate.promise
          return hydrate(...args)
        }
      }
      const ensure = vi.fn(
        (_collectionId: string, options: LoadSubsetOptions) => {
          toTransportedLoadSubsetOptions(options)
          return Promise.resolve()
        },
      )
      coordinator.requestEnsureRemoteSubset = ensure
      const loadSubset = vi.fn()
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return routing === `immediate` ? { loadSubset } : {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      try {
        collection.startSyncImmediate()
        await flushAsyncWork()
        const value =
          kind === `Instant`
            ? Temporal.Instant.from(`2026-01-02T00:00:00Z`)
            : kind === `PlainDate`
              ? Temporal.PlainDate.from(`2026-01-02`)
              : `2026-01-02`
        const options: LoadSubsetOptions = {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`stamp`]),
            new IR.Value(value),
          ]),
        }
        const load = Promise.resolve().then(async () => {
          await collection._sync.loadSubset(options)
        })
        if (routing === `leader-to-follower`) {
          await hydrationStarted.promise
          isLeader = false
          hydrationGate.resolve()
        }
        if (kind === `string`) {
          await expect(load).resolves.toBeUndefined()
        } else {
          await expect(load).rejects.toMatchObject({
            name: `RemoteSubsetWireValueError`,
          })
        }
        await flushAsyncWork(120)
        expect(ensure).toHaveBeenCalledTimes(kind === `string` ? 1 : 0)
        expect(loadSubset).not.toHaveBeenCalled()
        expect(coordinator.remoteReleaseCalls).toEqual([])
      } finally {
        hydrationGate.resolve()
        await collection.cleanup()
      }
    },
  )

  // A completed local acquisition remains active across a later role change.
  // Gap recovery must validate that retained demand before retry admission.
  it.each([`Instant`, `PlainDate`, `string`] as const)(
    `validates retained demand after local success and follower recovery / %s`,
    async (kind) => {
      const id = `native-post-load-${kind}`
      const adapter = createRecordingAdapter()
      const coordinator = createFailStopCoordinatorHarness(id)
      let leader = true
      coordinator.isLeader = () => leader
      const ensure = vi.fn((_id: string, options: LoadSubsetOptions) => {
        toTransportedLoadSubsetOptions(options)
        return Promise.resolve()
      })
      coordinator.requestEnsureRemoteSubset = ensure
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      try {
        collection.startSyncImmediate()
        await flushAsyncWork()
        const value =
          kind === `Instant`
            ? Temporal.Instant.from(`2026-01-02T00:00:00Z`)
            : kind === `PlainDate`
              ? Temporal.PlainDate.from(`2026-01-02`)
              : `2026-01-02`
        const options: LoadSubsetOptions = {
          where: new IR.Func(`eq`, [
            new IR.PropRef([`stamp`]),
            new IR.Value(value),
          ]),
        }
        await collection._sync.loadSubset(options)
        expect(ensure).not.toHaveBeenCalled()
        leader = false
        coordinator.emit({
          type: `tx:committed`,
          term: 1,
          seq: 2,
          txId: `gap`,
          latestRowVersion: 2,
          changedRows: [],
          deletedKeys: [],
          requiresFullReload: true,
        })
        await flushAsyncWork()
        if (kind === `string`) {
          expect(collection.status).toBe(`ready`)
          expect(ensure).toHaveBeenCalledTimes(1)
        } else {
          expect(collection.status).toBe(`error`)
          await expect(
            Promise.resolve().then(async () => {
              await collection._sync.loadSubset(options)
            }),
          ).rejects.toMatchObject({ name: `RemoteSubsetWireValueError` })
          expect(ensure).not.toHaveBeenCalled()
        }
      } finally {
        await collection.cleanup()
        warning.mockRestore()
      }
    },
  )

  // M7 selects Collection-wide fail-stop for failed fallback gap recovery.
  // Admission is ordered: a valid prefix may already be in flight, but a
  // retained invalid demand terminates the run and fences every later demand.
  // Abort cancels admission without retiring its lease; release retires it.
  // This bounded model names two demands independently of runtime queues.
  // It judges dispatch coverage, not retry-attempt multiplicity. Successful
  // pullSince replay and real-host election timing have separate owners.
  it.each(
    ([`Instant`, `PlainDate`, `string`] as const).flatMap((kind) =>
      ([`candidate-first`, `candidate-last`] as const).flatMap((order) =>
        ([`retained`, `aborted`, `released`] as const).map((lifetime) => ({
          kind,
          order,
          lifetime,
        })),
      ),
    ),
  )(
    `preserves the recovery failure boundary for mixed demands / $kind / $order / $lifetime`,
    async ({ kind, order, lifetime }) => {
      const terminal = kind !== `string` && lifetime === `retained`
      const expectedDispatches =
        terminal && order === `candidate-first`
          ? []
          : lifetime !== `retained` || terminal
            ? [`sibling`]
            : [`candidate`, `sibling`]
      const id = `mixed-recovery-${kind}-${order}-${lifetime}`
      const adapter = createRecordingAdapter()
      const coordinator = createFailStopCoordinatorHarness(id)
      let leader = true
      coordinator.isLeader = () => leader
      const controller = new AbortController()
      const value =
        kind === `Instant`
          ? Temporal.Instant.from(`2026-01-02T00:00:00Z`)
          : kind === `PlainDate`
            ? Temporal.PlainDate.from(`2026-01-02`)
            : `2026-01-02`
      const candidate: LoadSubsetOptions = {
        signal: controller.signal,
        where: new IR.Func(`eq`, [
          new IR.PropRef([`stamp`]),
          new IR.Value(value),
        ]),
      }
      const sibling: LoadSubsetOptions = { limit: 1 }
      const demands =
        order === `candidate-first`
          ? [candidate, sibling]
          : [sibling, candidate]
      const remoteSettlement = createEventGate()
      // Observe attempted dispatch before the transport settles. A late
      // rejection after fail-stop must not resurrect the valid prefix's retry.
      const attempts: Array<LoadSubsetOptions> = []
      coordinator.requestEnsureRemoteSubset = (_id, options) => {
        attempts.push(options)
        toTransportedLoadSubsetOptions(options)
        return remoteSettlement.promise
      }
      const errorReported = createEventGate()
      const reported: Array<unknown> = []
      let reentrantFailure: Promise<unknown> | undefined
      const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {}
            },
          },
          persistence: { adapter, coordinator },
        }),
      )
      const markError = collection._lifecycle.markError.bind(
        collection._lifecycle,
      )
      const report = vi
        .spyOn(collection._lifecycle, `markError`)
        .mockImplementation((error) => {
          reported.push(error)
          // Invoke while the error is being reported, before core marks the
          // Collection failed. The runtime must already reject this sibling.
          reentrantFailure = Promise.resolve(
            collection._sync.loadSubset(sibling),
          ).catch((reason: unknown) => reason)
          markError(error)
          errorReported.resolve()
        })
      let hasPrimaryFailure = false
      try {
        await collection.stateWhenReady()
        for (const demand of demands) await collection._sync.loadSubset(demand)
        expect(attempts).toEqual([])
        if (lifetime === `aborted`) controller.abort()
        if (lifetime === `released`) collection._sync.unloadSubset(candidate)
        leader = false
        const emitGap = (seq: number) =>
          coordinator.emit({
            type: `tx:committed`,
            term: 1,
            seq,
            txId: `gap-${seq}`,
            latestRowVersion: seq,
            changedRows: [],
            deletedKeys: [],
            requiresFullReload: true,
          })
        emitGap(2)
        // Recording-adapter I/O is immediate. Drain the turn while transport
        // remains held; this is not a real-host timing or latency assertion.
        await flushAsyncWork()
        expect(collection.status).toBe(terminal ? `error` : `ready`)
        if (terminal) {
          await atPersistedOracleCheckpoint(
            errorReported.promise,
            `mixed recovery error reported`,
          )
        } else {
          // Successful remote work may drain serially. Demand coverage is
          // required after the prefix settles, not while it remains held.
          remoteSettlement.resolve()
          await flushAsyncWork()
        }
        const names = attempts.map((options) => {
          expect(demands).toContain(options)
          return options === candidate ? `candidate` : `sibling`
        })
        expect([...new Set(names)].sort()).toEqual(
          expectedDispatches.slice().sort(),
        )
        const failure = collection._lifecycle.getSyncError()
        if (terminal) {
          expect(failure).toMatchObject({ name: `RemoteSubsetWireValueError` })
          expect(reported).toHaveLength(1)
          expect(reported[0]).toBe(failure)
          await expect(reentrantFailure).resolves.toBe(failure)
          const loads = adapter.loadSubsetCalls.length
          const dispatched = attempts.length
          vi.useFakeTimers()
          if (dispatched > 0) {
            remoteSettlement.reject(new Error(`late transport failure`))
          } else {
            remoteSettlement.resolve()
          }
          await vi.advanceTimersByTimeAsync(0)
          emitGap(3)
          emitGap(4)
          await vi.advanceTimersByTimeAsync(1_000)
          await expect(
            Promise.resolve(collection._sync.loadSubset(sibling)),
          ).rejects.toBe(failure)
          expect(adapter.loadSubsetCalls).toHaveLength(loads)
          expect(attempts).toHaveLength(dispatched)
          expect(reported).toHaveLength(1)
          vi.useRealTimers()
        } else {
          expect(failure).toBeUndefined()
          expect(reported).toEqual([])
        }
        // Every retained lease remains releasable, including after abort or
        // Collection failure. Compare object identity, not structural equality.
        for (const demand of demands) {
          if (lifetime !== `released` || demand !== candidate) {
            collection._sync.unloadSubset(demand)
          }
        }
        const releases =
          lifetime === `released` ? [candidate, sibling] : demands
        expect(coordinator.remoteReleaseCalls).toHaveLength(releases.length)
        releases.forEach((options, index) => {
          expect(coordinator.remoteReleaseCalls[index]).toBe(options)
        })
      } catch (error) {
        hasPrimaryFailure = true
        throw error
      } finally {
        vi.useRealTimers()
        remoteSettlement.resolve()
        await cleanupPersistedOracle(
          [
            () => report.mockRestore(),
            () => collection.cleanup(),
            () => warning.mockRestore(),
          ],
          hasPrimaryFailure,
        )
      }
    },
  )

  it(`retries queued remote subset ensure after transient failures`, async () => {
    const adapter = createRecordingAdapter()
    let ensureCalls = 0
    const offline = new Error(`offline`)

    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `retry-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: async () => {
        ensureCalls++
        if (ensureCalls === 1) {
          throw offline
        }
      },
      // This fixture isolates ensure retry behavior, not ownership.
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present-retry`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: vi.fn() }
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    const firstResult = await Promise.resolve(
      (collection as any)._sync.loadSubset({ limit: 1 }),
    ).then(
      () => `ready`,
      (error: unknown) => error,
    )
    await flushAsyncWork(120)

    expect(firstResult).toBe(offline)
    expect(ensureCalls).toBeGreaterThanOrEqual(2)
  })

  it(`does not route remote demand from an ownerless elected leader`, async () => {
    const ensure = vi.fn(async () => {
      throw new Error(`no remote subset owner registered`)
    })
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `ownerless-on-demand-source`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset({ limit: 1 })),
      ).resolves.toBeUndefined()
      await flushAsyncWork(120)

      expect(ensure).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  it(`uses dispatch-time ownership after follower hydration becomes ownerless leader`, async () => {
    const adapter = createRecordingAdapter()
    const loadSubset = adapter.loadSubset
    let markHydrationStarted = (): void => {}
    const hydrationStarted = new Promise<void>((resolve) => {
      markHydrationStarted = resolve
    })
    let releaseHydration = (): void => {}
    const hydrationGate = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })
    adapter.loadSubset = async (...args) => {
      markHydrationStarted()
      await hydrationGate
      return loadSubset(...args)
    }

    let isLeader = false
    const staleEnsure = new Error(`ownerless leader must not route demand`)
    const ensure = vi.fn(() => Promise.reject(staleEnsure))
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `transitioning-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => isLeader,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `dispatch-time-ownerless-leader`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()
      const load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      await hydrationStarted
      isLeader = true
      releaseHydration()

      await expect(load).resolves.toBeUndefined()
      expect(ensure).not.toHaveBeenCalled()
    } finally {
      releaseHydration()
      await collection.cleanup()
    }
  })

  it(`routes follower demand without a local subset owner`, async () => {
    const ensure = vi.fn(async () => {})
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `ownerless-follower`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      requestEnsureRemoteSubset: ensure,
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
    }
    const collectionId = `ownerless-on-demand-follower`
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: collectionId,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {}
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )
    const options = { limit: 1 }

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()

      await expect(
        Promise.resolve(collection._sync.loadSubset(options)),
      ).resolves.toBeUndefined()

      expect(ensure).toHaveBeenCalledTimes(1)
      expect(ensure).toHaveBeenCalledWith(collectionId, options)
    } finally {
      await collection.cleanup()
    }
  })

  it(`fails sync-absent persistence when follower ack omits mutation ids`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `follower-node`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: async () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: (_collectionId, tx) =>
        Promise.resolve({
          type: `rpc:applyCommittedTx:res`,
          rpcId: tx.txId,
          ok: true,
          term: tx.term,
          seq: tx.seq,
          latestRowVersion: tx.rowVersion,
        }),
      // This fixture isolates follower transaction acknowledgements.
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestApplyLocalMutations: async () => ({
        type: `rpc:applyLocalMutations:res`,
        rpcId: `ack-1`,
        ok: true,
        term: 1,
        seq: 1,
        latestRowVersion: 1,
        acceptedMutationIds: [],
      }),
    }

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-absent-ack`,
        getKey: (item) => item.id,
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    const tx = collection.insert({
      id: `ack-mismatch`,
      title: `Ack mismatch`,
    })

    await expect(tx.isPersisted.promise).rejects.toThrow(
      /partial acceptance is not supported/,
    )
    expect(collection.get(`ack-mismatch`)).toBeUndefined()
  })

  it.each([
    {
      boundary: `follower` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `elected-leader` as const,
      responseCode: `PERSISTENCE_ERROR` as const,
      expectedDurabilityError: true,
    },
    {
      boundary: `follower` as const,
      responseCode: `NOT_LEADER` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `VALIDATION_ERROR` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `CONFLICT` as const,
      expectedDurabilityError: false,
    },
    {
      boundary: `follower` as const,
      responseCode: `TIMEOUT` as const,
      expectedDurabilityError: false,
    },
  ])(
    `classifies public local-mutation failure at the $boundary boundary: $responseCode`,
    async ({ boundary, responseCode, expectedDurabilityError }) => {
      const persistenceResponse =
        responseCode === `PERSISTENCE_ERROR`
          ? {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-persistence-response`,
              ok: false as const,
              code: `PERSISTENCE_ERROR` as const,
              error: `disk write failed`,
              sourceCode: `SQLITE_IOERR_FSYNC`,
              path: [`database`, `wal`] as const,
            }
          : {
              type: `rpc:applyLocalMutations:res` as const,
              rpcId: `local-${boundary}-failure-response`,
              ok: false as const,
              code: responseCode,
              error: `mutation route changed`,
            }
      const coordinator = createCoordinatorHarness()
      coordinator.isLeader = () => boundary === `elected-leader`
      coordinator.requestApplyLocalMutations = () =>
        Promise.resolve(persistenceResponse)
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `local-mutation-${boundary}-${responseCode}`,
          getKey: (item) => item.id,
          persistence: {
            adapter: createRecordingAdapter(),
            coordinator,
          },
        }),
      )

      try {
        const tx = collection.insert({
          id: `local-failure`,
          title: `Must not persist`,
        })
        const rejection = await tx.isPersisted.promise.then(
          () => undefined,
          (error: unknown) => error,
        )

        // Earlier laws covered external-sync commit classification and a
        // successful follower mutation acknowledgement. They never varied a
        // serialized applyLocalMutations failure by route. The elected-leader
        // and non-durability rows are hostile controls for topology parity and
        // for avoiding an over-broad fail-stop classifier.
        if (expectedDurabilityError) {
          expect(rejection).toMatchObject({
            name: `PersistedCollectionDurabilityError`,
            code: `SQLITE_IOERR_FSYNC`,
            path: [`database`, `wal`],
            cause: persistenceResponse,
          })
          expect(collection.status).toBe(`error`)
          expect(collection._lifecycle.getSyncError()).toBe(rejection)
        } else {
          expect(rejection).toMatchObject({
            name: `Error`,
            message:
              `failed to apply local mutations through coordinator: ` +
              `mutation route changed`,
          })
          expect(collection._lifecycle.getSyncError()).toBeUndefined()
        }
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`installs terminal state before synchronously reporting a local coordinator durability error`, async () => {
    const coordinator = createCoordinatorHarness()
    let requestCalls = 0
    coordinator.requestApplyLocalMutations = async (
      _collectionId,
      mutations,
    ) => {
      requestCalls++
      if (requestCalls === 1) {
        return {
          type: `rpc:applyLocalMutations:res`,
          rpcId: `local-reentrant-failure`,
          ok: false,
          code: `PERSISTENCE_ERROR`,
          error: `disk write failed`,
          sourceCode: `SQLITE_IOERR_FSYNC`,
          path: [`database`, `wal`],
        }
      }
      return {
        type: `rpc:applyLocalMutations:res`,
        rpcId: `local-reentrant-success`,
        ok: true,
        term: 1,
        seq: requestCalls,
        latestRowVersion: requestCalls,
        acceptedMutationIds: mutations.map((mutation) => mutation.mutationId),
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-terminal-before-report`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createRecordingAdapter(),
          coordinator,
        },
      }),
    )
    const now = new Date()
    const reentrantRow = {
      id: `reentrant-local`,
      title: `must not reach the coordinator`,
    }
    const reentrantMutation: PendingMutation<Todo, `insert`> = {
      mutationId: `reentrant-local-mutation`,
      original: {},
      modified: reentrantRow,
      changes: reentrantRow,
      globalKey: `local-terminal-before-report:reentrant-local`,
      key: reentrantRow.id,
      type: `insert`,
      metadata: undefined,
      syncMetadata: {},
      optimistic: true,
      createdAt: now,
      updatedAt: now,
      collection,
    }
    let reentrantOutcome:
      | Promise<
          { status: `fulfilled` } | { status: `rejected`; reason: unknown }
        >
      | undefined
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const originalMarkError = collection._lifecycle.markError.bind(
        collection._lifecycle,
      )
      vi.spyOn(collection._lifecycle, `markError`).mockImplementation(
        (error) => {
          reentrantOutcome = Promise.resolve(
            collection.utils.acceptMutations({
              mutations: [
                reentrantMutation as unknown as PendingMutation<
                  Record<string, unknown>
                >,
              ],
            }),
          ).then(
            () => ({ status: `fulfilled` as const }),
            (reason: unknown) => ({ status: `rejected` as const, reason }),
          )
          originalMarkError(error)
        },
      )

      const primary = collection.insert({
        id: `primary-local`,
        title: `must install terminal state`,
      })
      const primaryOutcome = await primary.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      const reentrant = await atPersistedOracleCheckpoint(
        reentrantOutcome!,
        `reentrant local mutation after durability error`,
      )
      const terminalError =
        primaryOutcome.status === `rejected` ? primaryOutcome.reason : undefined

      expect({
        primaryStatus: primaryOutcome.status,
        reentrantStatus: reentrant.status,
        sameTerminal:
          reentrant.status === `rejected` && reentrant.reason === terminalError,
        requestCalls,
        exactPublicError:
          collection._lifecycle.getSyncError() === terminalError,
        reentrantVisible: collection.get(reentrantRow.id),
      }).toEqual({
        primaryStatus: `rejected`,
        reentrantStatus: `rejected`,
        sameTerminal: true,
        requestCalls: 1,
        exactPublicError: true,
        reentrantVisible: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      await cleanupPersistedOracle(
        [() => reentrantOutcome, () => collection.cleanup()],
        hasPrimaryFailure,
      )
    }
  })

  it(`preserves lifecycle abort classification when cleanup wins a local adapter race`, async () => {
    const adapter = createRecordingAdapter()
    const successfulApply = adapter.applyCommittedTx.bind(adapter)
    const persistenceEntered = createEventGate()
    const releasePersistence = createEventGate()
    adapter.applyCommittedTx = async (...args) => {
      persistenceEntered.resolve()
      await releasePersistence.promise
      await successfulApply(...args)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `local-cleanup-durability-race`,
        getKey: (item) => item.id,
        persistence: { adapter },
      }),
    )
    let cleanedUp = false
    let hasPrimaryFailure = false

    try {
      await collection.stateWhenReady()
      const transaction = collection.insert({
        id: `old-local`,
        title: `durable only in the replaced lifecycle`,
      })
      const settlement = transaction.isPersisted.promise.then(
        () => ({ status: `fulfilled` as const }),
        (reason: unknown) => ({ status: `rejected` as const, reason }),
      )
      await atPersistedOracleCheckpoint(
        persistenceEntered.promise,
        `local adapter entered before cleanup`,
      )

      await collection.cleanup()
      cleanedUp = true
      releasePersistence.resolve()
      const outcome = await atPersistedOracleCheckpoint(
        settlement,
        `old local mutation settled after cleanup`,
      )

      expect({
        status: outcome.status,
        aborted:
          outcome.status === `rejected` &&
          outcome.reason instanceof SyncTransactionAbortedError,
        durability:
          outcome.status === `rejected` &&
          outcome.reason instanceof PersistedCollectionDurabilityError,
        publicError: collection._lifecycle.getSyncError(),
      }).toEqual({
        status: `rejected`,
        aborted: true,
        durability: false,
        publicError: undefined,
      })
    } catch (error) {
      hasPrimaryFailure = true
      throw error
    } finally {
      releasePersistence.resolve()
      await cleanupPersistedOracle(
        [() => (cleanedUp ? undefined : collection.cleanup())],
        hasPrimaryFailure,
      )
    }
  })

  it(`checks durable row authority when a targeted public-key change could be a replacement`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Original`, detail: `removed by insert` },
    ])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    await collection.preload()
    await flushAsyncWork()
    const loadSubsetCallsAfterPreload = adapter.loadSubsetCalls.length

    // The envelope has no insert/update certificate. Durable insert may have
    // replaced the entire row, including a field omitted from the notice.
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-targeted`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    expect(adapter.loadSubsetCalls.length).toBe(loadSubsetCallsAfterPreload + 1)
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
  })

  it(`targeted update removes row that no longer matches WHERE`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Keep` },
      { id: `2`, title: `Keep` },
    ])
    const loadSubset = adapter.loadSubset.bind(adapter)
    adapter.loadSubset = async (id, options, context) =>
      (await loadSubset(id, options, context)).filter(
        (row) => !options.where || row.value.title === `Keep`,
      )
    const coordinator = createCoordinatorHarness()

    const whereExpr = new IR.Func(`eq`, [
      new IR.PropRef([`title`]),
      new IR.Value(`Keep`),
    ])

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Load a filtered subset with WHERE title = 'Keep'
    await (collection as any)._sync.loadSubset({ where: whereExpr })
    await flushAsyncWork()
    expect(stripVirtualProps(collection.get(`2`))).toEqual({
      id: `2`,
      title: `Keep`,
    })

    // Change the row so it no longer matches WHERE title = 'Keep'
    adapter.rows.set(`2`, { id: `2`, title: `Changed` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-where`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `2`, value: { id: `2`, title: `Changed` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // Row no longer matches WHERE — should be removed from collection
    expect(collection.get(`2`)).toBeUndefined()
  })

  it(`paginated subset falls back to full reload`, async () => {
    const adapter = createRecordingAdapter([{ id: `1`, title: `Row 1` }])
    const coordinator = createCoordinatorHarness()

    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: {
          adapter,
          coordinator,
        },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()

    // Add a paginated subset (limit)
    await (collection as any)._sync.loadSubset({ limit: 10 })
    await flushAsyncWork()
    const loadSubsetCallsAfterPaginated = adapter.loadSubsetCalls.length

    // Update the row in the adapter backing store
    adapter.rows.set(`1`, { id: `1`, title: `Updated` })

    coordinator.emit({
      type: `tx:committed`,
      term: 1,
      seq: 1,
      txId: `tx-paginated`,
      latestRowVersion: 1,
      requiresFullReload: false,
      changedRows: [{ key: `1`, value: { id: `1`, title: `Updated` } }],
      deletedKeys: [],
    })

    await flushAsyncWork()
    await flushAsyncWork()

    // With a paginated subset active, should fall back to full reload
    expect(adapter.loadSubsetCalls.length).toBeGreaterThan(
      loadSubsetCallsAfterPaginated,
    )
    expect(stripVirtualProps(collection.get(`1`))).toEqual({
      id: `1`,
      title: `Updated`,
    })
  })

  // A scoped source snapshot establishes row 1. A coordinator notification
  // cannot replace it from an uncertified cache; instead the active demand
  // must request fresh source evidence. The five legal histories cross targeted,
  // paginated, full-reload, sequence-gap, and reset notifications. The recording adapter is
  // durable state, not the expected source result. The apply-mutex fence below
  // places the public-row comparison after coordinator processing and checks
  // a second source acquisition. This owner
  // isolates the wrapper boundary; installed Electric delivery has a receiver.
  it.each([
    `targeted change`,
    `paginated change`,
    `full reload`,
    `sequence gap`,
    `durable reset`,
  ] as const)(`keeps an active scoped source row after %s`, async (event) => {
    const adapter = createRecordingAdapter()
    const coordinator = createLocalCoordinatorHarness()
    let source!: TodoSyncParams
    let sourceLoads = 0
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return {
              loadSubset: async () => {
                sourceLoads++
              },
            }
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    collection.startSyncImmediate()
    await flushAsyncWork()
    const capability = source.metadata?.persistence
    expect(capability?.startScopedRecovery).toBeTypeOf(`function`)
    await capability!.startScopedRecovery!()

    const sourceRow: Todo = { id: `1`, title: `Source row` }
    source.begin()
    source.write({ type: `insert`, value: sourceRow })
    await whenSyncAccepted(source.commit())
    await collection._sync.loadSubset(
      event === `targeted change` ? {} : { limit: 10 },
    )
    expect(sourceLoads).toBe(1)
    expect(stripVirtualProps(collection.get(`1`))).toEqual(sourceRow)

    const latest = adapter.applyCommittedTxCalls.at(-1)!.tx
    if (event === `durable reset`) {
      adapter.rows.clear()
      coordinator.emit({
        type: `collection:reset`,
        schemaVersion: 1,
        resetEpoch: 1,
      })
    } else if (event === `sequence gap`) {
      Object.assign(coordinator, {
        pullSince: (): Promise<PullSinceResponse> =>
          Promise.resolve({
            type: `rpc:pullSince:res`,
            rpcId: `scoped-gap`,
            ok: true,
            latestTerm: latest.term,
            latestSeq: latest.seq + 2,
            latestRowVersion: latest.rowVersion + 2,
            requiresFullReload: true,
          }),
      })
      coordinator.emit({
        type: `tx:committed`,
        term: latest.term,
        seq: latest.seq + 2,
        txId: `scoped-sequence-gap`,
        latestRowVersion: latest.rowVersion + 2,
        requiresFullReload: true,
      })
    } else if (event === `full reload`) {
      // A transaction above the coordinator's targeted-invalidation limit can
      // change many unrelated durable rows without changing source row 1.
      for (let id = 2; id <= 130; id++) {
        adapter.rows.set(String(id), { id: String(id), title: `Other ${id}` })
      }
      coordinator.emit({
        type: `tx:committed`,
        term: latest.term,
        seq: latest.seq + 1,
        txId: `large-scoped-change`,
        latestRowVersion: latest.rowVersion + 1,
        requiresFullReload: true,
      })
    } else {
      const durableRow: Todo =
        event === `targeted change`
          ? { id: `1`, title: `Uncertified durable update` }
          : { id: `2`, title: `Unrelated durable row` }
      adapter.rows.set(durableRow.id, durableRow)
      coordinator.emit({
        type: `tx:committed`,
        term: latest.term,
        seq: latest.seq + 1,
        txId: `scoped-change`,
        latestRowVersion: latest.rowVersion + 1,
        requiresFullReload: false,
        changedRows: [{ key: durableRow.id, value: durableRow }],
        deletedKeys: [],
      })
    }

    // scanPersistedRows enters the same apply mutex after event admission, so
    // this observes the settled coordinator invalidation rather than a race.
    await capability!.scanPersistedRows()
    expect(stripVirtualProps(collection.get(`1`))).toEqual(sourceRow)
    expect(adapter.loadSubsetCalls).toEqual([])
    await vi.waitFor(() => expect(sourceLoads).toBe(2))
  })

  // This deliberately wrong global-eviction message is a hostile control for
  // the two-run Browser generation-routing oracle. A global full reload makes
  // the warm run lose a valid source row, so it cannot implement cache
  // retirement. This driver checks that the public-row comparison detects
  // the fault; no production path emits this fabricated cacheEviction field.
  it(`detects that global cache eviction removes a warm source row`, async () => {
    const adapter = createRecordingAdapter()
    const coordinator = createLocalCoordinatorHarness()
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `sync-present`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
          },
        },
        persistence: { adapter, coordinator },
      }),
    )

    try {
      collection.startSyncImmediate()
      await vi.waitFor(() => expect(source).toBeDefined())
      const sourceRow = { id: `warm`, title: `Valid source row` }
      source.begin()
      source.write({ type: `insert`, value: sourceRow })
      await whenSyncAccepted(source.commit())
      await collection._sync.loadSubset({ limit: 10 })
      const readsBeforeEviction = adapter.loadSubsetCalls.length
      const latest = adapter.applyCommittedTxCalls.at(-1)!.tx

      adapter.rows.clear()
      coordinator.emit({
        type: `tx:committed`,
        term: latest.term,
        seq: latest.seq + 1,
        txId: `peer-cache-eviction`,
        latestRowVersion: latest.rowVersion + 1,
        requiresFullReload: true,
        cacheEviction: true,
      } as unknown as TxCommitted)

      await source.metadata!.persistence!.scanPersistedRows()
      expect(stripVirtualProps(collection.get(`warm`))).toBeUndefined()
      expect(adapter.loadSubsetCalls.length).toBeGreaterThan(
        readsBeforeEviction,
      )
    } finally {
      await collection.cleanup()
    }
  })

  // Scoped recovery removes durable rows' authority to enter the public
  // Collection. This recording adapter has no generation catalog, so its old
  // rows remain on disk in the model; the SQLite owner checks physical
  // retirement separately. A later baseline capability call cannot revive
  // the row. This driver checks public visibility and the adapter read boundary.
  it(`does not hydrate durable baseline rows during scoped recovery`, async () => {
    const adapter = createRecordingAdapter([
      { id: `1`, title: `Stale durable row` },
    ])
    const resetMarker = { kind: `reset`, updatedAt: 1 }
    adapter.collectionMetadata.set(`electric:resume`, resetMarker)
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `scoped-baseline-quarantine`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
          },
        },
        persistence: { adapter },
      }),
    )

    try {
      collection.startSyncImmediate()
      await flushAsyncWork()
      const capability = source.metadata!.persistence!
      await capability.startScopedRecovery!()
      expect(collection.get(`1`)).toBeUndefined()
      expect(adapter.rows.has(`1`)).toBe(true)
      expect(adapter.collectionMetadata.get(`electric:resume`)).toEqual(
        resetMarker,
      )
      await capability.hydrateBaseline()
      expect(collection.get(`1`)).toBeUndefined()
      expect(
        adapter.loadResumeSnapshotCalls.filter(
          (call) => call.includeRows === true,
        ),
      ).toEqual([])

      // A later loss of authority in the same sync run must retire rows that
      // arrived after the first clear, rather than growing the cache forever.
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `2`, title: `Later source row` },
      })
      await whenSyncAccepted(source.commit())
      expect(adapter.rows.has(`2`)).toBe(true)
      await capability.startScopedRecovery!()
      expect(collection.get(`2`)).toBeUndefined()
      expect(adapter.rows.has(`1`)).toBe(true)
      expect(adapter.rows.has(`2`)).toBe(true)
    } finally {
      await collection.cleanup()
    }
  })

  // A local load can begin before scoped recovery claims the Collection.
  // When that load fails, queued partial source work may ask for a durable
  // baseline. The independent source model permits the partial source fields,
  // but no old durable field has authority after the scoped clear. The gate
  // fixes the order at the adapter boundary; the observations are the stale
  // public field and full-row read count.
  it(`keeps a failed local load from restoring scoped durable rows`, async () => {
    const adapter = createRecordingAdapter([
      { id: `shared`, title: `Stale durable`, detail: `stale detail` },
    ])
    const loadEntered = createEventGate()
    const rejectLoad = createEventGate()
    const localFailure = new Error(`local load failed`)
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await rejectLoad.promise
      throw localFailure
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `scoped-failed-local-load`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          rowUpdateMode: `partial`,
          sync: (params) => {
            source = params
            params.markReady()
            return { loadSubset: () => true }
          },
        },
        persistence: { adapter },
      }),
    )
    let load: Promise<unknown> | undefined
    let receipt: Promise<unknown> | undefined
    let scoped: Promise<void> | undefined
    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `scoped failed local load startup`,
      )
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      void load.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        loadEntered.promise,
        `scoped failed local load entered`,
      )
      source.begin()
      source.write({
        type: `update`,
        value: { id: `shared`, title: `Partial source` } as Todo,
      })
      receipt = Promise.resolve(source.commit())
      void receipt.catch(() => undefined)
      scoped = source.metadata!.persistence!.startScopedRecovery!()
      rejectLoad.resolve()
      await expect(load).rejects.toBe(localFailure)
      await atPersistedOracleCheckpoint(scoped, `scoped failed load clear`)
      await Promise.allSettled([receipt])
      expect(collection.get(`shared`)).toMatchObject({
        id: `shared`,
        title: `Partial source`,
      })
      expect(collection.get(`shared`)?.detail).toBeUndefined()
      expect(
        adapter.loadResumeSnapshotCalls.filter(
          (call) => call.includeRows === true,
        ),
      ).toEqual([])
    } finally {
      rejectLoad.resolve()
      await Promise.allSettled([load, receipt, scoped])
      await collection.cleanup()
    }
  })

  // Source work admitted while an old cache read is in flight belongs to the
  // old persisted cache generation. Rotation may overtake that work at the
  // apply mutex, but it cannot turn the old source result into a row in the
  // new generation. The held local read fixes the ordering; the applied
  // receipt and durable write destination are the comparison checkpoint.
  // A sync adapter reports through its own sync params that served pages
  // may have shifted. Under a managed cache generation the wrapper gives each
  // source session its own params, so the report must reach the public
  // Collection from the current session and be dropped from a retired one;
  // otherwise a stale source could start repairs on the replacement.
  it(`forwards a loaded-subset report only from the current source session`, async () => {
    const adapter = createRecordingAdapter()
    let currentStorageId = `report-old-storage`
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: currentStorageId,
      claimId: `report-claim`,
    })
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: (currentStorageId = `report-new-storage`),
      claimId: `report-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.releaseCacheGenerationClaim = async () => {}
    const sessions: Array<TodoSyncParams> = []
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `loaded-subset-report-sessions`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sessions.push(params)
            params.markReady()
            // Without its own restart hook, the source is retired and
            // re-entered with fresh params after a scoped rotation.
          },
        },
        persistence: { adapter },
      }),
    )
    let reports = 0
    const unsubscribe = collection.on(`loadedSubsets:invalidated`, () => {
      reports++
    })
    // Reports are coalesced into a microtask; a macrotask lets them land.
    const reportsAfter = async (report: () => void) => {
      const before = reports
      report()
      await new Promise((resolve) => setTimeout(resolve, 0))
      return reports - before
    }
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      const first = sessions[0]!
      expect(await reportsAfter(() => first.invalidateLoadedSubsets())).toBe(1)

      await atPersistedOracleCheckpoint(
        first.metadata!.persistence!.startScopedRecovery!(),
        `scoped rotation`,
      )
      expect(sessions).toHaveLength(2)
      const replacement = sessions[1]!
      expect({
        retired: await reportsAfter(() => first.invalidateLoadedSubsets()),
        replacement: await reportsAfter(() =>
          replacement.invalidateLoadedSubsets(),
        ),
      }).toEqual({ retired: 0, replacement: 1 })
    } finally {
      unsubscribe()
      await collection.cleanup()
    }
  })

  it(`rejects a queued old-generation source commit after scoped rotation`, async () => {
    const adapter = createRecordingAdapter()
    const loadEntered = createEventGate()
    const releaseLoad = createEventGate()
    const claimId = `queued-old-claim`
    let currentStorageId = `queued-old-storage`
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: currentStorageId,
      claimId,
    })
    adapter.rotateCacheGeneration = async () => ({
      storageCollectionId: (currentStorageId = `queued-new-storage`),
      claimId,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.loadSubset = async () => {
      loadEntered.resolve()
      await releaseLoad.promise
      return []
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `queued-generation-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            // The controlled source has no pending asynchronous callback.
            // Its old commit is already queued inside the persisted wrapper.
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )

    let load: Promise<unknown> | undefined
    let receipt: Promise<unknown> | undefined
    let recovery: Promise<void> | undefined
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      load = Promise.resolve(collection._sync.loadSubset({ limit: 1 }))
      void load.catch(() => undefined)
      await atPersistedOracleCheckpoint(loadEntered.promise, `old cache read`)
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `old-source`, title: `Old source result` },
      })
      receipt = Promise.resolve(source.commit())
      void receipt.catch(() => undefined)
      recovery = source.metadata!.persistence!.startScopedRecovery!()
      releaseLoad.resolve()
      await atPersistedOracleCheckpoint(recovery, `scoped rotation`)
      await expect(receipt).rejects.toBeInstanceOf(SyncTransactionAbortedError)
      expect(
        adapter.applyCommittedTxCalls.filter(
          (call) => call.collectionId === `queued-new-storage`,
        ),
      ).toEqual([])
      expect(collection.get(`old-source`)).toBeUndefined()

      // Cancellation belongs only to the old admission. Fresh work in the
      // new generation still applies and persists through the same sync run.
      source.begin()
      source.write({
        type: `insert`,
        value: { id: `new-source`, title: `New source result` },
      })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`new-source`)).toMatchObject({
        id: `new-source`,
        title: `New source result`,
      })
      expect(
        adapter.applyCommittedTxCalls
          .filter((call) => call.collectionId === `queued-new-storage`)
          .flatMap((call) => call.tx.mutations.map((mutation) => mutation.key)),
      ).toEqual([`new-source`])
    } finally {
      releaseLoad.resolve()
      await Promise.allSettled([load, receipt, recovery])
      await collection.cleanup()
    }
  })

  // Cleanup can release the original claim while a rotation is paused before
  // SQLite admission. If rotation then creates a private generation, that
  // late claim still belongs to the cleaned-up sync run and must be released.
  // The independent claim ledger observes ownership after both operations
  // settle; checking only the public Collection would miss leaked storage.
  it(`releases a cache claim created by rotation after cleanup`, async () => {
    const adapter = createRecordingAdapter()
    const liveClaims = new Set<string>()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    adapter.claimCacheGeneration = async () => {
      liveClaims.add(`old-claim`)
      return { storageCollectionId: `old-storage`, claimId: `old-claim` }
    }
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      expect(liveClaims.has(`old-claim`)).toBe(false)
      liveClaims.add(`private-claim`)
      return {
        storageCollectionId: `private-storage`,
        claimId: `private-claim`,
      }
    }
    adapter.releaseCacheGenerationClaim = async (claimId) => {
      liveClaims.delete(claimId)
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `cleanup-during-cache-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            source = params
            params.markReady()
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    let recovery: Promise<void> | undefined
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      recovery = source.metadata!.persistence!.startScopedRecovery!()
      void recovery.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `held cache rotation`,
      )
      await collection.cleanup()
      expect(liveClaims.size).toBe(0)
      releaseRotation.resolve()
      await Promise.allSettled([recovery])
      expect([...liveClaims]).toEqual([])
    } finally {
      releaseRotation.resolve()
      await Promise.allSettled([recovery])
      await collection.cleanup()
    }
  })

  // A custom source is allowed to omit a provider-specific restart hook. Its
  // Collection must still recover after claim expiry: the wrapper ends the old
  // source session, rotates storage, and starts a fresh source session. A held
  // callback from the retired session has no authority over new public rows or
  // durable storage. The source-session and row ledgers are independent of the
  // wrapper's recovery flags.
  it.each([false, true])(
    `restarts a custom on-demand source after its cache claim expires (prior demand=%s)`,
    async (priorDemand) => {
      const adapter = createRecordingAdapter([
        { id: `stale`, title: `Old persisted row` },
      ])
      let rotations = 0
      let sourceStarts = 0
      let sourceCleanups = 0
      const sourceSessions: Array<TodoSyncParams> = []
      let revokeClaim = false
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: `old-storage`,
        claimId: `old-claim`,
        expiresAtMs: Date.now() + 10_000,
      })
      adapter.renewCacheGenerationClaim = async (_storageId, claimId) =>
        revokeClaim && claimId === `old-claim` ? undefined : Date.now() + 10_000
      adapter.rotateCacheGeneration = async () => {
        rotations++
        return {
          storageCollectionId: `new-storage`,
          claimId: `new-claim`,
        }
      }
      adapter.releaseCacheGenerationClaim = async () => {}
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `custom-cache-source`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: (params) => {
              const session = ++sourceStarts
              sourceSessions.push(params)
              params.markReady()
              return {
                cleanup: () => {
                  sourceCleanups++
                },
                loadSubset: async () => {
                  params.begin()
                  params.write({
                    type: `update`,
                    value: {
                      id: `row-${session}`,
                      title: `Session ${session}`,
                    },
                  })
                  await params.commit()
                },
              }
            },
          },
          persistence: { adapter },
        }),
      )
      const releaseOldCallback = createEventGate()
      let lateCallback: Promise<void> | undefined

      try {
        await collection.stateWhenReady()
        expect(sourceStarts).toBe(1)
        const oldSource = sourceSessions[0]!
        lateCallback = (async () => {
          await releaseOldCallback.promise
          oldSource.begin()
          oldSource.write({
            type: `insert`,
            value: { id: `late-old`, title: `Retired session` },
          })
          await oldSource.commit()
        })()
        if (priorDemand) {
          await collection._sync.loadSubset({ limit: 2 })
          expect(collection.get(`row-1`)).toBeDefined()
        }
        revokeClaim = true
        await collection._sync.loadSubset({ limit: 1 })
        expect(sourceStarts).toBe(2)
        expect(sourceCleanups).toBe(1)
        expect(rotations).toBe(1)
        expect(collection.get(`stale`)).toBeUndefined()
        expect(collection.get(`row-1`)).toBeUndefined()
        expect(collection.get(`row-2`)).toMatchObject({
          id: `row-2`,
          title: `Session 2`,
        })
        releaseOldCallback.resolve()
        await lateCallback
        expect(collection.get(`late-old`)).toBeUndefined()
        expect(
          adapter.applyCommittedTxCalls.some(({ tx }) =>
            tx.mutations.some(({ key }) => key === `late-old`),
          ),
        ).toBe(false)
      } finally {
        releaseOldCallback.resolve()
        await Promise.allSettled([lateCallback])
        await collection.cleanup()
      }
    },
  )

  // Cleanup can win after the old custom session retires but before SQLite
  // returns its replacement claim. That history owns one source cleanup and
  // must not start another source session after Collection disposal.
  it(`does not restart a custom source after cleanup wins a held rotation`, async () => {
    const adapter = createRecordingAdapter()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    let sourceStarts = 0
    let sourceCleanups = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: `old-storage`,
      claimId: `old-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      return { storageCollectionId: `new-storage`, claimId: `new-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `custom-cleanup-during-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: (params) => {
            sourceStarts++
            source = params
            params.markReady()
            return {
              cleanup: () => {
                sourceCleanups++
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    let recovery: Promise<void> | undefined
    try {
      collection.startSyncImmediate()
      await collection.stateWhenReady()
      recovery = source.metadata!.persistence!.startScopedRecovery!()
      void recovery.catch(() => undefined)
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `held custom cache rotation`,
      )
      await collection.cleanup()
      releaseRotation.resolve()
      await Promise.allSettled([recovery])
      expect({ sourceStarts, sourceCleanups }).toEqual({
        sourceStarts: 1,
        sourceCleanups: 1,
      })
    } finally {
      releaseRotation.resolve()
      await Promise.allSettled([recovery])
      await collection.cleanup()
    }
  })

  // A startup resume read may pass SQLite's first claim check, then fail its
  // second check after the claim expires. The independent authority rule
  // discards that old read and rotates privately before source entry. A read
  // error while the claim remains live has no such explanation and stays
  // terminal. The held read and clock distinguish these histories at source
  // entry, Collection readiness, and physical storage choice.
  it.each([
    { outcome: `expired claim`, expires: true },
    { outcome: `live I/O failure`, expires: false },
  ])(
    `classifies a rejected startup resume read: $outcome`,
    async ({ expires }) => {
      const adapter = createRecordingAdapter()
      const readEntered = createEventGate()
      const releaseRead = createEventGate()
      const storageId = `startup-rejected-old`
      let currentStorageId = storageId
      let now = 1_000
      let expiresAtMs = 2_000
      let rotations = 0
      let sourceStarts = 0
      const ioFailure = new Error(`live startup read failed`)
      const claimFailure = new InvalidPersistedCollectionConfigError(
        `Persisted cache claim is no longer active for collection "${storageId}"`,
      )
      adapter.getCacheGenerationNow = () => now
      adapter.claimCacheGeneration = async () => ({
        storageCollectionId: currentStorageId,
        claimId: `startup-rejected-claim`,
        expiresAtMs,
      })
      adapter.renewCacheGenerationClaim = async () =>
        now < expiresAtMs ? (expiresAtMs = now + 1_000) : undefined
      adapter.rotateCacheGeneration = async () => {
        rotations++
        currentStorageId = `startup-rejected-new`
        expiresAtMs = now + 1_000
        return {
          storageCollectionId: currentStorageId,
          claimId: `startup-rejected-claim`,
          expiresAtMs,
        }
      }
      adapter.releaseCacheGenerationClaim = async () => {}
      const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
      adapter.loadResumeSnapshot = async (id, options) => {
        if (recordedStorageId(id) === storageId) {
          readEntered.resolve()
          await releaseRead.promise
          throw expires ? claimFailure : ioFailure
        }
        return loadResumeSnapshot(id, options)
      }
      const collection = createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `startup-rejected-resume-read-${expires}`,
          syncMode: `on-demand`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              sourceStarts++
              markReady()
              return { restartAfterScopedRecovery: () => {} }
            },
          },
          persistence: { adapter },
        }),
      )
      try {
        collection.startSyncImmediate()
        const ready = collection.stateWhenReady()
        void ready.catch(() => undefined)
        await atPersistedOracleCheckpoint(
          readEntered.promise,
          `startup resume read entered`,
        )
        if (expires) now = 2_100
        releaseRead.resolve()
        if (expires) {
          await atPersistedOracleCheckpoint(ready, `recovered source readiness`)
          expect(collection.status).toBe(`ready`)
          expect(sourceStarts).toBe(1)
          expect(rotations).toBe(1)
          expect(currentStorageId).toBe(`startup-rejected-new`)
        } else {
          await expect(ready).rejects.toBe(ioFailure)
          expect(collection.status).toBe(`error`)
          expect(sourceStarts).toBe(0)
          expect(rotations).toBe(0)
        }
      } finally {
        releaseRead.resolve()
        await collection.cleanup()
      }
    },
  )

  // Each claim expiry is a loss of authority, not an exhausted retry budget.
  // The independent clock pauses this run during two successive SQLite resume
  // reads, then lets a third read finish with a live claim. The source must
  // start exactly once under that final storage ID, with no old read admitted.
  it(`recovers after successive startup resume claims expire`, async () => {
    const adapter = createRecordingAdapter()
    let now = 1_000
    let expiresAtMs = 2_000
    let storageId = `successive-startup-old`
    let reads = 0
    let rotations = 0
    let sourceStarts = 0
    adapter.getCacheGenerationNow = () => now
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `successive-startup-claim`,
      expiresAtMs,
    })
    adapter.renewCacheGenerationClaim = async () =>
      now < expiresAtMs ? (expiresAtMs = now + 1_000) : undefined
    adapter.rotateCacheGeneration = async () => {
      storageId = `successive-startup-new-${++rotations}`
      expiresAtMs = now + 1_000
      return {
        storageCollectionId: storageId,
        claimId: `successive-startup-claim`,
        expiresAtMs,
      }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    const loadResumeSnapshot = adapter.loadResumeSnapshot.bind(adapter)
    adapter.loadResumeSnapshot = async (id, options) => {
      if (++reads <= 2) {
        now = expiresAtMs + 1
        throw new InvalidPersistedCollectionConfigError(
          `Persisted cache claim is no longer active for collection "${id}"`,
        )
      }
      return loadResumeSnapshot(id, options)
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `successive-startup-expiry`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            sourceStarts++
            markReady()
            return { restartAfterScopedRecovery: () => {} }
          },
        },
        persistence: { adapter },
      }),
    )
    try {
      await atPersistedOracleCheckpoint(
        collection.stateWhenReady(),
        `source entry after successive claim expiry`,
      )
      expect(collection.status).toBe(`ready`)
      expect(reads).toBe(3)
      expect(rotations).toBe(2)
      expect(storageId).toBe(`successive-startup-new-2`)
      expect(sourceStarts).toBe(1)
    } finally {
      await collection.cleanup()
    }
  })

  // An expired cache claim may start a private rotation while startup is
  // creating a persisted index. The source cannot enter until that rotation
  // settles: before its sync callback returns there is no provider-session
  // restart capability to retire callbacks bound to the old cache. This
  // controlled adapter permits the index and rotation to overlap. The model
  // starts the source once, under the rotated storage ID; the observations
  // are source-entry timing and the durable destination of its first write.
  it(`waits for a private startup rotation before entering the source`, async () => {
    const adapter = createRecordingAdapter()
    const firstIndexEntered = createEventGate()
    const releaseFirstIndex = createEventGate()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    const sourceStarted = createEventGate()
    let expired = false
    let storageId = `startup-old-storage`
    let indexCalls = 0
    const indexRoutes: Array<{ storageId: string; signature: string }> = []
    let sourceStarts = 0
    let restarts = 0
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `startup-claim`,
    })
    adapter.renewCacheGenerationClaim = async () =>
      expired ? undefined : Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      storageId = `startup-new-storage`
      expired = false
      return { storageCollectionId: storageId, claimId: `startup-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (id, signature) => {
      indexRoutes.push({ storageId: recordedStorageId(id), signature })
      if (++indexCalls === 1) {
        firstIndexEntered.resolve()
        await releaseFirstIndex.promise
      }
    }
    let source!: TodoSyncParams
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `startup-rotation-before-source`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            source = params
            sourceStarts++
            params.markReady()
            sourceStarted.resolve()
            return {
              restartAfterScopedRecovery: () => {
                restarts++
              },
            }
          },
        },
        persistence: { adapter },
      }),
    )
    collection.createIndex((row) => row.title, { name: `held-title` })
    try {
      collection.startSyncImmediate()
      await atPersistedOracleCheckpoint(
        firstIndexEntered.promise,
        `first startup index`,
      )
      expired = true
      const dynamicIndex = collection.createIndex((row) => row.id, {
        name: `dynamic-id`,
      })
      const dynamicSignature = collection
        .getIndexMetadata()
        .find((metadata) => metadata.indexId === dynamicIndex.id)?.signature
      if (!dynamicSignature) throw new Error(`Missing dynamic index signature`)
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `private startup rotation`,
      )
      releaseFirstIndex.resolve()
      await flushAsyncWork()
      expect(sourceStarts).toBe(0)
      releaseRotation.resolve()
      await atPersistedOracleCheckpoint(sourceStarted.promise, `source entry`)
      await collection.stateWhenReady()
      expect(sourceStarts).toBe(1)
      expect(restarts).toBe(0)
      expect(indexRoutes).toContainEqual({
        storageId: `startup-new-storage`,
        signature: dynamicSignature,
      })

      source.begin()
      source.write({
        type: `insert`,
        value: { id: `fresh`, title: `New storage` },
      })
      await whenSyncAccepted(source.commit())
      expect(collection.get(`fresh`)).toMatchObject({ id: `fresh` })
      expect(
        adapter.applyCommittedTxCalls
          .filter((call) =>
            call.tx.mutations.some((mutation) => mutation.key === `fresh`),
          )
          .map((call) => call.collectionId),
      ).toEqual([`startup-new-storage`])
    } finally {
      releaseFirstIndex.resolve()
      releaseRotation.resolve()
      await collection.cleanup()
    }
  })

  // An active scoped rotation changes the physical index destination. The
  // independent registry is the Collection's current index metadata: every
  // index still present after rotation, including one added after bootstrap
  // captured its snapshot, must be routed to the new storage ID.
  it(`rebuilds current persisted indexes after active cache rotation`, async () => {
    const adapter = createRecordingAdapter()
    const rotationEntered = createEventGate()
    const releaseRotation = createEventGate()
    const bootstrapEntered = createEventGate()
    const releaseBootstrap = createEventGate()
    let storageId = `active-index-old`
    let recovery!: () => Promise<void>
    const indexRoutes: Array<{ storageId: string; signature: string }> = []
    adapter.claimCacheGeneration = async () => ({
      storageCollectionId: storageId,
      claimId: `active-index-claim`,
    })
    adapter.renewCacheGenerationClaim = async () => Date.now() + 10_000
    adapter.rotateCacheGeneration = async () => {
      rotationEntered.resolve()
      await releaseRotation.promise
      storageId = `active-index-new`
      return { storageCollectionId: storageId, claimId: `active-index-claim` }
    }
    adapter.releaseCacheGenerationClaim = async () => {}
    adapter.ensureIndex = async (id, signature) => {
      indexRoutes.push({ storageId: recordedStorageId(id), signature })
      if (
        recordedStorageId(id) === `active-index-new` &&
        signature === initialSignature
      ) {
        bootstrapEntered.resolve()
        await releaseBootstrap.promise
      }
    }
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `active-index-rotation`,
        syncMode: `on-demand`,
        getKey: (row) => row.id,
        defaultIndexType: BasicIndex,
        sync: {
          sync: (params) => {
            recovery = params.metadata!.persistence!.startScopedRecovery!
            params.markReady()
            return { restartAfterScopedRecovery: (gate) => gate }
          },
        },
        persistence: { adapter },
      }),
    )
    const initial = collection.createIndex((row) => row.title, {
      name: `initial-title`,
    })
    const initialSignature = collection
      .getIndexMetadata()
      .find((metadata) => metadata.indexId === initial.id)?.signature
    let activeRecovery: Promise<void> | undefined
    try {
      await collection.stateWhenReady()
      activeRecovery = recovery()
      await atPersistedOracleCheckpoint(
        rotationEntered.promise,
        `active index rotation`,
      )
      const added = collection.createIndex((row) => row.id, {
        name: `added-during-rotation`,
      })
      releaseRotation.resolve()
      await atPersistedOracleCheckpoint(
        bootstrapEntered.promise,
        `new-storage index bootstrap`,
      )
      const addedDuringBootstrap = collection.createIndex((row) => row.detail, {
        name: `added-during-bootstrap`,
      })
      const signatures = [initial.id, added.id, addedDuringBootstrap.id].map(
        (id) =>
          collection
            .getIndexMetadata()
            .find((metadata) => metadata.indexId === id)?.signature,
      )
      if (signatures.some((signature) => !signature)) {
        throw new Error(`Missing current index signature`)
      }
      releaseBootstrap.resolve()
      await atPersistedOracleCheckpoint(activeRecovery, `active index recovery`)
      for (const signature of signatures) {
        expect(indexRoutes).toContainEqual({
          storageId: `active-index-new`,
          signature,
        })
      }
    } finally {
      releaseRotation.resolve()
      releaseBootstrap.resolve()
      await Promise.allSettled([activeRecovery])
      await collection.cleanup()
    }
  })
})
