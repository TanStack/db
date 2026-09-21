import { describe, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src'
import type { PersistenceAdapter } from '../src'
import type { StandardSchemaV1 } from '@standard-schema/spec'

const adapter: PersistenceAdapter = {
  loadSubset: () => Promise.resolve([]),
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

  it(`discriminates sync mode from the presence of the sync key`, () => {
    persistedCollectionOptions({
      id: `local`,
      getKey: (row: RowOutput) => row.id,
      persistence: { adapter },
    })

    persistedCollectionOptions({
      id: `synced`,
      getKey: (row: RowOutput) => row.id,
      sync: {
        sync: ({ markReady }) => {
          markReady()
        },
      },
      persistence: { adapter },
    })

    persistedCollectionOptions({
      id: `invalid-undefined-sync`,
      getKey: (row: RowOutput) => row.id,
      // @ts-expect-error a present sync key must hold a SyncConfig
      sync: undefined,
      persistence: { adapter },
    })
  })
})
