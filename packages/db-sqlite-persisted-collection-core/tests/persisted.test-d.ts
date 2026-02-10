import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import type { PersistedCollectionUtils, PersistenceAdapter } from '../src'
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

const adapter: PersistenceAdapter<Todo, string> = {
  loadSubset: () => Promise.resolve([]),
  applyCommittedTx: () => Promise.resolve(),
  ensureIndex: () => Promise.resolve(),
}

describe(`persisted collection types`, () => {
  it(`adds persisted utils in sync-absent mode`, () => {
    const options = persistedCollectionOptions<
      Todo,
      string,
      never,
      LocalExtraUtils
    >({
      id: `persisted-local-only`,
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
