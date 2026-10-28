/** Independent local config claims reuse the portable source-identity boundary.
 * Each history uses one real Collection and DbClient. Initial preload is either
 * still pending or settled; a second caller attempts preload, observer preload,
 * or observer subscription. Public admission must follow the shared model.
 * The bounded grammar covers all option axes, equality and distinct-key controls.
 * Real React receiving evidence uses the same histories and comparison.
 */
import { expect, test } from 'vitest'
import {
  DbClient,
  Query,
  createCollection,
  createLiveQueryObserver,
  getLiveQueryHash,
  localOnlyCollectionOptions,
  resolveLiveQueryValue,
} from '../src'
import { declareOracle } from './oracle-declaration'
import { createOracleReach } from './oracle-reach'
import {
  cacheOptionHistories,
  checkCacheOptionAdmission,
  conflictingCacheOptions,
} from './live-query-cache-options-oracle'

declareOracle({
  check: [checkCacheOptionAdmission],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})

test.each(
  cacheOptionHistories.flatMap((history) =>
    [false, true].flatMap((settled) =>
      [`preload`, `subscribe`, `observer-preload`].map((path) => ({
        ...history,
        settled,
        path,
      })),
    ),
  ),
)(
  `local cache options: %j`,
  async ({ option, different, distinctKey, keyed, settled, path }) => {
    const reach = createOracleReach(`cache options ${path}`, [`admission`])
    reach.beginHistory()
    const rows = createCollection(
      localOnlyCollectionOptions<{ id: string }>({
        getKey: (row) => row.id,
        initialData: [{ id: `one` }],
      }),
    )
    const client = new DbClient()
    const query = new Query().from({ row: rows })
    const key = (row: { id: string }) => row.id
    const schema = {
      '~standard': {
        version: 1,
        vendor: `cache-options`,
        validate: (value: unknown) => ({ value }),
      },
    }
    const first = {
      query,
      ...(option !== `schema` ? { getKey: key } : {}),
      queryKey: keyed ? [`cache-options`] : undefined,
    }
    const second = {
      query,
      ...(option !== `schema`
        ? {
            getKey: different
              ? (row: { id: string }) => `other-${row.id}`
              : key,
          }
        : {}),
      queryKey: distinctKey
        ? [`other-options`]
        : keyed
          ? [`cache-options`]
          : undefined,
    }
    if (option !== `getKey`) {
      Object.assign(first, { schema })
      Object.assign(second, { schema: different ? { ...schema } : schema })
    }
    let view: ReturnType<typeof resolveLiveQueryValue> | undefined
    let observer: ReturnType<typeof createLiveQueryObserver> | undefined
    let unsubscribe: (() => void) | undefined
    try {
      const initial = client.preloadLiveQuery(first)
      if (settled) await initial
      if (path === `preload`) {
        let next: Promise<void> | undefined
        checkCacheOptionAdmission(
          () => {
            next = client.preloadLiveQuery(second)
          },
          different,
          distinctKey,
        )
        await next
      } else {
        view = resolveLiveQueryValue(second)
        observer = createLiveQueryObserver(view, {
          client,
          queryHash: getLiveQueryHash(second, second.queryKey),
        })
        if (path === `subscribe`)
          checkCacheOptionAdmission(
            () => {
              unsubscribe = observer!.subscribe(() => {})
            },
            different,
            distinctKey,
          )
        else {
          const result = observer.preload()
          if (conflictingCacheOptions(different, distinctKey))
            await expect(result).rejects.toThrow(/getKey|schema/)
          else await result
        }
      }
      await initial
      reach.reach(`admission`)
      reach.assertReached()
    } finally {
      unsubscribe?.()
      observer?.dispose()
      await view?.cleanup()
      await client.cleanup()
      await rows.cleanup({ dependents: true })
    }
  },
)
