/**
 * The shared local-declaration model receives both mounted browser hooks and
 * real React server rendering. Server rendering never subscribes, so a passing
 * mounted admission check cannot stand in for its cached-snapshot read.
 *
 * Each independent option/presence history preloads one real source and query,
 * attempts the second config twice, then reads again with the original config.
 * Admission and exact original keys/ordinary row values are the comparison cuts.
 * The source-ID owner separately checks mounted inline retention. These drivers
 * do not claim hydrateRoot scheduling or reactive-framework option semantics.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { Suspense } from 'react'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { afterAll, expect, test, vi } from 'vitest'
import { DbProvider } from '../src/DbProvider'
import { useLiveQuery } from '../src/useLiveQuery'
import { useLiveSuspenseQuery } from '../src/useLiveSuspenseQuery'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  cacheOptionReach,
  cacheOptionReachStates,
  checkCacheOptionAdmission,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { withOracleCleanup } from '../../db/tests/utils'
import type { CacheRow } from '../../db/tests/live-query-cache-options-oracle'

declareOracle({
  check: [checkCacheOptionAdmission, checkCacheOptionRows],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})
const paths = [`client-render`, `suspense-render`, `server-render`] as const
const reaches = Object.fromEntries(
  paths.map((path) => [
    path,
    createOracleReach(`React cache options ${path}`, [
      `admission`,
      `retry`,
      `original-reuse`,
      ...(path !== `server-render` ? [`settled-client-rows`] : []),
      ...cacheOptionReachStates,
    ]),
  ]),
)
afterAll(() => {
  for (const reach of Object.values(reaches)) reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `React cache option reach`,
      Object.fromEntries(
        Object.entries(reaches).map(([path, reach]) => [
          path,
          Object.fromEntries(reach.counts()),
        ]),
      ),
    )
})

test.each(
  cacheOptionHistories.flatMap((history) =>
    paths.map((path) => ({ history, path })),
  ),
)(`React cache admission %j`, async ({ history, path }) => {
  const reach = reaches[path]!
  reach.beginHistory()
  const client = new DbClient()
  const rows: Array<CacheRow> = [
    { id: `one`, label: `first` },
    { id: `two`, label: `peer` },
  ]
  const source = client.collection(
    collectionOptions(`react-cache-options`, () => ({
      getKey: (row: CacheRow) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of rows)
            write({ type: `insert`, value: { ...value } })
          commit()
          markReady()
        },
      },
    })),
  )
  const query = new Query().from({ row: source })
  const [firstOptions, secondOptions] = cacheOptionDeclarations(history)
  // Runtime schema declaration identity is intentional here; this driver makes
  // no claim about public hook schema typing or schema transformation.
  const first = {
    query,
    getKey: firstOptions!.getKey,
    queryKey: firstOptions!.queryKey,
  }
  const second = {
    query,
    getKey: secondOptions!.getKey,
    queryKey: secondOptions!.queryKey,
  }
  Object.assign(first, { schema: firstOptions!.schema })
  Object.assign(second, { schema: secondOptions!.schema })

  const unmounts: Array<() => void> = []
  const settledReads: Array<() => void> = []
  const render = (options: typeof first, declaration: 0 | 1) => {
    if (path === `server-render`) {
      vi.stubGlobal(`window`, undefined)
      function Consumer() {
        const result = useLiveQuery(options)
        if (declaration === 0 || !conflictingCacheOptions(history))
          checkCacheOptionRows(
            Array.from(result.state, ([key, value]) => ({ key, value })),
            rows,
            history.getKey[declaration],
          )
        return <span>{result.data.map((row) => row.label).join(`,`)}</span>
      }
      const html = renderToString(
        <DbProvider client={client}>
          <Consumer />
        </DbProvider>,
      )
      expect(html).toContain(`first,peer`)
    } else {
      const useQuery = path.startsWith(`suspense`)
        ? useLiveSuspenseQuery
        : useLiveQuery
      const result = renderHook(() => useQuery(options), {
        wrapper: ({ children }) => (
          <DbProvider client={client}>
            <Suspense fallback={null}>{children}</Suspense>
          </DbProvider>
        ),
      })
      unmounts.push(result.unmount)
      if (declaration === 0 || !conflictingCacheOptions(history)) {
        const checkRows = () =>
          checkCacheOptionRows(
            Array.from(result.result.current.state, ([key, value]) => ({
              key,
              value,
            })),
            rows,
            history.getKey[declaration],
          )
        checkRows()
        settledReads.push(checkRows)
      }
    }
  }
  await withOracleCleanup(async () => {
    await client.preloadLiveQuery(first)
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const state of cacheOptionReach(history)) reach.reach(state)
      checkCacheOptionAdmission(() => render(second, 1), history)
      reach.reach(attempt === 0 ? `admission` : `retry`)
    }
    render(first, 0)
    reach.reach(`original-reuse`)
    if (path !== `server-render`) {
      // Admission stays synchronous. The receiving row law also applies after
      // React commits the cached seed-to-live handoff in its native scheduler.
      await act(async () => {})
      for (const checkRows of settledReads) checkRows()
      reach.reach(`settled-client-rows`)
    }
  }, [
    () => vi.unstubAllGlobals(),
    () =>
      act(async () => {
        await withOracleCleanup(() => {}, [
          ...unmounts.map((unmount) => () => unmount()),
          // Testing Library also owns roots whose initial render threw before
          // renderHook could return an unmount handle.
          () => cleanup(),
          () => client.cleanup(),
        ])
      }),
  ])
})
