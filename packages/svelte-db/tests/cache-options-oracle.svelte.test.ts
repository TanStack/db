/**
 * Client-backed Svelte queries receive the same independent-caller conflict
 * law as core and React. This driver supplies Svelte's real effect root and
 * flushSync cut; it does not restate option conflict semantics. Two admissions,
 * original reuse and exact accepted keyed rows are compared after native effect
 * delivery. Client-free reactive recompilation is a different contract.
 */
import { expect } from 'vitest'
import { DbClient, Query, collectionOptions } from '@tanstack/db'
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import {
  cacheOptionDeclarations,
  cacheOptionHistories,
  cacheOptionReach,
  checkCacheOptionAdmission,
  checkCacheOptionRows,
  conflictingCacheOptions,
} from '../../db/tests/live-query-cache-options-oracle'
import { withOracleCleanup } from '../../db/tests/utils'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-config'
import type { Observation, Verdict } from '../../db/tests/oracle-config'
import type {
  CacheOptionHistory,
  CacheRow,
} from '../../db/tests/live-query-cache-options-oracle'

declareOracle({
  owns: [`src/useLiveQuery.svelte.ts#useLiveQuery`],
  check: [checkCacheOptionAdmission, checkCacheOptionRows],
  model: [conflictingCacheOptions],
  grammar: [cacheOptionHistories],
})
async function recordHistory(
  history: CacheOptionHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
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
  const reads: Array<{
    declaration: 0 | 1
    read: () => Array<{ key: unknown; value: unknown }>
  }> = []
  const mount = (options: typeof first, declaration: 0 | 1) => {
    disposers.push(
      $effect.root(() => {
        const result = useLiveQuery(options)
        collections.add(result.collection)
        if (declaration === 0 || !conflictingCacheOptions(history))
          reads.push({
            declaration,
            read: () =>
              Array.from(result.state, ([key, value]) => ({ key, value })),
          })
      }),
    )
    flushSync()
  }
  await withOracleCleanup(async () => {
    await client.preloadLiveQuery(first)
    for (let attempt = 0; attempt < 2; attempt++) {
      let rejection: { error: unknown } | undefined
      try {
        mount(second, 1)
      } catch (error) {
        rejection = { error }
      }
      observe(attempt === 0 ? `admission` : `retry`, rejection)
      for (const state of cacheOptionReach(history)) observe(`reach`, state)
    }
    mount(first, 0)
    await Promise.resolve()
    flushSync()
    for (const { read, declaration } of reads)
      observe(`rows`, { declaration, rows: read() })
    observe(`read count`, reads.length)
    observe(`reach`, `original-reuse`)
  }, [
    () =>
      withOracleCleanup(() => {}, [
        ...disposers.map((dispose) => () => dispose()),
        ...[...collections].map((collection) => () => collection.cleanup()),
        () => client.cleanup(),
      ]),
  ])
}

// Keep the shared reference judgment intact: admission still uses declaration
// names, and rows still use the authored source values and declared key rule.
function modelHistory(history: CacheOptionHistory) {
  return {
    rows: [
      { id: `one`, label: `authored` },
      { id: `two`, label: `peer` },
    ],
    states: [...cacheOptionReach(history), `original-reuse`],
  }
}
function checkHistory(
  history: CacheOptionHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelHistory>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `reach`) continue
    try {
      if (checkpoint === `admission` || checkpoint === `retry`) {
        const rejection = value as { error: unknown } | undefined
        checkCacheOptionAdmission(() => {
          if (rejection) throw rejection.error
        }, history)
      } else if (checkpoint === `rows`) {
        const row = value as {
          declaration: 0 | 1
          rows: Array<{ key: unknown; value: unknown }>
        }
        checkCacheOptionRows(
          row.rows,
          expected.rows,
          history.getKey[row.declaration],
        )
      } else if (checkpoint === `read count`) expect(value).toBeGreaterThan(0)
      else
        return violation(checkpoint, `unexpected observation`, `cached options`)
    } catch (error) {
      if (!(error instanceof Error) || error.name !== `AssertionError`)
        throw error
      return {
        kind: `violation`,
        checkpoint,
        law: `cached options`,
        difference: error.message,
        cause: error,
      }
    }
  }
  for (const checkpoint of [`admission`, `retry`, `read count`])
    if (trace.filter((entry) => entry.checkpoint === checkpoint).length !== 1)
      return violation(checkpoint, `expected one observation`, `cached options`)
  const reads = trace.find(
    ({ checkpoint }) => checkpoint === `read count`,
  )?.value
  if (trace.filter(({ checkpoint }) => checkpoint === `rows`).length !== reads)
    return violation(
      `rows`,
      `every retained read must be compared`,
      `cached options`,
    )
  for (const state of expected.states)
    if (
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(
        state,
        `required receiving cut was not reached`,
        `cached options`,
      )
  return pass
}
oracleProperty({
  id: `svelte.cache-options`,
  law: {
    statement: `Independent DbClient callers reject conflicting local row options at admission and retry while original callers retain their accepted keyed rows.`,
    authority: `Maintainer same-identity conflict decision in packages/db/tests/live-query-cache-options-oracle.ts`,
    limits: `The existing 144 finite declaration/key pairs at Svelte effect-root and flushSync cuts; client-free recompilation is outside this receiver.`,
    owner: `packages/db/tests/live-query-cache-options-oracle.ts`,
  },
  histories: cacheOptionHistories,
  model: modelHistory,
  driver: recordHistory,
  check: checkHistory,
})
