import { describe, expectTypeOf, it } from 'vitest'
import { Schema, Table, column } from '@powersync/node'
import { createCollection } from '@tanstack/db'
import { powerSyncCollectionOptions } from '../src'
import type { PowerSyncCollectionUtils } from '../src'
import type { AbstractPowerSyncDatabase } from '@powersync/node'

const APP_SCHEMA = new Schema({
  documents: new Table({
    name: column.text,
    author: column.text,
  }),
})

describe(`PowerSync collection type tests`, () => {
  it(`should type collection.utils as PowerSyncCollectionUtils after createCollection`, () => {
    const collection = createCollection(
      powerSyncCollectionOptions({
        database: {} as AbstractPowerSyncDatabase,
        table: APP_SCHEMA.props.documents,
      }),
    )

    // Verify that collection.utils is typed as PowerSyncCollectionUtils, not UtilsRecord
    const utils: PowerSyncCollectionUtils<(typeof APP_SCHEMA.props)['documents']> =
      collection.utils
    expectTypeOf(utils.getMeta).toBeFunction()
    expectTypeOf(collection.utils.getMeta).toBeFunction()
  })
})
