import { QueryClient, QueryObserver } from '@tanstack/query-core'
import fc from 'fast-check'
import { describe, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { createCursorPager } from '../src/index.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { Row } from './cursor-pagination/model-oracle.js'

/**
 * # Which cursor sequence may become the next public result?
 *
 * Growth, refresh, and nested readers can overlap. A forced refresh must not
 * join stale growth unless the old request is deliberately retained. A canceled
 * or failed sequence may settle and clean up, but its pages cannot become the
 * next public snapshot or clear the authority of a newer sequence.
 *
 * Real Query observers supply publication and next-use evidence. Immutable
 * fixture backends make stale cursor use visible. The full-relation model still
 * owns row truth; this file adds generation, cancellation, and publication
 * observations rather than copying Query's cache state.
 *
 * The forced-refresh and repeated-continuation laws come from
 * cursor-pagination/README.md and createCursorPager's documented contract.
 * The coverage map assigns bounded slice work to this owner: on cached
 * immutable pages, reading a requested slice visits only its rows. These
 * controlled sequences do not establish
 * snapshot consistency for changing endpoints or browser transport behavior;
 * the browser and live-window owners are listed in oracle-coverage.md.
 *
 * History grammar: page size 1–4 and depth 1–3/4 ensure a held growth or
 * final-page response; refresh crosses cancellation and retained/new pagers,
 * while malformed final tokens cross phase, earlier-token position, and Query
 * retry. Cancellation distinguishes supported forced refresh from the stale
 * publication control. Pager identity distinguishes queued same-pager reads
 * from cache-sharing peers. Size and depth vary the page boundary and loaded
 * prefix. Growth and refresh enter the malformed final page from different
 * cache states; token position selects which earlier page repeats, and retry
 * checks that another Query attempt cannot publish the malformed response.
 * A size-one/depth-one history reconstructs each refresh cell; size one,
 * depth four, and repeat 0–3 reconstruct every earlier-token position in both
 * malformed phases. The slice grammar covers counts 1–100, offsets 0–120,
 * and limits 0–120 or undefined; its zero, past-end, and unlimited margins
 * distinguish empty, bounded, and draining reads. An invented/foreign cursor
 * is outside this legal backend grammar and belongs to the boundary oracle.
 */

const scope = { group: undefined, descending: false }
const fixedSeed = 1_779_015
const rowsFor = (count: number, version = 0): Array<Row> =>
  Array.from({ length: count }, (_, id) => ({ id, rank: id, group: version }))
const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
    },
  })

async function driveCachedSlice(
  count: number,
  offset: number,
  limit: number | undefined,
  observe: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  const client = createClient()
  const rows = rowsFor(count)
  let visits = 0
  const observed = rows.map((row) => row)
  for (let index = 0; index < count; index++) {
    Object.defineProperty(observed, index, {
      enumerable: true,
      get: () => {
        visits++
        return rows[index]
      },
    })
  }
  const pager = createCursorPager({
    queryClient: client,
    queryKey: [`slice`],
    fetchPage: () => Promise.resolve({ rows: observed, nextCursor: null }),
  })
  try {
    await pager.read({})
    visits = 0
    observe(`rows`, await pager.read({ offset, limit }))
    observe(`visits`, visits)
  } finally {
    client.clear()
  }
}

declareOracle({
  check: [checkPublicationTrace],
  model: [expectedRows],
})

// The native check compares the same public facts in checkpoint order. It
// accepts a cut trace, so a later runtime or cleanup error cannot hide an
// already recorded mismatch. The final count checks normal driver completion.
function checkPublicationTrace(
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, unknown>>,
): Verdict {
  for (const observation of trace) {
    const verdict = differs(
      observation.checkpoint,
      `cursor publication`,
      observation.value,
      expected[observation.checkpoint],
    )
    if (verdict) return verdict
  }
  return (
    differs(
      `complete publication`,
      `cursor publication`,
      trace.length,
      Object.keys(expected).length,
    ) ?? pass
  )
}
const publicationLaw = {
  authority: `cursor-pagination/README.md, Contract before implementation; createCursorPager`,
  limits: `Controlled immutable page sequences; no changing HTTP endpoints or browser transport.`,
}

describe(`cursor cache publication`, () => {
  describe.each(
    [true, false].flatMap((cancel) =>
      [false, true].map((sharedPager) => ({ cancel, sharedPager })),
    ),
  )(
    `force refresh cancellation=$cancel sharedPager=$sharedPager`,
    ({ cancel, sharedPager }) => {
      oracleProperty({
        id: `cursor-pagination.refresh-publication`,
        law: {
          ...publicationLaw,
          statement: `A canceled growth cannot publish over a forced refresh; retained uncanceled growth demonstrates the stale-publication control.`,
        },
        // What this oracle owns: which cursor sequence publishes the next Query result
        // and how a cached slice reads its rows (createCursorPager). Slice values are
        // judged against the full-relation model at their original checkpoints.
        owns: [`src/cursor-pagination.ts#createCursorPager`],
        histories: {
          arbitrary: fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 3 }),
          ),
          runs: 50,
          fixedSeeds: [fixedSeed],
        },
        model: ([size, depth]) => {
          const fresh = expectedRows(rowsFor(size * (depth + 1), 1), scope, {
            offset: 0,
            limit: size * depth,
          })
          return {
            ...(sharedPager && !cancel ? { 'queued-fetch-count': 0 } : {}),
            'refresh-rows': cancel
              ? fresh
              : expectedRows(rowsFor(size * (depth + 1)), scope, {
                  offset: 0,
                  limit: size * depth,
                }),
            ...(cancel ? { 'growth-error-name': `AbortError` } : {}),
            starts: cancel ? 2 : 1,
            ...(cancel ? { 'next-read': fresh } : {}),
          }
        },
        driver: async ([size, depth], observe) => {
          const client = createClient()
          const key = [`posts`, `cursor-pages`]
          const entered = createDeferred<void>()
          const release = createDeferred<void>()
          let source = rowsFor(size * (depth + 1))
          // Each token retains its original immutable backend, even when a new
          // sequence starts. The fixture must not rescue stale cursors.
          const routes = new Map<string, ReturnType<typeof createBackend>>()
          let serial = 0
          let starts = 0
          let calls = 0
          let holdAt = Infinity
          const options = {
            queryClient: client,
            queryKey: key,
            fetchPage: async (
              cursor: string | undefined,
              signal: AbortSignal,
            ) => {
              const backend =
                cursor === undefined
                  ? createBackend(source, scope, size)
                  : routes.get(cursor)!
              if (cursor === undefined) starts++
              const backendCursor = cursor?.slice(cursor.indexOf(`:`) + 1)
              const page = await backend.fetchPage(backendCursor, signal)
              const nextCursor =
                page.nextCursor === null
                  ? null
                  : `${++serial}:${page.nextCursor}`
              if (nextCursor !== null) routes.set(nextCursor, backend)
              if (++calls === holdAt) {
                entered.resolve()
                await release.promise // Deliberately deliver even after abort.
              }
              return { rows: page.rows, nextCursor }
            },
          }
          const retained = createCursorPager(options)
          const reader = () =>
            sharedPager ? retained : createCursorPager(options)
          let refreshEntered:
            ReturnType<typeof createDeferred<void>> | undefined
          const outer = new QueryObserver(client, {
            queryKey: [`posts`, `rows`],
            queryFn: () => {
              refreshEntered?.resolve()
              return reader().read({ limit: size * depth })
            },
          })
          const unsubscribe = outer.subscribe(() => {})
          try {
            await outer.refetch({ cancelRefetch: false, throwOnError: true })
            holdAt = calls + 1
            const growth = reader()
              .read({})
              .catch((error: unknown) => error)
            await entered.promise
            source = rowsFor(source.length, 1)
            const query = client
              .getQueryCache()
              .find({ queryKey: key, exact: true })!
            const joined = createDeferred<void>()
            const fetch = query.fetch.bind(query)
            const witness = vi
              .spyOn(query, `fetch`)
              .mockImplementation((...args) => {
                const result = fetch(...args)
                joined.resolve()
                return result
              })
            // Follow the guide's force-refresh recipe through a real active
            // outer query. Observe its Query fetch before releasing old data.
            if (cancel) await client.cancelQueries({ queryKey: [`posts`] })
            refreshEntered = createDeferred<void>()
            const refresh = client.invalidateQueries({ queryKey: [`posts`] })
            await refreshEntered.promise
            if (sharedPager && !cancel) {
              // This read is behind the old growth in the same queue. That
              // success clears invalidation before the queued read can see it.
              observe(`queued-fetch-count`, witness.mock.calls.length)
            } else await joined.promise
            witness.mockRestore()
            release.resolve()
            await refresh
            const oldResult = await growth
            observe(`refresh-rows`, outer.getCurrentResult().data)
            if (cancel) {
              observe(
                `growth-error-name`,
                (oldResult as Error | undefined)?.name,
              )
              observe(`starts`, starts)
              observe(
                `next-read`,
                await createCursorPager(options).read({ limit: size * depth }),
              )
            } else observe(`starts`, starts)
          } finally {
            release.resolve()
            unsubscribe()
            client.clear()
          }
        },
        check: ([size, depth], trace, expected) => {
          // The cancellation omission remains a fault control of the shared
          // fresh-snapshot comparison before its old-row expectation is checked.
          if (!cancel) {
            const snapshot = trace.find(
              ({ checkpoint }) => checkpoint === `refresh-rows`,
            )
            if (
              snapshot &&
              !differs(
                `refresh-rows`,
                `fresh refresh`,
                snapshot.value,
                expectedRows(rowsFor(size * (depth + 1), 1), scope, {
                  offset: 0,
                  limit: size * depth,
                }),
              )
            )
              return violation(
                `refresh-rows`,
                `The uncanceled-growth control did not expose stale publication`,
                `fresh refresh`,
              )
          }
          return checkPublicationTrace(trace, expected)
        },
      })
    },
  )

  describe.each([`growth`, `refresh`] as const)(
    `malformed final continuation during %s`,
    (phase) => {
      oracleProperty({
        id: `cursor-pagination.protocol-publication`,
        law: {
          ...publicationLaw,
          statement: `Malformed repeated continuations reject every joined reader, preserve the prior cache, and permit a healthy next read.`,
        },
        owns: [`src/cursor-pagination.ts#createCursorPager`],
        histories: {
          arbitrary: fc.tuple(
            fc.integer({ min: 1, max: 4 }),
            fc.integer({ min: 1, max: 4 }),
            fc.nat({ max: 3 }),
            fc.boolean(),
          ),
          runs: 50,
          fixedSeeds: [fixedSeed],
        },
        model: ([size, depth]) => {
          const rows = expectedRows(
            rowsFor(size * (depth + 1), phase === `refresh` ? 1 : 0),
            scope,
            { offset: 0, limit: undefined },
          )
          return {
            outcomes: [
              { isError: true, repeated: true },
              { isError: true, repeated: true },
            ],
            publications: [],
            'cache-identity': true,
            'repaired-rows': rows,
            'repair-fetch': true,
            'cached-rows': rows,
            'cached-fetch-count': 0,
          }
        },
        driver: async ([size, depth, repeat, retry], observe) => {
          const client = createClient()
          client.setDefaultOptions({
            queries: {
              ...client.getDefaultOptions().queries,
              retry: retry ? 1 : false,
              retryDelay: 0,
            },
          })
          const key = [`protocol`]
          let source = rowsFor(size * (depth + 1))
          let backend = createBackend(source, scope, size)
          let params: Array<string> = []
          let malformed = false
          let calls = 0
          const entered = createDeferred<void>()
          const release = createDeferred<void>()
          const options = {
            queryClient: client,
            queryKey: key,
            fetchPage: async (
              cursor: string | undefined,
              signal: AbortSignal,
            ) => {
              calls++
              if (cursor === undefined) {
                backend = createBackend(source, scope, size)
                params = []
              } else params.push(cursor)
              const page = await backend.fetchPage(cursor, signal)
              if (malformed && page.nextCursor === null) {
                entered.resolve()
                await release.promise
              }
              return malformed && page.nextCursor === null
                ? { ...page, nextCursor: params[repeat % params.length]! }
                : page
            },
          }
          const pager = createCursorPager(options)
          try {
            await pager.read({
              limit: phase === `growth` ? size * depth : source.length,
            })
            if (phase === `refresh`) {
              source = rowsFor(source.length, 1)
              await client.invalidateQueries({ queryKey: key })
            }
            const previous = client.getQueryData(key)
            const published: Array<unknown> = []
            const unsubscribe = client.getQueryCache().subscribe((event) => {
              if (event.type === `updated` && event.action.type === `success`)
                published.push(event.query.state.data)
            })
            malformed = true
            try {
              const pending = pager.read({}).catch((error: unknown) => error)
              await entered.promise
              const query = client
                .getQueryCache()
                .find({ queryKey: key, exact: true })!
              const joined = createDeferred<void>()
              const fetch = query.fetch.bind(query)
              const witness = vi
                .spyOn(query, `fetch`)
                .mockImplementation((...args) => {
                  const result = fetch(...args)
                  joined.resolve()
                  return result
                })
              const peer = createCursorPager(options)
                .read({})
                .catch((error: unknown) => error)
              await joined.promise
              witness.mockRestore()
              release.resolve()
              observe(
                `outcomes`,
                (await Promise.all([pending, peer])).map((result) => ({
                  isError: result instanceof Error,
                  repeated: String(result).includes(`repeated`),
                })),
              )
              observe(`publications`, published)
              observe(`cache-identity`, client.getQueryData(key) === previous)
            } finally {
              unsubscribe()
            }
            malformed = false
            const before = calls
            observe(`repaired-rows`, await pager.read({}))
            observe(`repair-fetch`, calls > before)
            const settled = calls
            observe(`cached-rows`, await pager.read({}))
            observe(`cached-fetch-count`, calls - settled)
          } finally {
            release.resolve()
            client.clear()
          }
        },
        check: (_history, trace, expected) =>
          checkPublicationTrace(trace, expected),
      })
    },
  )

  oracleProperty({
    id: `cursor-pagination.slice-work`,
    law: {
      ...publicationLaw,
      statement: `A cached immutable slice visits exactly the returned rows and equals the independent full-relation slice.`,
    },
    owns: [`src/cursor-pagination.ts#createCursorPager`],
    histories: {
      arbitrary: fc.tuple(
        fc.integer({ min: 1, max: 100 }),
        fc.nat({ max: 120 }),
        fc.option(fc.nat({ max: 120 }), { nil: undefined }),
      ),
      runs: 100,
      fixedSeeds: [fixedSeed],
      fixed: [
        { name: `one-row slice skips its predecessor`, history: [2, 1, 1] },
      ],
    },
    model: ([count, offset, limit]) => {
      const rows = expectedRows(rowsFor(count), scope, { offset, limit })
      return { rows, visits: rows.length }
    },
    driver: ([count, offset, limit], observe) =>
      driveCachedSlice(count, offset, limit, observe),
    check: (_history, trace, expected) =>
      checkPublicationTrace(trace, expected),
  })
})
