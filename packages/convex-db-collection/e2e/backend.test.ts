/**
 * Fixed scenarios against the real local backend: a mirror beyond its row bound
 * rejects without publishing a partial result. The provider-boundary law and its
 * receiving histories are owned by backend-oracle.test.ts. These fixed tests
 * compare with written values and have no oracle owner (tracked in #2264).
 */
import { createCollection } from '@tanstack/db'
import { ConvexClient } from 'convex/browser'
import { ConvexReactClient } from 'convex/react'
import { makeFunctionReference } from 'convex/server'
import { describe, expect, inject, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { withTestCleanup } from '../tests/helpers'
import { seed } from './backend-support'
import type { Task } from './backend-support'
import type { PaginationOptions, PaginationResult } from 'convex/server'

const url = inject(`convexUrl`)

describe.each([`javascript`, `react`] as const)(
  `real backend with %s client`,
  (kind) => {
    it(`rejects a mirror beyond its row bound without publishing a partial result`, async () => {
      const client =
        kind === `javascript`
          ? new ConvexClient(url, { unsavedChangesWarning: false })
          : new ConvexReactClient(url, { unsavedChangesWarning: false })
      const collection = createCollection(
        convexPaginatedCollectionOptions({
          client,
          query: makeFunctionReference<
            `query`,
            { paginationOpts: PaginationOptions },
            PaginationResult<Task>
          >(`tasks:list`),
          queryArgs: {},
          pageSize: 4,
          maxRows: 5,
          getKey: (task) => task.clientId,
          gcTime: 0,
        }),
      )
      await withTestCleanup(
        async () => {
          await client.mutation(seed, { count: 23 })
          await expect(collection.preload()).rejects.toBeInstanceOf(RangeError)
          expect([...collection.values()]).toEqual([])
        },
        () => collection.cleanup(),
        () => client.close(),
      )
    })
  },
)
