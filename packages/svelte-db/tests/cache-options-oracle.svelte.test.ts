/**
 * Client-backed Svelte queries receive the same independent-caller conflict
 * law as core and React. This driver supplies Svelte's real effect root and
 * flushSync cut; it does not restate option conflict semantics. Two admissions,
 * original reuse and exact accepted keyed rows are compared after native effect
 * delivery. Client-free reactive recompilation is a different contract.
 */
import { afterAll, expect, test } from 'vitest'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  cacheOptionReach,
  cacheOptionReachStates,
  checkCacheOptionAdmission,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import { withOracleCleanup } from '../../db/tests/utils'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { createOracleReach } from '../../db/tests/oracle-reach'
import type { CacheRow } from '../../db/tests/live-query-cache-options-oracle'

const reach = createOracleReach(`Svelte cached options`, [
  `admission`,
  `retry`,
  `original-reuse`,
  ...cacheOptionReachStates,
])
afterAll(() => {
  reach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
    console.info(
      `Svelte cache option reach`,
      Object.fromEntries(reach.counts()),
    )
})
declareOracle({
  check: [checkCacheOptionAdmission, checkCacheOptionRows],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})
test.each(cacheOptionHistories)(`Svelte cached options %j`, async (history) => {
  reach.beginHistory()
  const client = new DbClient()
  const rows: Array<CacheRow> = [
    { id: `one`, label: `authored` },
    { id: `two`, label: `peer` },
  ]
  const source = client.collection(
    collectionOptions(`svelte-cache-source`, () => ({
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
  const [a, b] = cacheOptionDeclarations(history)
  const first = { client, query, getKey: a!.getKey, queryKey: a!.queryKey }
  const second = { client, query, getKey: b!.getKey, queryKey: b!.queryKey }
  // Runtime schema identity, with no schema transformation/type claim.
  Object.assign(first, { schema: a!.schema })
  Object.assign(second, { schema: b!.schema })
  const disposers: Array<() => void> = []
  const collections = new Set<{ cleanup: () => Promise<void> }>()
  const reads: Array<() => void> = []
  const mount = (options: typeof first, declaration: 0 | 1) => {
    disposers.push(
      $effect.root(() => {
        const result = useLiveQuery(options)
        collections.add(result.collection)
        if (declaration === 0 || !conflictingCacheOptions(history))
          reads.push(() =>
            checkCacheOptionRows(
              Array.from(result.state, ([key, value]) => ({ key, value })),
              rows,
              history.getKey[declaration],
            ),
          )
      }),
    )
    flushSync()
  }
  await withOracleCleanup(async () => {
    await client.preloadLiveQuery(first)
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const state of cacheOptionReach(history)) reach.reach(state)
      checkCacheOptionAdmission(() => mount(second, 1), history)
      reach.reach(attempt === 0 ? `admission` : `retry`)
    }
    mount(first, 0)
    await Promise.resolve()
    flushSync()
    for (const read of reads) read()
    expect(reads.length).toBeGreaterThan(0)
    reach.reach(`original-reuse`)
  }, [
    () =>
      withOracleCleanup(() => {}, [
        ...disposers.map((dispose) => () => dispose()),
        ...[...collections].map((collection) => () => collection.cleanup()),
        () => client.cleanup(),
      ]),
  ])
})
