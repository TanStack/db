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

// Law: persisted options preserve createCollection's schema input/output roles,
// inferred key, and own-sync-key mode split. The hostile controls reject the
// output-as-input and present-but-undefined-sync fractures found in the old API.
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
