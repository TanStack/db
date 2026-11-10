import { afterEach, describe, expect, test } from 'vitest'
import { createMockFetch, createMockedUsersCollection } from './test.utils'

// query-db-collection starts an idle collection when one of its direct-write
// utils is called (its ownership-lifecycle tests own that law). The Supabase
// adapter wraps the query collection's sync config, so the wrapped collection
// must keep the behavior.

describe(`direct writes on an idle collection`, () => {
  let collection: ReturnType<typeof createMockedUsersCollection> | undefined

  afterEach(async () => {
    await collection?.cleanup()
    collection = undefined
  })

  test(`a direct write starts sync and stores the row without fetching`, () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)
    expect(collection.status).toBe(`idle`)

    const row = { id: 7, name: `Grace`, email: `grace@test.com`, active: true }
    collection.utils.writeUpsert(row)

    expect(collection.status).toBe(`ready`)
    expect(collection.get(`7`)).toMatchObject(row)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
