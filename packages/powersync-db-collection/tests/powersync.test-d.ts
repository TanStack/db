import { describe, expectTypeOf, it } from 'vitest'
import { Schema, Table, column } from '@powersync/node'
import { createCollection } from '@tanstack/db'
import { z } from 'zod'
import { powerSyncCollectionOptions } from '../src'
import type { PowerSyncCollectionUtils } from '../src'
import type { PowerSyncDatabase } from '@powersync/node'

const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
    created_at: column.text,
  }),
})

describe(`PowerSync collection type tests`, () => {
  it(`should type collection.utils as PowerSyncCollectionUtils after createCollection`, () => {
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: {} as PowerSyncDatabase,
        table: APP_SCHEMA.props.documents,
      }),
    )

    // Verify that collection.utils is typed as PowerSyncCollectionUtils, not UtilsRecord
    const utils: PowerSyncCollectionUtils<
      (typeof APP_SCHEMA.props)['documents']
    > = collection.utils
    expectTypeOf(utils.getMeta).toBeFunction()
    expectTypeOf(collection.utils.getMeta).toBeFunction()
  })

  it(`types compare against the schema's transformed output, not the raw SQLite row`, () => {
    // `created_at` is a SQLite TEXT column, transformed to a `Date` by the schema below.
    const schema = z.object({
      id: z.string(),
      name: z.string().nullable(),
      author: z.string().nullable(),
      created_at: z
        .string()
        .nullable()
        .transform((val) => (val ? new Date(val) : null)),
    })

    powerSyncCollectionOptions({
      database: {} as PowerSyncDatabase,
      table: APP_SCHEMA.props.documents,
      schema,
      onDeserializationError: () => {},
      compare: (left, right) => {
        // `compare` must receive the schema's output type, not `ExtractedTable`.
        expectTypeOf(left).toEqualTypeOf<z.infer<typeof schema>>()
        // This only type-checks because `created_at` is a `Date` here.
        return (
          (left.created_at?.getTime() ?? 0) - (right.created_at?.getTime() ?? 0)
        )
      },
    })

    powerSyncCollectionOptions({
      database: {} as PowerSyncDatabase,
      table: APP_SCHEMA.props.documents,
      schema,
      onDeserializationError: () => {},
      compare: (left, right) => {
        // `created_at` is a `Date` in the output type here, so a
        // `string`-only method like `localeCompare` must not type-check -
        // even though it would have against the raw (pre-transform) SQLite row.
        // @ts-expect-error
        return left.created_at!.localeCompare(right.created_at!)
      },
    })
  })
})
