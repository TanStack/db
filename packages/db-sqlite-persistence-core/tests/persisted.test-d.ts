import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  IndeterminateCommitError,
  PersistedCollectionDurabilityError,
  persistedCollectionOptions,
} from '../src'
import type {
  ApplyCommittedTxResponse,
  ApplyLocalMutationsResponse,
  EnsureRemoteSubsetRequest,
  EnsureRemoteSubsetResponse,
  IndeterminateCommitRequestType,
  PersistedCollectionCoordinator,
  PersistedCollectionUtils,
  PersistenceAdapter,
  RemoteSubsetWireValue,
  TransportedLoadSubsetOptions,
} from '../src'
import type { SyncConfig, UtilsRecord } from '@tanstack/db'

type Todo = {
  id: string
  title: string
}

interface LocalExtraUtils extends UtilsRecord {
  existingUtil: () => number
}

interface SyncExtraUtils extends UtilsRecord {
  refetch: () => Promise<void>
}

const adapter: PersistenceAdapter = {
  loadSubset: () => Promise.resolve([]),
  applyCommittedTx: () => Promise.resolve(),
  ensureIndex: () => Promise.resolve(),
}

describe(`persisted collection types`, () => {
  it(`exports the indeterminate commit reconciliation contract`, () => {
    const requestType: IndeterminateCommitRequestType = `rpc:applyLocalMutations:req`
    const error = new IndeterminateCommitError({
      collectionId: `todos`,
      requestType,
      previousLeaderId: `leader-a`,
      previousTerm: 1,
      currentLeaderId: null,
      currentTerm: null,
      cause: new Error(`channel closed`),
    })

    expectTypeOf(error.code).toEqualTypeOf<`INDETERMINATE_COMMIT`>()
    expectTypeOf(
      error.requestType,
    ).toEqualTypeOf<IndeterminateCommitRequestType>()
    expectTypeOf(error.previousLeaderId).toEqualTypeOf<string | null>()
    expectTypeOf(error.previousTerm).toEqualTypeOf<number | null>()
    expectTypeOf(error.currentLeaderId).toEqualTypeOf<string | null>()
    expectTypeOf(error.currentTerm).toEqualTypeOf<number | null>()
    expectTypeOf(error.cause).toEqualTypeOf<unknown>()
  })

  it(`exports the durability error and persistence response details`, () => {
    const cause = Object.assign(new Error(`disk failed`), {
      code: `SQLITE_FULL`,
      path: `todos.sqlite`,
    })
    const error = new PersistedCollectionDurabilityError(`durability failed`, {
      cause,
      code: cause.code,
      path: cause.path,
    })
    const response: Extract<
      ApplyCommittedTxResponse,
      { ok: false; code: `PERSISTENCE_ERROR` }
    > = {
      type: `rpc:applyCommittedTx:res`,
      rpcId: `durability`,
      ok: false,
      code: `PERSISTENCE_ERROR`,
      error: `disk failed`,
      sourceCode: `SQLITE_FULL`,
      path: [`database`, `todos.sqlite`],
    }
    const localMutationResponse: Extract<
      ApplyLocalMutationsResponse,
      { ok: false; code: `PERSISTENCE_ERROR` }
    > = {
      type: `rpc:applyLocalMutations:res`,
      rpcId: `local-durability`,
      ok: false,
      code: `PERSISTENCE_ERROR`,
      error: `disk failed`,
      sourceCode: `SQLITE_FULL`,
      path: [`database`, `todos.sqlite`],
    }

    expectTypeOf(error.cause).toEqualTypeOf<unknown>()
    expectTypeOf(error.code).toEqualTypeOf<unknown>()
    expectTypeOf(error.path).toEqualTypeOf<unknown>()
    expectTypeOf(response.sourceCode).toEqualTypeOf<
      string | number | undefined
    >()
    expectTypeOf(response.path).toEqualTypeOf<
      string | ReadonlyArray<string | number> | undefined
    >()
    expectTypeOf(localMutationResponse.sourceCode).toEqualTypeOf<
      string | number | undefined
    >()
    expectTypeOf(localMutationResponse.path).toEqualTypeOf<
      string | ReadonlyArray<string | number> | undefined
    >()
  })

  it(`exports the exact remote-subset transport domain`, () => {
    type WireRecord = { [key: string]: RemoteSubsetWireValue }
    const cyclic: WireRecord = {}
    cyclic.self = cyclic
    const supported: TransportedLoadSubsetOptions = {
      where: {
        type: `func`,
        name: `eq`,
        args: [
          { type: `ref`, path: [`todos`, `payload`] },
          {
            type: `val`,
            value: {
              missing: undefined,
              precise: 9_007_199_254_740_993n,
              date: new Date(Number.NaN),
              regexp: /wire/giu,
              buffer: new ArrayBuffer(4),
              view: new DataView(new ArrayBuffer(4)),
              typed: new Uint8Array([1, 2]),
              map: new Map<RemoteSubsetWireValue, RemoteSubsetWireValue>([
                [{ key: `object` }, cyclic],
              ]),
              set: new Set<RemoteSubsetWireValue>([cyclic]),
            },
          },
        ],
      },
      orderBy: [
        {
          expression: { type: `ref`, path: [`todos`, `title`] },
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
            locale: `en`,
            localeOptions: { sensitivity: `base` },
          },
        },
      ],
      cursor: {
        whereFrom: { type: `val`, value: `from` },
        whereCurrent: { type: `val`, value: `current` },
        lastKey: `key`,
      },
      limit: 10,
      offset: 2,
    }
    const request: EnsureRemoteSubsetRequest = {
      type: `rpc:ensureRemoteSubset:req`,
      rpcId: `wire`,
      acquisitionId: `wire-acquisition`,
      options: supported,
    }

    // @ts-expect-error every transported acquisition has a stable identity
    const requestWithoutAcquisition: EnsureRemoteSubsetRequest = {
      type: `rpc:ensureRemoteSubset:req`,
      rpcId: `wire-without-acquisition`,
      options: supported,
    }

    expectTypeOf(request.options).toEqualTypeOf<TransportedLoadSubsetOptions>()
    expectTypeOf(request.acquisitionId).toEqualTypeOf<string>()
    expectTypeOf<
      Extract<EnsureRemoteSubsetResponse, { ok: true }>
    >().toHaveProperty(`leaderId`)
    expectTypeOf(
      requestWithoutAcquisition,
    ).toEqualTypeOf<EnsureRemoteSubsetRequest>()
    type RegisteredOwner = Parameters<
      NonNullable<PersistedCollectionCoordinator[`registerRemoteSubsetOwner`]>
    >[1]
    expectTypeOf<RegisteredOwner>()
      .parameter(0)
      .toEqualTypeOf<TransportedLoadSubsetOptions>()

    // @ts-expect-error functions are not remote-subset wire values
    const functionValue: RemoteSubsetWireValue = () => {}
    // @ts-expect-error symbols are not remote-subset wire values
    const symbolValue: RemoteSubsetWireValue = Symbol(`unsupported`)
    // @ts-expect-error promises are not remote-subset wire values
    const promiseValue: RemoteSubsetWireValue = Promise.resolve()
    // @ts-expect-error weak collections are not remote-subset wire values
    const weakValue: RemoteSubsetWireValue = new WeakMap()
    // @ts-expect-error custom prototypes are not remote-subset wire values
    const customValue: RemoteSubsetWireValue = new (class Custom {
      value = `custom`
    })()
    // @ts-expect-error shared buffers are not remote-subset wire values
    const sharedValue: RemoteSubsetWireValue = new SharedArrayBuffer(4)
    const signalOptions: TransportedLoadSubsetOptions = {
      // @ts-expect-error live signals never cross the coordinator wire
      signal: new AbortController().signal,
    }
    const subscriptionOptions: TransportedLoadSubsetOptions = {
      // @ts-expect-error live subscriptions never cross the coordinator wire
      subscription: {},
    }

    expectTypeOf(functionValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(symbolValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(promiseValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(weakValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(customValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(sharedValue).toEqualTypeOf<RemoteSubsetWireValue>()
    expectTypeOf(signalOptions).toEqualTypeOf<TransportedLoadSubsetOptions>()
    expectTypeOf(
      subscriptionOptions,
    ).toEqualTypeOf<TransportedLoadSubsetOptions>()
  })

  it(`requires complete committed-transaction routing from coordinators`, () => {
    // @ts-expect-error requestApplyCommittedTx is required for every coordinator
    const incompleteCoordinator: PersistedCollectionCoordinator = {
      getNodeId: () => `incomplete`,
      subscribe: () => () => {},
      publish: () => {},
      isLeader: () => true,
      ensureLeadership: () => Promise.resolve(),
      requestEnsureRemoteSubset: () => Promise.resolve(),
      requestReleaseRemoteSubset: () => Promise.resolve(),
      registerRemoteSubsetOwner: () => () => {},
      requestEnsurePersistedIndex: () => Promise.resolve(),
    }

    expectTypeOf(
      incompleteCoordinator,
    ).toMatchTypeOf<PersistedCollectionCoordinator>()
  })

  it(`adds persisted utils in sync-absent mode`, () => {
    const options = persistedCollectionOptions<
      Todo,
      string,
      never,
      LocalExtraUtils
    >({
      id: `persisted-local-only`,
      schemaVersion: 1,
      getKey: (item) => item.id,
      utils: {
        existingUtil: () => 42,
      },
      persistence: {
        adapter,
      },
    })

    expectTypeOf(options.utils.existingUtil).toBeFunction()
    expectTypeOf(options.utils.existingUtil).returns.toEqualTypeOf<number>()
    expectTypeOf(options.utils.acceptMutations).toBeFunction()
    expectTypeOf(options.utils.getLeadershipState).toEqualTypeOf<
      (() => { nodeId: string; isLeader: boolean }) | undefined
    >()

    const collection = createCollection(options)
    expectTypeOf(collection.utils.acceptMutations).toBeFunction()
    expectTypeOf(collection.utils).toMatchTypeOf<PersistedCollectionUtils>()
  })

  it(`preserves sync-present utility typing`, () => {
    const sync: SyncConfig<Todo, string> = {
      sync: ({ markReady }) => {
        markReady()
      },
    }

    const options = persistedCollectionOptions<
      Todo,
      string,
      never,
      SyncExtraUtils
    >({
      id: `persisted-sync-present`,
      schemaVersion: 2,
      getKey: (item) => item.id,
      sync,
      utils: {
        refetch: async () => {},
      },
      persistence: {
        adapter,
      },
    })

    expectTypeOf(options.sync).toEqualTypeOf<SyncConfig<Todo, string>>()
    expectTypeOf(options.utils).toEqualTypeOf<SyncExtraUtils | undefined>()

    const collection = createCollection(options)
    expectTypeOf(collection.utils.refetch).toBeFunction()
  })

  it(`requires persistence config`, () => {
    // @ts-expect-error persistedCollectionOptions requires a persistence config
    persistedCollectionOptions({
      getKey: (item: Todo) => item.id,
      sync: {
        sync: ({ markReady }: { markReady: () => void }) => {
          markReady()
        },
      },
    })
  })

  it(`requires a valid sync config when sync key is present`, () => {
    persistedCollectionOptions({
      getKey: (item: Todo) => item.id,
      // @ts-expect-error sync must be a valid SyncConfig object when provided
      sync: null,
      persistence: {
        adapter,
      },
    })
  })
})
