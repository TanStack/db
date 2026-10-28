/** The shared cache-options model receives a real mounted React caller. A
 * preloaded result is reused only with compatible local row options. The
 * initial render is the admission checkpoint; rerender retention is owned by
 * source-id-reuse-oracle.test.tsx and runs alongside this receiving witness.
 */
import { renderHook } from '@testing-library/react'
import {
  DbClient,
  Query,
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/db'
import { test } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import {
  cacheOptionHistories,
  checkCacheOptionAdmission,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'

declareOracle({
  check: [checkCacheOptionAdmission],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})

test.each(cacheOptionHistories)(
  `React cache option admission: %j`,
  async ({ option, different, distinctKey, keyed }) => {
    const reach = createOracleReach(`React cache options`, [`render-admission`])
    reach.beginHistory()
    const rows = createCollection(
      localOnlyCollectionOptions<{ id: string }>({
        getKey: (row) => row.id,
        initialData: [{ id: `one` }],
      }),
    )
    const client = new DbClient()
    const query = new Query().from({ row: rows })
    const getKey = (row: { id: string }) => row.id
    const schema = {
      '~standard': {
        version: 1,
        vendor: `cache-options`,
        validate: (value: unknown) => ({ value }),
      },
    }
    const first = {
      query,
      queryKey: keyed ? [`cache-options`] : undefined,
      ...(option !== `schema` ? { getKey } : {}),
    }
    const second = {
      query,
      queryKey: distinctKey
        ? [`different-options`]
        : keyed
          ? [`cache-options`]
          : undefined,
      ...(option !== `schema`
        ? {
            getKey: different
              ? (row: { id: string }) => `other-${row.id}`
              : getKey,
          }
        : {}),
    }
    if (option !== `getKey`) {
      Object.assign(first, { schema })
      Object.assign(second, { schema: different ? { ...schema } : schema })
    }
    let unmount: (() => void) | undefined
    try {
      await client.preloadLiveQuery(first)
      checkCacheOptionAdmission(
        () => {
          const rendered = renderHook(() => useLiveQuery(second), {
            wrapper: ({ children }) => (
              <DbProvider client={client}>{children}</DbProvider>
            ),
          })
          unmount = rendered.unmount
        },
        different,
        distinctKey,
      )
      reach.reach(`render-admission`)
      reach.assertReached()
    } finally {
      unmount?.()
      await client.cleanup()
      await rows.cleanup({ dependents: true })
    }
  },
)
