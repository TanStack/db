import { createCollection } from '@tanstack/db'
import { makeFunctionReference } from 'convex/server'
import { expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { convexOfflineMutation } from '../src/offline'
import {
  convexCollectionOptions,
  convexPaginatedCollectionOptions,
} from '../src/index'
import { query } from './helpers'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { ConvexReactClient } from 'convex/react'
import type { ConvexClient } from 'convex/browser'
import type { Row } from './helpers'

it(`infers rows, arguments, keys, projections, and schemas`, () => {
  const client = {} as ConvexClient
  const reactClient = {} as ConvexReactClient
  const options = convexCollectionOptions({
    client,
    query,
    queryArgs: { owner: `alice` },
    getKey: (row) => row._id,
    onUpdate: ({ transaction, collection }) => {
      expectTypeOf(transaction.mutations[0].modified).toEqualTypeOf<Row>()
      expectTypeOf(collection.utils.getSyncError()).toEqualTypeOf<unknown>()
      return Promise.resolve()
    },
  })
  const collection = createCollection(options)
  expectTypeOf(collection.get(`id`)!.text).toEqualTypeOf<string>()
  convexCollectionOptions({
    client,
    query,
    // @ts-expect-error Query arguments are inferred from the function reference.
    queryArgs: { owner: 1 },
    getKey: (row: Row) => row._id,
  })
  // @ts-expect-error Required query arguments cannot be omitted.
  convexCollectionOptions({ client, query, getKey: (row: Row) => row._id })
  convexCollectionOptions({
    client,
    query,
    queryArgs: { owner: `alice` },
    // @ts-expect-error A misspelled document field cannot be used as a key.
    getKey: (row) => row.missing,
  })

  const envelope = makeFunctionReference<`query`, {}, { rows: Array<Row> }>(
    `tasks:envelope`,
  )
  const selected = convexCollectionOptions({
    client: reactClient,
    query: envelope,
    queryArgs: {},
    select: (result) =>
      result.rows.map((row) => ({ id: row._id, length: row.text.length })),
    getKey: (row) => row.id,
  })
  expectTypeOf(
    createCollection(selected).get(`id`)!.length,
  ).toEqualTypeOf<number>()
  // @ts-expect-error Non-array query results need a projection.
  convexCollectionOptions({
    client,
    query: envelope,
    queryArgs: {},
    getKey: (row: Row) => row._id,
  })

  const schema = z.object({
    _id: z.string(),
    text: z.string(),
    optional: z.string().optional(),
  })
  const validated = createCollection(
    convexCollectionOptions({
      client,
      query,
      queryArgs: { owner: `alice` },
      schema,
      getKey: (row) => row._id,
    }),
  )
  expectTypeOf(validated.get(`id`)!.text).toEqualTypeOf<string>()
})

it(`infers paginated arguments and projected row types`, () => {
  const paginatedQuery = makeFunctionReference<
    `query`,
    { owner: string; paginationOpts: PaginationOptions },
    PaginationResult<Row>
  >(`tasks:pages`)
  const client = {} as ConvexClient
  const options = convexPaginatedCollectionOptions({
    client,
    query: paginatedQuery,
    queryArgs: { owner: `alice` },
    select: (rows) =>
      rows.map((row) => ({ id: row._id, length: row.text.length })),
    getKey: (row) => row.id,
  })
  expectTypeOf(
    createCollection(options).get(`a`)!.length,
  ).toEqualTypeOf<number>()
  convexPaginatedCollectionOptions({
    client,
    query: paginatedQuery,
    queryArgs: {
      owner: `alice`,
      // @ts-expect-error The adapter supplies paginationOpts, callers do not supply a cursor.
      paginationOpts: { cursor: null, numItems: 4 },
    },
    getKey: (row: Row) => row._id,
  })
  const invalid = makeFunctionReference<`mutation`, { text: string }, null>(
    `tasks:invalid`,
  )
  // @ts-expect-error Durable mutations must declare an idempotencyKey argument.
  convexOfflineMutation({
    client,
    mutation: invalid,
    getArgs: () => ({ text: `hello` }),
    collections: [],
  })
})

it(`requires a projection for changed paginated row types and server pagination arguments`, () => {
  const client = {} as ConvexClient
  const paginated = makeFunctionReference<
    `query`,
    { paginationOpts: PaginationOptions },
    PaginationResult<Row>
  >(`tasks:pages`)
  // @ts-expect-error A changed row type needs a select projection.
  convexPaginatedCollectionOptions({
    client,
    query: paginated,
    queryArgs: {},
    getKey: (row: { id: number }) => row.id,
  })
  const missingArguments = makeFunctionReference<
    `query`,
    {},
    PaginationResult<Row>
  >(`tasks:invalidPages`)
  // @ts-expect-error A paginated server query must accept paginationOpts.
  convexPaginatedCollectionOptions({
    client,
    query: missingArguments,
    queryArgs: {},
    getKey: (row: Row) => row._id,
  })
})
