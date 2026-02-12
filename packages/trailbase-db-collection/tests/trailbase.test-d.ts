import { describe, expectTypeOf, it } from 'vitest'
import { createCollection } from '@tanstack/db'
import { trailBaseCollectionOptions } from '../src/trailbase'
import type { TrailBaseCollectionUtils } from '../src/trailbase'
import type { RecordApi } from 'trailbase'

type TestItem = {
  id: string
  title: string
}

describe(`TrailBase collection type tests`, () => {
  it(`should type collection.utils as TrailBaseCollectionUtils after createCollection`, () => {
    const collection = createCollection(
      trailBaseCollectionOptions({
        id: `todos`,
        recordApi: {} as RecordApi<TestItem>,
        getKey: (item) => item.id,
        parse: {},
        serialize: {},
      }),
    )

    // Verify that collection.utils is typed as TrailBaseCollectionUtils, not UtilsRecord
    const utils: TrailBaseCollectionUtils = collection.utils
    expectTypeOf(utils.cancel).toBeFunction()
    expectTypeOf(collection.utils.cancel).toBeFunction()
  })
})
