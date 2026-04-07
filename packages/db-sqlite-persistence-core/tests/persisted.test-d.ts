import { describe, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import type { PersistedCollectionUtils } from '../src'
import type { PersistenceAdapter } from '../src/persisted'
import type { SyncConfig, UtilsRecord, WithVirtualProps } from '@tanstack/db'

type OutputWithVirtual<
  T extends object,
  TKey extends string | number = string | number,
> = WithVirtualProps<T, TKey>

type ItemOf<T> = T extends Array<infer U> ? U : T

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
    })

    persistedCollectionOptions({
      getKey: (item: Todo) => item.id,
      // @ts-expect-error persistedCollectionOptions requires a persistence config when sync is provided
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

  it(`should work with schema and infer correct types when saved to a variable in sync-absent mode`, () => {
    const testSchema = z.object({
      id: z.string(),
      title: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    type ExpectedType = z.infer<typeof testSchema>
    type ExpectedInput = z.input<typeof testSchema>

    const schemaAdapter: PersistenceAdapter<ExpectedType, string> = {
      loadSubset: () => Promise.resolve([]),
      applyCommittedTx: () => Promise.resolve(),
      ensureIndex: () => Promise.resolve(),
    }

    const options = persistedCollectionOptions({
      id: `test-local-schema`,
      schema: testSchema,
      schemaVersion: 1,
      getKey: (item) => item.id,
      persistence: { adapter: schemaAdapter },
    })

    expectTypeOf(options.schema).toEqualTypeOf<typeof testSchema>()

    const collection = createCollection(options)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<ExpectedType, string>>
    >()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })
  })

  it(`should work with schema and infer correct types when nested in createCollection in sync-absent mode`, () => {
    const testSchema = z.object({
      id: z.string(),
      title: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    type ExpectedType = z.infer<typeof testSchema>
    type ExpectedInput = z.input<typeof testSchema>

    const schemaAdapter: PersistenceAdapter<ExpectedType, string> = {
      loadSubset: () => Promise.resolve([]),
      applyCommittedTx: () => Promise.resolve(),
      ensureIndex: () => Promise.resolve(),
    }

    const collection = createCollection(
      persistedCollectionOptions({
        id: `test-local-schema-nested`,
        schema: testSchema,
        schemaVersion: 1,
        getKey: (item) => item.id,
        persistence: { adapter: schemaAdapter },
      }),
    )

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<ExpectedType, string>>
    >()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })
  })

  it(`should work with schema and infer correct types when saved to a variable in sync-present mode`, () => {
    const testSchema = z.object({
      id: z.string(),
      title: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    type ExpectedType = z.infer<typeof testSchema>
    type ExpectedInput = z.input<typeof testSchema>

    const schemaAdapter: PersistenceAdapter<ExpectedType, string> = {
      loadSubset: () => Promise.resolve([]),
      applyCommittedTx: () => Promise.resolve(),
      ensureIndex: () => Promise.resolve(),
    }

    const options = persistedCollectionOptions({
      id: `test-sync-schema`,
      schema: testSchema,
      schemaVersion: 1,
      getKey: (item) => item.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter: schemaAdapter },
    })

    expectTypeOf(options.schema).toEqualTypeOf<typeof testSchema>()

    const collection = createCollection(options)

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<ExpectedType, string>>
    >()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })
  })

  it(`should work with schema and infer correct types when nested in createCollection in sync-present mode`, () => {
    const testSchema = z.object({
      id: z.string(),
      title: z.string(),
      createdAt: z.date().optional().default(new Date()),
    })

    type ExpectedType = z.infer<typeof testSchema>
    type ExpectedInput = z.input<typeof testSchema>

    const schemaAdapter: PersistenceAdapter<ExpectedType, string> = {
      loadSubset: () => Promise.resolve([]),
      applyCommittedTx: () => Promise.resolve(),
      ensureIndex: () => Promise.resolve(),
    }

    const collection = createCollection(
      persistedCollectionOptions({
        id: `test-sync-schema-nested`,
        schema: testSchema,
        schemaVersion: 1,
        getKey: (item) => item.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
          },
        },
        persistence: { adapter: schemaAdapter },
      }),
    )

    // Test that the collection has the correct inferred type from schema
    expectTypeOf(collection.toArray).toEqualTypeOf<
      Array<OutputWithVirtual<ExpectedType, string>>
    >()

    // Test insert parameter type
    type InsertParam = Parameters<typeof collection.insert>[0]
    expectTypeOf<ItemOf<InsertParam>>().toEqualTypeOf<ExpectedInput>()

    // Check that the update method accepts the expected input type
    collection.update(`1`, (draft) => {
      expectTypeOf(draft).toEqualTypeOf<ExpectedInput>()
    })
  })
})
