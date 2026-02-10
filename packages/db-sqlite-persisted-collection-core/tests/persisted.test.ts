import { describe, expect, it } from 'vitest'
import { createCollection, createTransaction } from '@tanstack/db'
import {
  InvalidPersistedCollectionCoordinatorError,
  InvalidPersistedStorageKeyEncodingError,
  InvalidPersistedStorageKeyError,
  InvalidSyncConfigError,
  SingleProcessCoordinator,
  createPersistedTableName,
  decodePersistedStorageKey,
  encodePersistedStorageKey,
  persistedCollectionOptions,
} from '../src'
import type {
  PersistedCollectionCoordinator,
  PersistedSyncWrappedOptions,
  PersistenceAdapter,
} from '../src'
import type { SyncConfig } from '@tanstack/db'

type Todo = {
  id: string
  title: string
}

function createNoopAdapter(): PersistenceAdapter<Todo, string> {
  return {
    loadSubset: () => Promise.resolve([]),
    applyCommittedTx: () => Promise.resolve(),
    ensureIndex: () => Promise.resolve(),
  }
}

describe(`persistedCollectionOptions`, () => {
  it(`provides a sync-absent loopback configuration with persisted utils`, async () => {
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-loopback`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
        },
      }),
    )

    const insertTx = collection.insert({
      id: `1`,
      title: `Phase 0`,
    })

    await insertTx.isPersisted.promise

    expect(collection.get(`1`)).toEqual({
      id: `1`,
      title: `Phase 0`,
    })
    expect(typeof collection.utils.acceptMutations).toBe(`function`)
    expect(collection.utils.getLeadershipState?.().isLeader).toBe(true)
  })

  it(`supports acceptMutations for manual transactions`, async () => {
    const collection = createCollection(
      persistedCollectionOptions<Todo, string>({
        id: `persisted-manual`,
        getKey: (item) => item.id,
        persistence: {
          adapter: createNoopAdapter(),
        },
      }),
    )

    const tx = createTransaction({
      autoCommit: false,
      mutationFn: ({ transaction }) => {
        collection.utils.acceptMutations(transaction)
        return Promise.resolve()
      },
    })

    tx.mutate(() => {
      collection.insert({
        id: `manual-1`,
        title: `Manual`,
      })
    })

    await tx.commit()

    expect(collection.get(`manual-1`)).toEqual({
      id: `manual-1`,
      title: `Manual`,
    })
  })

  it(`throws InvalidSyncConfigError when sync key is present but null`, () => {
    const invalidOptions = {
      id: `invalid-sync-null`,
      getKey: (item: Todo) => item.id,
      sync: null,
      persistence: {
        adapter: createNoopAdapter(),
      },
    } as unknown as PersistedSyncWrappedOptions<Todo, string>

    expect(() => persistedCollectionOptions(invalidOptions)).toThrow(
      InvalidSyncConfigError,
    )
  })

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

  it(`preserves valid sync config in sync-present mode`, () => {
    const sync: SyncConfig<Todo, string> = {
      sync: ({ markReady }) => {
        markReady()
      },
    }

    const options = persistedCollectionOptions({
      id: `sync-present`,
      getKey: (item: Todo) => item.id,
      sync,
      persistence: {
        adapter: createNoopAdapter(),
      },
    })

    expect(options.sync).toBe(sync)
  })
})

describe(`persisted key and identifier helpers`, () => {
  it(`encodes and decodes persisted storage keys without collisions`, () => {
    expect(encodePersistedStorageKey(1)).toBe(`n:1`)
    expect(encodePersistedStorageKey(`1`)).toBe(`s:1`)
    expect(decodePersistedStorageKey(`n:1`)).toBe(1)
    expect(decodePersistedStorageKey(`s:1`)).toBe(`1`)
    expect(Object.is(decodePersistedStorageKey(`n:-0`), -0)).toBe(true)
  })

  it(`throws for invalid persisted key values and encodings`, () => {
    expect(() => encodePersistedStorageKey(Number.POSITIVE_INFINITY)).toThrow(
      InvalidPersistedStorageKeyError,
    )
    expect(() => decodePersistedStorageKey(`legacy-key`)).toThrow(
      InvalidPersistedStorageKeyEncodingError,
    )
  })

  it(`creates deterministic safe table names`, () => {
    const first = createPersistedTableName(`todos`)
    const second = createPersistedTableName(`todos`)
    const tombstoneName = createPersistedTableName(`todos`, `t`)

    expect(first).toBe(second)
    expect(first).toMatch(/^c_[a-z2-7]+_[0-9a-z]+$/)
    expect(tombstoneName).toMatch(/^t_[a-z2-7]+_[0-9a-z]+$/)
  })
})
