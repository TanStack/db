import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import type { PersistenceAdapter } from '../src'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { CollectionConfig, WithVirtualProps } from '@tanstack/db'

const adapter: PersistenceAdapter = {
  loadSubset: () => Promise.resolve([]),
  loadResumeSnapshot: () =>
    Promise.resolve({
      rows: [],
      collectionMetadata: [],
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
      resetEpoch: 0,
    }),
  applyCommittedTx: () => Promise.resolve(),
  ensureIndex: () => Promise.resolve(),
}

type RowInput = { id: string; rank: string; label?: string }
type RowOutput = { id: string; rank: number; label: string }

const rowSchema = null as unknown as StandardSchemaV1<RowInput, RowOutput>

/**
 * # What does `persistedCollectionOptions` preserve?
 *
 * Law and source: the public `persistedCollectionOptions` utility must preserve
 * `createCollection`'s Standard Schema input, output, and inferred key contract.
 * Its own-key `sync` split comes from the persisted local-only and sync-wrapped
 * option overloads; a present `sync` key must contain a `SyncConfig`.
 *
 * Legal forms here are transforming-schema collections with and without
 * external sync, plus schema-free local and synced option objects. The public
 * type path is `persistedCollectionOptions(...)` into `createCollection(...)`.
 * The checkpoint is the resulting `insert`, `get`, and inferred key types.
 *
 * Positive observations accept schema input on insert, expose schema output on
 * read, infer string keys, and accept both sync modes. Hostile observations
 * reject output-as-input, numeric keys, and a present-but-undefined `sync`.
 * The valid local and synced cells control against rejecting every option.
 *
 * This oracle does not exercise schema parsing, adapter I/O, the returned
 * `PersistedCollectionUtils`, sync execution, or schema-validation failures.
 */
describe(`persisted collection option type oracle`, () => {
  it(`composes an inferred transforming schema with createCollection`, () => {
    const localOptions = persistedCollectionOptions({
      id: `local-schema`,
      schema: rowSchema,
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: { adapter },
    })

    const localCollection = createCollection(localOptions)
    localCollection.insert({ id: `row`, rank: `1` } satisfies RowInput)
    const localOutput: RowOutput | undefined = localCollection.get(`row`)
    void localOutput

    // @ts-expect-error getKey inferred string keys from the schema output
    localCollection.get(1)

    const syncedOptions = persistedCollectionOptions({
      id: `synced-schema`,
      schema: rowSchema,
      schemaVersion: 1,
      getKey: (row) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter },
    })

    const syncedCollection = createCollection(syncedOptions)
    syncedCollection.insert({ id: `row`, rank: `1` } satisfies RowInput)
    const syncedOutput: RowOutput | undefined = syncedCollection.get(`row`)
    void syncedOutput

    // @ts-expect-error transformed output values are not valid schema input
    syncedCollection.insert({ id: `row`, rank: 1, label: `output` })

    // @ts-expect-error getKey inferred string keys from the schema output
    syncedCollection.get(1)
  })

  it(`keeps schema input and output roles distinct`, () => {
    const collection = createCollection(
      persistedCollectionOptions({
        id: `schema-roles`,
        schema: rowSchema,
        getKey: (row) => row.id,
        persistence: { adapter },
      }),
    )

    collection.insert({ id: `row`, rank: `1` })

    // @ts-expect-error transformed output values are not valid schema input
    collection.insert({ id: `row`, rank: 1, label: `output` })

    const output = collection.get(`row`)
    if (output) {
      const rank: number = output.rank
      const label: string = output.label
      void rank
      void label
    }
  })

  type NumericRow = { id: number; rank: number; label: string }

  const utils = { labelLength: (label: string) => label.length }
  const stringConfig: Omit<
    CollectionConfig<RowOutput, string, never, typeof utils>,
    `sync`
  > = {
    id: `string-rows`,
    getKey: (row: RowOutput) => row.id,
  }
  const numericConfig: Omit<
    CollectionConfig<NumericRow, number, never, typeof utils>,
    `sync`
  > = {
    id: `numeric-rows`,
    getKey: (row: NumericRow) => row.id,
  }
  const stringOptions = { ...stringConfig, persistence: { adapter } }
  const numericOptions = { ...numericConfig, persistence: { adapter } }
  const sync = { sync: () => {} }

  it(`infers row and utility types with string keys`, () => {
    const localOptions = persistedCollectionOptions({ ...stringOptions, utils })
    const syncedOptions = persistedCollectionOptions({
      ...stringOptions,
      utils,
      sync,
    })
    const local = createCollection(localOptions)
    const synced = createCollection(syncedOptions)

    for (const collection of [local, synced]) {
      collection.insert({ id: `row`, rank: 1, label: `input` })
      expectTypeOf(collection.get(`row`)).toEqualTypeOf<
        WithVirtualProps<RowOutput, string> | undefined
      >()
      expectTypeOf(collection.get).parameters.toEqualTypeOf<[string]>()
      expectTypeOf(collection.utils.labelLength).toEqualTypeOf<
        typeof utils.labelLength
      >()
      // @ts-expect-error rank must be a number
      collection.insert({ id: `row`, rank: `1`, label: `input` })
      // @ts-expect-error keys must be strings
      collection.get(1)
      // @ts-expect-error labelLength takes a string
      collection.utils.labelLength(1)
    }
  })

  it(`infers row and utility types with numeric keys`, () => {
    const localOptions = persistedCollectionOptions({
      ...numericOptions,
      utils,
    })
    const syncedOptions = persistedCollectionOptions({
      ...numericOptions,
      utils,
      sync,
    })
    const local = createCollection(localOptions)
    const synced = createCollection(syncedOptions)

    for (const collection of [local, synced]) {
      collection.insert({ id: 1, rank: 1, label: `input` })
      expectTypeOf(collection.get(1)).toEqualTypeOf<
        WithVirtualProps<NumericRow, number> | undefined
      >()
      expectTypeOf(collection.get).parameters.toEqualTypeOf<[number]>()
      expectTypeOf(collection.utils.labelLength).toEqualTypeOf<
        typeof utils.labelLength
      >()
      // @ts-expect-error id must be a number
      collection.insert({ id: `row`, rank: 1, label: `input` })
      // @ts-expect-error keys must be numbers
      collection.get(`row`)
    }
  })

  it(`accepts explicit row and string key types`, () => {
    const local = createCollection(
      persistedCollectionOptions<RowOutput, string>(stringOptions),
    )
    const synced = createCollection(
      persistedCollectionOptions<RowOutput, string>({ ...stringOptions, sync }),
    )

    for (const collection of [local, synced]) {
      collection.insert({ id: `row`, rank: 1, label: `input` })
      expectTypeOf(collection.get(`row`)).toEqualTypeOf<
        WithVirtualProps<RowOutput, string> | undefined
      >()
      expectTypeOf(collection.get).parameters.toEqualTypeOf<[string]>()
      // @ts-expect-error rank must be a number
      collection.insert({ id: `row`, rank: `1`, label: `input` })
      // @ts-expect-error keys must be strings
      collection.get(1)
    }
  })

  it(`accepts explicit row and numeric key types`, () => {
    const local = createCollection(
      persistedCollectionOptions<NumericRow, number>(numericOptions),
    )
    const synced = createCollection(
      persistedCollectionOptions<NumericRow, number>({
        ...numericOptions,
        sync,
      }),
    )

    for (const collection of [local, synced]) {
      collection.insert({ id: 1, rank: 1, label: `input` })
      expectTypeOf(collection.get(1)).toEqualTypeOf<
        WithVirtualProps<NumericRow, number> | undefined
      >()
      expectTypeOf(collection.get).parameters.toEqualTypeOf<[number]>()
      // @ts-expect-error id must be a number
      collection.insert({ id: `row`, rank: 1, label: `input` })
      // @ts-expect-error keys must be numbers
      collection.get(`row`)
    }
  })

  it(`accepts explicit never and utility type arguments`, () => {
    const local = createCollection(
      persistedCollectionOptions<RowOutput, string, never, typeof utils>({
        ...stringOptions,
        utils,
      }),
    )
    const synced = createCollection(
      persistedCollectionOptions<RowOutput, string, never, typeof utils>({
        ...stringOptions,
        utils,
        sync,
      }),
    )

    for (const collection of [local, synced]) {
      expectTypeOf(collection.get(`row`)).toEqualTypeOf<
        WithVirtualProps<RowOutput, string> | undefined
      >()
      expectTypeOf(collection.utils.labelLength).toEqualTypeOf<
        typeof utils.labelLength
      >()
    }
  })

  it(`discriminates sync mode from the presence of the sync key`, () => {
    const localOptions = persistedCollectionOptions({
      id: `local`,
      getKey: (row: RowOutput) => row.id,
      persistence: { adapter },
    })
    createCollection(localOptions)

    const syncedOptions = persistedCollectionOptions({
      id: `synced`,
      getKey: (row: RowOutput) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter },
    })
    createCollection(syncedOptions)

    persistedCollectionOptions({
      id: `invalid-undefined-sync`,
      getKey: (row: RowOutput) => row.id,
      // @ts-expect-error a present sync key must hold a SyncConfig
      sync: undefined,
      persistence: { adapter },
    })
  })
})
