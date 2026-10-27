/**
 * Ordinary tests for persistedCollectionOptions single-process and remote subset wiring, transported subset validation, and coordinator configuration, as fixed scenarios. The subset demand and coordinator laws they touch are owned by persisted-oracle.test.ts, which keeps the generated retained-demand and follower cases.
 */
import { describe, expect, it, vi } from 'vitest'
import { IR, createCollection } from '@tanstack/db'
import {
  InvalidPersistedCollectionCoordinatorError,
  InvalidSyncConfigError,
  SingleProcessCoordinator,
  persistedCollectionOptions,
  toTransportedLoadSubsetOptions,
  validateRemoteSubsetOptions,
} from '../src'
import {
  atPersistedOracleCheckpoint,
  createNoopAdapter,
  createRecordingAdapter,
  flushAsyncWork,
  stripVirtualProps,
} from './persisted-support'
import type {
  Collection,
  LoadSubsetOptions,
  Subscription,
  SyncConfig,
} from '@tanstack/db'
import type {
  PersistedCollectionCoordinator,
  PersistedCollectionPersistence,
  PersistedSyncWrappedOptions,
  RemoteSubsetOwner,
} from '../src'
import type { Todo } from './persisted-support'

describe(`persistedCollectionOptions`, () => {
  it(`throws InvalidSyncConfigError when sync key is present but invalid`, () => {
    const invalidOptions = {
      id: `invalid-sync-shape`,
      getKey: (item: Todo) => item.id,
      sync: {} as unknown as SyncConfig<Todo, string>,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })

  it(`uses SingleProcessCoordinator when coordinator is omitted`, () => {
    const options = persistedCollectionOptions<Todo, string>({
      id: `default-coordinator`,
      getKey: (item) => item.id,
      persistence: {
        adapter: createNoopAdapter(),
      },
    })

    expect(options.persistence.coordinator).toBeInstanceOf(
      SingleProcessCoordinator,
    )
  })

  it(`coalesces duplicate single-process subset acknowledgements until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-coalesced`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const owner = Object.assign(
      vi.fn(() => loadGate),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicate = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          duplicateSettled = true
        })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicate])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`preserves process-local subset lifecycle fields for owner load and unload`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-live-fields`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const signal = new AbortController().signal
    const subscription = {
      on: () => () => {},
    } as unknown as Subscription
    const options: LoadSubsetOptions = { limit: 1, signal, subscription }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledTimes(1)
      const delivered = owner.mock.calls[0]![0] as LoadSubsetOptions
      expect(delivered).toMatchObject({ limit: 1 })
      expect(delivered.signal).toBe(signal)
      expect(delivered.subscription).toBe(subscription)

      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      expect(owner.unloadSubset).toHaveBeenCalledTimes(1)
      expect(owner.unloadSubset).toHaveBeenCalledWith(delivered)
    } finally {
      unregisterOwner()
    }
  })

  it(`coalesces same-stack single-process subset reentry until owner work finishes`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-reentrant`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const options: LoadSubsetOptions = { limit: 1 }
    let duplicate: Promise<void> | undefined
    let didReenter = false
    const owner = Object.assign(
      vi.fn(() => {
        if (!didReenter) {
          didReenter = true
          duplicate = coordinator.requestEnsureRemoteSubset(`todos`, options)
        }
        return loadGate
      }),
      { unloadSubset: vi.fn(), onError: vi.fn() },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      let firstSettled = false
      let duplicateSettled = false
      const first = coordinator
        .requestEnsureRemoteSubset(`todos`, options)
        .then(() => {
          firstSettled = true
        })
      await Promise.resolve()
      const duplicateResult = duplicate!.then(() => {
        duplicateSettled = true
      })
      await Promise.resolve()

      expect({
        ownerCalls: owner.mock.calls.length,
        firstSettled,
        duplicateSettled,
      }).toEqual({
        ownerCalls: 1,
        firstSettled: false,
        duplicateSettled: false,
      })

      releaseLoad()
      await Promise.all([first, duplicateResult])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  // Acquisition release gives the owner its cancellation opportunity before
  // the source load settles. A load that needs unload to settle is legal;
  // waiting for that load before calling unload deadlocks scoped recovery.
  it(`unloads a pending single-process subset before waiting for its source load`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-release-order`)
    let releaseLoad = (): void => {}
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const events: Array<string> = []
    const owner = Object.assign(
      vi.fn(async () => {
        events.push(`load-start`)
        await loadGate
        events.push(`load-finish`)
      }),
      {
        unloadSubset: vi.fn(() => {
          events.push(`unload`)
        }),
        onError: vi.fn(),
      },
    )
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      const load = coordinator.requestEnsureRemoteSubset(`todos`, options)
      await Promise.resolve()
      let releaseSettled = false
      const release = coordinator
        .requestReleaseRemoteSubset(`todos`, options)
        .then(() => {
          releaseSettled = true
        })
      await atPersistedOracleCheckpoint(
        release,
        `release before source settlement`,
      )

      const beforeLoadRelease = { events: [...events], releaseSettled }
      expect(beforeLoadRelease).toEqual({
        events: [`load-start`, `unload`],
        releaseSettled: true,
      })

      releaseLoad()
      await Promise.all([load, release])
      expect(events).toEqual([`load-start`, `unload`, `load-finish`])
    } finally {
      releaseLoad()
      unregisterOwner()
    }
  })

  it(`rejects unsupported single-process subset values before owner work`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-domain`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`in`, [
            new IR.PropRef([`todos`, `status`]),
            new IR.Value([`kept`, () => {}]),
          ]),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1].value[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`rejects a sparse function argument at its exact expression path`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-hole`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const args = [new IR.PropRef([`todos`, `status`])]
    args.length = 2

    try {
      await expect(
        coordinator.requestEnsureRemoteSubset(`todos`, {
          where: new IR.Func(`eq`, args),
        }),
      ).rejects.toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path: `options.where.args[1]`,
      })
      expect(owner).not.toHaveBeenCalled()
    } finally {
      unregisterOwner()
    }
  })

  it(`preserves an explicit source alias through remote subset projection`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-wire-alias`)
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(),
      onError: vi.fn(),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = {
      where: new IR.Func(`eq`, [
        new IR.PropRef([`todos`, `status`], `todos`),
        new IR.Value(`kept`),
      ]),
    }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      expect(owner).toHaveBeenCalledWith({
        where: {
          type: `func`,
          name: `eq`,
          args: [
            { type: `ref`, path: [`todos`, `status`], sourceAlias: `todos` },
            { type: `val`, value: `kept` },
          ],
        },
      })
    } finally {
      await coordinator.requestReleaseRemoteSubset(`todos`, options)
      unregisterOwner()
    }
  })

  it(`rejects a remote subset source alias that disagrees with its path`, () => {
    expect(() =>
      toTransportedLoadSubsetOptions({
        where: new IR.Func(`eq`, [
          new IR.PropRef([`todos`, `status`], `other`),
          new IR.Value(`kept`),
        ]),
      }),
    ).toThrowError(/options\.where\.args\[0\]\.sourceAlias/)
  })

  // A projection is a detached snapshot at one call boundary. A later call on
  // reused input must observe its current data, without changing the first
  // snapshot. This distinguishes safe per-call reuse from a global identity cache.
  it(`takes a fresh detached wire snapshot on each projection`, () => {
    const literal = new IR.Value({ label: `before` })
    const options = {
      where: new IR.Func(`eq`, [new IR.PropRef([`value`]), literal]),
    }
    const first = toTransportedLoadSubsetOptions(options)
    literal.value.label = `after`
    const second = toTransportedLoadSubsetOptions(options)
    expect(first.where).toMatchObject({
      args: [{}, { value: { label: `before` } }],
    })
    expect(second.where).toMatchObject({
      args: [{}, { value: { label: `after` } }],
    })
    expect(first).not.toBe(second)
  })

  // Read-only admission is a law about caller state, including builtin internal
  // slots that Object.freeze cannot protect. Capture expectations before either
  // traversal, and retain them when a later invalid field rejects the request.
  // Fresh snapshots must preserve internal aliases but share no mutable payload
  // with the caller or a later projection. These are two call-boundary histories,
  // not a reference implementation of the encoder.
  it.each([false, true])(
    `preserves caller state and detached snapshots / rejected suffix %s`,
    (rejectedSuffix) => {
      const date = new Date(`2026-09-16T12:34:56.123Z`)
      const buffer = new Uint8Array([7, 8]).buffer
      const shared = { label: `before` }
      const payload = {
        date,
        buffer,
        view: new Uint8Array(buffer),
        map: new Map([[shared, date]]),
        set: new Set([shared]),
        first: shared,
        second: shared,
      }
      // Compare values and aliases explicitly. In jsdom, structuredClone can
      // return a buffer from another realm, which Vitest's object comparison
      // does not equate with this realm's otherwise identical ArrayBuffer.
      // These observations preserve contents, order, multiplicity and identity
      // relationships without requiring cross-realm object equality.
      const observe = (value: typeof payload) => ({
        keys: Reflect.ownKeys(value),
        recordKeys: [
          Reflect.ownKeys(value.first),
          Reflect.ownKeys(value.second),
        ],
        date: value.date.getTime(),
        bytes: Array.from(new Uint8Array(value.buffer)),
        view: Array.from(value.view),
        map: [...value.map].map(([key, entry]) => ({
          label: key.label,
          date: entry.getTime(),
          keyIsFirst: key === value.first,
          valueIsDate: entry === value.date,
        })),
        set: [...value.set].map((entry) => ({
          label: entry.label,
          isFirst: entry === value.first,
        })),
        first: value.first.label,
        second: value.second.label,
        sharedRecord: value.first === value.second,
        sharedBuffer: value.view.buffer === value.buffer,
      })
      const before = {
        keys: [`date`, `buffer`, `view`, `map`, `set`, `first`, `second`],
        recordKeys: [[`label`], [`label`]],
        date: Date.UTC(2026, 8, 16, 12, 34, 56, 123),
        bytes: [7, 8],
        view: [7, 8],
        map: [
          {
            label: `before`,
            date: Date.UTC(2026, 8, 16, 12, 34, 56, 123),
            keyIsFirst: true,
            valueIsDate: true,
          },
        ],
        set: [{ label: `before`, isFirst: true }],
        first: `before`,
        second: `before`,
        sharedRecord: true,
        sharedBuffer: true,
      }
      // Calibrate the fixture before entering either production traversal.
      expect(observe(payload)).toEqual(before)
      const options = {
        where: new IR.Func(`eq`, [
          new IR.PropRef([`payload`]),
          new IR.Value(payload),
        ]),
        ...(rejectedSuffix ? { limit: -1 } : {}),
      }
      if (rejectedSuffix) {
        for (const visit of [
          validateRemoteSubsetOptions,
          toTransportedLoadSubsetOptions,
        ]) {
          expect(() => visit(options)).toThrowError(
            expect.objectContaining({
              name: `RemoteSubsetWireValueError`,
              path: `options.limit`,
            }),
          )
          expect(observe(payload)).toEqual(before)
        }
        return
      }
      expect(validateRemoteSubsetOptions(options)).toBeUndefined()
      expect(observe(payload)).toEqual(before)
      const first = toTransportedLoadSubsetOptions(options)
      expect(observe(payload)).toEqual(before)
      date.setTime(1)
      new Uint8Array(buffer)[0] = 9
      shared.label = `after`
      payload.map.clear()
      payload.set.clear()
      const after = {
        ...before,
        date: 1,
        bytes: [9, 8],
        view: [9, 8],
        map: [],
        set: [],
        first: `after`,
        second: `after`,
      }
      expect(observe(payload)).toEqual(after)
      expect(validateRemoteSubsetOptions(options)).toBeUndefined()
      expect(observe(payload)).toEqual(after)
      const second = toTransportedLoadSubsetOptions(options)
      expect(observe(payload)).toEqual(after)
      for (const [snapshot, expected] of [
        [first, before],
        [second, after],
      ] as const) {
        if (snapshot.where?.type !== `func`)
          throw new Error(`missing predicate`)
        const literal = snapshot.where.args[1]
        if (literal?.type !== `val`) throw new Error(`missing literal`)
        const value = literal.value as typeof payload
        expect(observe(value)).toEqual(expected)
        expect(value.first).toBe(value.second)
        expect(value.view.buffer).toBe(value.buffer)
        for (const key of Object.keys(payload) as Array<keyof typeof payload>)
          expect(value[key]).not.toBe(payload[key])
      }
    },
  )

  // Both modes enforce the complete request schema. Validation must only read
  // the caller's frozen graph; projection still returns detached request data.
  it.each([`lexical`, `locale`] as const)(
    `validates frozen request fields without projecting or rewriting them / %s`,
    (stringSort) => {
      const reference = new IR.PropRef([`todos`, `title`], `todos`)
      const literal = new IR.Value({ label: `unchanged` })
      const where = new IR.Func(`eq`, [reference, literal])
      const compareOptions = {
        direction: `asc` as const,
        nulls: `last` as const,
        stringSort,
        locale: `en`,
        localeOptions: { sensitivity: `base` as const },
      }
      const clause = { expression: reference, compareOptions }
      const options = {
        where,
        orderBy: [clause, clause],
        cursor: { whereFrom: where, whereCurrent: where, lastKey: `last` },
        limit: 0,
        offset: Number.MAX_SAFE_INTEGER,
        signal: new AbortController().signal,
      }
      for (const value of [
        options,
        where,
        where.args,
        reference,
        reference.path,
        literal,
        literal.value,
        options.orderBy,
        clause,
        compareOptions,
        compareOptions.localeOptions,
        options.cursor,
      ])
        Object.freeze(value)
      expect(validateRemoteSubsetOptions(options)).toBeUndefined()
      const result = toTransportedLoadSubsetOptions(options)
      expect(result).toMatchObject({
        limit: 0,
        offset: Number.MAX_SAFE_INTEGER,
      })
      expect(result.where).not.toBe(where)
      expect(result.cursor?.whereFrom).toBe(result.where)
      expect(result.cursor?.whereCurrent).toBe(result.where)
      expect(result.orderBy?.[0]).toBe(result.orderBy?.[1])
      expect(result.orderBy?.[0]?.compareOptions).toEqual(
        stringSort === `lexical`
          ? { direction: `asc`, nulls: `last`, stringSort }
          : compareOptions,
      )
      expect(options.cursor.whereFrom).toBe(where)
      expect(options.orderBy[0]).toBe(clause)
    },
  )

  it(`projects lexical comparison options without locale-only wire fields`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `lexical`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as unknown as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      stringSort: `lexical`,
    })
  })

  it(`preserves locale comparison fields when the optional sort mode is omitted`, () => {
    const projected = toTransportedLoadSubsetOptions({
      orderBy: [
        {
          expression: new IR.PropRef([`todos`, `title`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
    } as LoadSubsetOptions)

    expect(projected.orderBy?.[0]?.compareOptions).toEqual({
      direction: `asc`,
      nulls: `last`,
      locale: `en`,
      localeOptions: { sensitivity: `base` },
    })
  })

  it.each([
    [`limit`, { limit: Number.NaN }, `options.limit`],
    [`limit`, { limit: Number.POSITIVE_INFINITY }, `options.limit`],
    [`limit`, { limit: -1 }, `options.limit`],
    [`limit`, { limit: 0.5 }, `options.limit`],
    [`limit`, { limit: Number.MAX_SAFE_INTEGER + 1 }, `options.limit`],
    [`offset`, { offset: Number.NaN }, `options.offset`],
    [`offset`, { offset: Number.NEGATIVE_INFINITY }, `options.offset`],
    [`offset`, { offset: -1 }, `options.offset`],
    [`offset`, { offset: 0.5 }, `options.offset`],
    [`offset`, { offset: Number.MAX_SAFE_INTEGER + 1 }, `options.offset`],
  ] as const)(
    `rejects an invalid transported subset %s before owner work`,
    (_field, options, path) => {
      let error: unknown
      try {
        toTransportedLoadSubsetOptions(options)
      } catch (caught) {
        error = caught
      }
      expect(error).toMatchObject({
        name: `RemoteSubsetWireValueError`,
        path,
      })
    },
  )

  it(`preserves valid transported subset window boundaries`, () => {
    expect(
      toTransportedLoadSubsetOptions({
        limit: 0,
        offset: Number.MAX_SAFE_INTEGER,
      }),
    ).toEqual({ limit: 0, offset: Number.MAX_SAFE_INTEGER })
  })

  it(`transports an explicit source refetch without changing subset data`, () => {
    expect(toTransportedLoadSubsetOptions({ limit: 1, refetch: true })).toEqual(
      {
        limit: 1,
        refetch: true,
      },
    )
    expect(() =>
      toTransportedLoadSubsetOptions({ refetch: `true` } as never),
    ).toThrow(`options.refetch`)
  })

  it(`reports and rethrows a single-process owner unload rejection`, async () => {
    const coordinator = new SingleProcessCoordinator(`single-unload-error`)
    const unloadError = new Error(`single-process owner unload failed`)
    const ownerErrors: Array<unknown> = []
    const owner = Object.assign(vi.fn(), {
      unloadSubset: vi.fn(() =>
        Promise.reject(unloadError),
      ) as unknown as RemoteSubsetOwner[`unloadSubset`],
      onError: (error: unknown) => ownerErrors.push(error),
    })
    const unregisterOwner = coordinator.registerRemoteSubsetOwner(
      `todos`,
      owner,
    )
    const options: LoadSubsetOptions = { limit: 1 }

    try {
      await coordinator.requestEnsureRemoteSubset(`todos`, options)
      await expect(
        coordinator.requestReleaseRemoteSubset(`todos`, options),
      ).rejects.toBe(unloadError)
      expect(ownerErrors).toEqual([unloadError])
    } finally {
      unregisterOwner()
    }
  })

  it(`reports one fail-stop lifecycle error when a single-process async unload rejects`, async () => {
    const unloadError = new Error(`remote owner unload failed`)
    let unloadThenCalls = 0
    const rejectingThenable = {
      then: (
        _resolve: (value?: void) => void,
        reject: (error: unknown) => void,
      ) => {
        unloadThenCalls++
        queueMicrotask(() => reject(unloadError))
      },
    }
    const sourceUnloadMock = vi.fn((options: LoadSubsetOptions) =>
      options.limit === 1 ? rejectingThenable : undefined,
    )
    const sourceUnload = sourceUnloadMock as unknown as (
      options: LoadSubsetOptions,
    ) => void
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `owner-unload-error`,
        getKey: (todo) => todo.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => true,
              unloadSubset: sourceUnload,
            }
          },
        },
        persistence: {
          adapter: createRecordingAdapter(),
        },
      }),
    )
    const failing: LoadSubsetOptions = { limit: 1 }
    const sibling: LoadSubsetOptions = { limit: 2 }
    const markError = vi.spyOn(collection._lifecycle, `markError`)
    const unhandled: Array<unknown> = []
    const captureUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, captureUnhandled)

    try {
      collection.startSyncImmediate()
      await collection._sync.loadSubset(failing)
      await collection._sync.loadSubset(sibling)
      collection._sync.unloadSubset(failing)
      collection._sync.unloadSubset(sibling)
      await flushAsyncWork()
      await flushAsyncWork()

      expect({
        status: collection.status,
        error: collection._lifecycle.getSyncError(),
        unloadThenCalls,
        unloadOptions: sourceUnloadMock.mock.calls.map(([options]) => options),
        lifecycleErrors: markError.mock.calls.map(([error]) => error),
        unhandled,
      }).toEqual({
        status: `error`,
        error: unloadError,
        unloadThenCalls: 1,
        unloadOptions: [failing, sibling],
        lifecycleErrors: [unloadError],
        unhandled: [],
      })

      await flushAsyncWork()
      expect(sourceUnloadMock).toHaveBeenCalledTimes(2)
      expect(markError).toHaveBeenCalledTimes(1)
    } finally {
      process.off(`unhandledRejection`, captureUnhandled)
      await collection.cleanup()
    }
  })

  it(`surfaces duplicate remote-subset owner registration through the collection lifecycle`, async () => {
    const coordinator = new SingleProcessCoordinator()
    const unhandled: Array<unknown> = []
    const sourceLoads: Array<string> = []
    const onUnhandled = (error: unknown) => unhandled.push(error)
    process.on(`unhandledRejection`, onUnhandled)
    const create = (label: string) =>
      createCollection(
        persistedCollectionOptions<Todo, string>({
          id: `duplicate-owner-lifecycle`,
          getKey: (row) => row.id,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: () => {
                  sourceLoads.push(label)
                  return true
                },
                unloadSubset: () => {},
              }
            },
          },
          persistence: { adapter: createRecordingAdapter(), coordinator },
        }),
      )
    const first = create(`first`)
    let duplicate: ReturnType<typeof create> | undefined

    try {
      first.startSyncImmediate()
      await first.stateWhenReady()
      await vi.waitFor(() =>
        expect(
          (
            coordinator as unknown as {
              remoteSubsetOwners: Map<string, RemoteSubsetOwner>
            }
          ).remoteSubsetOwners.size,
        ).toBe(1),
      )
      duplicate = create(`duplicate`)
      duplicate.startSyncImmediate()
      const readinessError = await duplicate.stateWhenReady().then(
        () => undefined,
        (error: unknown) => error,
      )
      await flushAsyncWork()

      expect(readinessError).toMatchObject({
        name: `DuplicateRemoteSubsetOwnerError`,
        collectionId: `duplicate-owner-lifecycle`,
      })
      expect(duplicate.status).toBe(`error`)
      expect(sourceLoads).toEqual([])
      expect(unhandled).toEqual([])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
      await duplicate?.cleanup()
      await first.cleanup()
    }
  })

  it(`resolves persistence per collection and forwards schemaVersion`, () => {
    const baseAdapter = createNoopAdapter()
    const syncAdapter = createNoopAdapter()
    const localAdapter = createNoopAdapter()
    const resolverCalls: Array<{
      collectionId: string
      mode: `sync-present` | `sync-absent`
      schemaVersion?: number
    }> = []

    const persistence: PersistedCollectionPersistence = {
      adapter: baseAdapter,
      resolvePersistenceForCollection: (options) => {
        resolverCalls.push(options)
        return {
          adapter: options.mode === `sync-present` ? syncAdapter : localAdapter,
        }
      },
    }

    const syncOptions = persistedCollectionOptions<Todo, string>({
      id: `sync-collection`,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      schemaVersion: 7,
      persistence,
    })
    expect(syncOptions.persistence.adapter).toBe(syncAdapter)

    const localOptions = persistedCollectionOptions<Todo, string>({
      id: `local-collection`,
      getKey: (item) => item.id,
      schemaVersion: 3,
      persistence,
    })
    expect(localOptions.persistence.adapter).toBe(localAdapter)

    expect(resolverCalls).toEqual([
      {
        collectionId: `sync-collection`,
        mode: `sync-present`,
        schemaVersion: 7,
      },
      {
        collectionId: `local-collection`,
        mode: `sync-absent`,
        schemaVersion: 3,
      },
    ])
  })

  it(`throws for invalid coordinator implementations`, () => {
    const invalidCoordinator = {
      getNodeId: () => `node-1`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      // requestEnsurePersistedIndex is intentionally missing
    } as unknown as PersistedCollectionCoordinator

    expect(() =>
      persistedCollectionOptions<Todo, string>({
        id: `invalid-coordinator`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
          coordinator: invalidCoordinator,
        },
      }),
    ).toThrow(InvalidPersistedCollectionCoordinatorError)
  })

  // Every coordinator method the runtime calls is part of the contract, so a
  // coordinator missing any one of them fails at configuration, naming it,
  // rather than later inside message dispatch.
  it.each([
    `getNodeId`,
    `subscribe`,
    `publish`,
    `isLeader`,
    `ensureLeadership`,
    `requestEnsureRemoteSubset`,
    `requestReleaseRemoteSubset`,
    `registerRemoteSubsetOwner`,
    `requestEnsurePersistedIndex`,
    `requestApplyCommittedTx`,
  ] as const)(`rejects a coordinator without %s`, (method) => {
    const complete: Record<string, unknown> = {
      getNodeId: () => `node-1`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: async () => {},
      requestEnsureRemoteSubset: async () => {},
      requestReleaseRemoteSubset: async () => {},
      registerRemoteSubsetOwner: () => () => {},
      requestEnsurePersistedIndex: async () => {},
      requestApplyCommittedTx: async () => ({ term: 1, seq: 1 }),
    }
    delete complete[method]

    expect(() =>
      persistedCollectionOptions<Todo, string>({
        id: `coordinator-without-${method}`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
          coordinator: complete as unknown as PersistedCollectionCoordinator,
        },
      }),
    ).toThrow(
      `Invalid persisted collection coordinator: missing required "${method}" method`,
    )
  })

  it(`rejects an incomplete coordinator before starting a rich sync source`, async () => {
    type SourceParams = Parameters<SyncConfig<Todo, string>[`sync`]>[0]

    const adapter = createRecordingAdapter()
    const applyCommittedTx = adapter.applyCommittedTx
    let adapterApplies = 0
    adapter.applyCommittedTx = (...args) => {
      adapterApplies++
      return applyCommittedTx(...args)
    }
    let sourceCalls = 0
    let legacyCalls = 0
    let sourceParams: SourceParams | undefined
    let collectionConstructed = false
    let visible = false
    let configurationError: { name: string; message: string } | null = null
    let collection: Collection<Todo, string> | undefined

    const incompleteCoordinator = {
      getNodeId: () => `incomplete-rich-sync`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => false,
      ensureLeadership: () => Promise.resolve(),
      requestEnsurePersistedIndex: () => Promise.resolve(),
      // Remote subset routing is complete so this fixture isolates the
      // required committed-transaction method named by the assertion.
      requestEnsureRemoteSubset: () => Promise.resolve(),
      requestReleaseRemoteSubset: () => Promise.resolve(),
      registerRemoteSubsetOwner: () => () => {},
      requestApplyLocalMutations: () => {
        legacyCalls++
        return Promise.resolve({
          type: `rpc:applyLocalMutations:res` as const,
          rpcId: `legacy`,
          ok: true as const,
          term: 1,
          seq: 1,
          latestRowVersion: 1,
          acceptedMutationIds: [],
        })
      },
    } as unknown as PersistedCollectionCoordinator

    try {
      try {
        const options = persistedCollectionOptions<Todo, string>({
          id: `incomplete-rich-sync`,
          getKey: (todo) => todo.id,
          sync: {
            sync: (params) => {
              sourceCalls++
              sourceParams = params
              params.markReady()
            },
          },
          persistence: { adapter, coordinator: incompleteCoordinator },
        })
        collection = createCollection(options)
        collectionConstructed = true
      } catch (error) {
        const resolvedError =
          error instanceof Error ? error : new Error(String(error))
        configurationError = {
          name: resolvedError.name,
          message: resolvedError.message,
        }
      }

      if (collection) {
        collection.startSyncImmediate()
        await vi.waitFor(() => expect(sourceParams).toBeDefined())
        sourceParams!.begin()
        sourceParams!.metadata?.collection.set(`resume`, { offset: 7 })
        sourceParams!.truncate()
        sourceParams!.write({
          type: `insert`,
          value: { id: `rich`, title: `Visible before rejection` },
          metadata: { source: `remote` },
        })
        await Promise.resolve(sourceParams!.commit()).catch(() => undefined)
        visible = collection.has(`rich`)
      }
    } finally {
      await collection?.cleanup()
    }

    expect({
      configurationError,
      sourceCalls,
      collectionConstructed,
      visible,
      adapterApplies,
      legacyCalls,
    }).toEqual({
      configurationError: {
        name: `InvalidPersistedCollectionCoordinatorError`,
        message:
          'Invalid persisted collection coordinator: missing required "requestApplyCommittedTx" method',
      },
      sourceCalls: 0,
      collectionConstructed: false,
      visible: false,
      adapterApplies: 0,
      legacyCalls: 0,
    })
  })

  it(`preserves valid sync config in sync-present mode`, async () => {
    const adapter = createRecordingAdapter()
    const sync: SyncConfig<Todo, string> = {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: {
            id: `remote-1`,
            title: `From remote`,
          },
        })
        commit()
        markReady()
      },
    }

    const options = persistedCollectionOptions<Todo, string>({
      id: `sync-present`,
      getKey: (item: Todo) => item.id,
      sync,
      persistence: {
        adapter,
      },
    })

    const collection = createCollection(options)
    await collection.stateWhenReady()
    await flushAsyncWork()

    expect(stripVirtualProps(collection.get(`remote-1`))).toEqual({
      id: `remote-1`,
      title: `From remote`,
    })
    expect(adapter.applyCommittedTxCalls).toHaveLength(1)
    expect(adapter.applyCommittedTxCalls[0]?.tx.mutations[0]?.type).toBe(
      `update`,
    )
  })
})
