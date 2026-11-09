import { createClient } from '@supabase/supabase-js'
import { createCollection } from '@tanstack/db'
import { afterEach, describe, expect, test } from 'vitest'
import pkg from '../package.json'
import { supabaseCollectionOptions } from '../src/index'
import { VERSION } from '../src/version'
import {
  SUPABASE_KEY,
  SUPABASE_URL,
  createMockFetch,
  createMockedUsersCollection,
  getRequestHeaders,
  queryResult,
  usersSchema,
} from './test.utils'

const EXPECTED_CLIENT_INFO = `@tanstack/supabase-db-collection/${VERSION}`

test('VERSION stays in sync with package.json', () => {
  expect(VERSION).toBe(pkg.version)
})

describe('automatic X-Client-Info header', () => {
  let collection: ReturnType<typeof createMockedUsersCollection>

  afterEach(() => {
    collection.cleanup()
  })

  test('is present on select requests', async () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)

    await queryResult((q) => q.from({ user: collection }))

    expect(getRequestHeaders(mockFetch, 0).get('x-client-info')).toBe(
      EXPECTED_CLIENT_INFO,
    )
  })

  test('is present on insert requests', async () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)
    await queryResult((q) => q.from({ user: collection }))

    const tx = collection.insert({
      id: 2,
      name: 'Bob',
      email: 'bob@test.com',
      active: true,
    })
    await tx.when('settled')

    const lastCall = mockFetch.mock.calls.length - 1
    expect(getRequestHeaders(mockFetch, lastCall).get('x-client-info')).toBe(
      EXPECTED_CLIENT_INFO,
    )
  })

  test('is present on update requests', async () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)
    await queryResult((q) => q.from({ user: collection }))

    const insertTx = collection.insert({
      id: 2,
      name: 'Bob',
      email: 'bob@test.com',
      active: true,
    })
    await insertTx.when('settled')

    const updateTx = collection.update('2', (draft) => {
      draft.name = 'Bobby'
    })
    await updateTx.when('settled')

    const lastCall = mockFetch.mock.calls.length - 1
    expect(getRequestHeaders(mockFetch, lastCall).get('x-client-info')).toBe(
      EXPECTED_CLIENT_INFO,
    )
  })

  test('is present on delete requests', async () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)
    await queryResult((q) => q.from({ user: collection }))

    const insertTx = collection.insert({
      id: 2,
      name: 'Bob',
      email: 'bob@test.com',
      active: true,
    })
    await insertTx.when('settled')

    const deleteTx = collection.delete('2')
    await deleteTx.when('settled')

    const lastCall = mockFetch.mock.calls.length - 1
    expect(getRequestHeaders(mockFetch, lastCall).get('x-client-info')).toBe(
      EXPECTED_CLIENT_INFO,
    )
  })

  test("replaces supabase-js's own X-Client-Info rather than appending", async () => {
    const mockFetch = createMockFetch()
    collection = createMockedUsersCollection(mockFetch)

    await queryResult((q) => q.from({ user: collection }))

    const value = getRequestHeaders(mockFetch, 0).get('x-client-info')
    expect(value).toBe(EXPECTED_CLIENT_INFO)
    expect(value).not.toContain('supabase-js')
  })

  test('preserves user-supplied global headers', async () => {
    const mockFetch = createMockFetch()
    collection = createCollection(
      supabaseCollectionOptions({
        tableName: 'users',
        keys: ['id'],
        schema: usersSchema,
        supabase: createClient(SUPABASE_URL, SUPABASE_KEY, {
          global: {
            fetch: mockFetch,
            headers: { 'X-Custom-Header': 'custom-value' },
          },
        }),
      }),
    )

    await queryResult((q) => q.from({ user: collection }))

    const headers = getRequestHeaders(mockFetch, 0)
    expect(headers.get('x-custom-header')).toBe('custom-value')
    expect(headers.get('x-client-info')).toBe(EXPECTED_CLIENT_INFO)
  })
})
