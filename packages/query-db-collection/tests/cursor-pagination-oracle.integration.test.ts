import { QueryClient } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { describe, expect, vi } from 'vitest'
import fc from 'fast-check'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import { createLiveQueryWindowController } from '../../db/src/live-query-window-controller.js'
import { createCursorPager, queryCollectionOptions } from '../src/index.js'
import {
  createFixture,
  observeRows,
} from './cursor-pagination-integration-fixture.js'
import { expectedWindow } from './cursor-pagination/model-oracle.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { Row } from './cursor-pagination/model-oracle.js'

/**
 * # Does opaque pagination refine a real live-query window?
 *
 * This is the end-to-end path: QueryClient -> QueryCollection -> query graph ->
 * shared window controller. The visible window and `hasNextPage` must match the
 * independent full-relation model through growth, offset, ties, filtering,
 * cancellation, replacement, and cache reuse.
 *
 * Direct writes have a second, narrower law here: after an eager Collection
 * loads rows through the pager, an accepted insert, update, or delete changes
 * its public rows and compatible row caches surgically, while the page Query
 * and pager rows remain unchanged. The bounded check covers raw row arrays,
 * a nested page key, and a selected `items` envelope. It does not infer scoped
 * membership, window replacement, or the outcome of a concurrent fetch.
 *
 * The fixture endpoint supports prefix and rank-equality tie requests. Other
 * predicates reject rather than silently dropping IR. The fixture validates
 * cursor expressions, then chooses the explicit offset for its local reader.
 * Each tie filter has its own opaque backend sequence, just like the prefix.
 */
const matrix = [0, 1, 9, 20].flatMap((count) =>
  [2, 5].flatMap((backendSize) =>
    [3, 7].flatMap((pageSize) =>
      [false, true].map((descending) => ({
        count,
        backendSize,
        pageSize,
        descending,
      })),
    ),
  ),
)

const manualWriteProperty = `cursor-pagination.manual-write`
type ManualOperation = {
  kind: `insert` | `update` | `delete`
  position: number
}
type ManualHistory = [Array<ManualOperation>, number]
type ManualEdit =
  | { kind: `insert`; value: Row; rows: Array<Row> }
  | { kind: `update`; value: { id: number; group: number }; rows: Array<Row> }
  | { kind: `delete`; id: number; rows: Array<Row> }

// Fold authored operations over the independent row list before production
// runs. The driver receives concrete CRUD operands; snapshots remain model data.
function manualWritePlan([operations, count]: ManualHistory) {
  const rows = Array.from({ length: count }, (_, id) => ({
    id,
    rank: id,
    group: 0,
  }))
  const expected = rows.map((row) => ({ ...row }))
  let nextId = count
  const edits: Array<ManualEdit> = []
  for (const [step, operation] of operations.entries()) {
    const position = operation.position % Math.max(1, expected.length)
    let edit:
      | Omit<Extract<ManualEdit, { kind: `insert` }>, `rows`>
      | Omit<Extract<ManualEdit, { kind: `update` }>, `rows`>
      | Omit<Extract<ManualEdit, { kind: `delete` }>, `rows`>
    if (operation.kind === `insert` || !expected.length) {
      const value = { id: nextId, rank: nextId++, group: 0 }
      expected.push(value)
      edit = { kind: `insert`, value: { ...value } }
    } else if (operation.kind === `update`) {
      const value = { id: expected[position]!.id, group: step + 1 }
      expected[position]!.group = step + 1
      edit = { kind: `update`, value }
    } else {
      edit = { kind: `delete`, id: expected[position]!.id }
      expected.splice(position, 1)
    }
    edits.push({ ...edit, rows: expected.map((row) => ({ ...row })) })
  }
  return { rows, edits }
}
function checkManualWriteTrace(
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, unknown>>,
): Verdict {
  for (const observation of trace) {
    const verdict = differs(
      observation.checkpoint,
      `manual cache write`,
      observation.value,
      expected[observation.checkpoint],
    )
    if (verdict) return verdict
  }
  return (
    differs(
      `complete manual writes`,
      `manual cache write`,
      trace.length,
      Object.keys(expected).length,
    ) ?? pass
  )
}

const refreshCases = [false, true].flatMap((descending) =>
  [2, 5].map((backendSize) => ({ descending, backendSize })),
)

// The backend changes behind a loaded window. A row-query refetch alone must
// leave the window unchanged; the explicit refresh must reach the model's
// window before fetchNextPage grows it.
async function refreshBeforeGrowth({
  descending,
  backendSize,
}: (typeof refreshCases)[number]): Promise<void> {
  const rows = Array.from({ length: 3 }, (_, id) => ({
    id,
    rank: 0,
    group: 0,
  }))
  const scope = { group: undefined, descending }
  const fixture = createFixture(rows, scope, backendSize)
  const controller = createLiveQueryWindowController(fixture.live, {
    pageSize: 3,
  })
  const stop = controller.subscribe(() => {})
  try {
    await controller.preload()
    expect(observeRows(controller.getSnapshot().data)).toEqual(
      expectedWindow(rows, scope, 3).rows,
    )
    expect(controller.getSnapshot().hasNextPage).toBe(false)
    for (const count of [9, 2, 0, 7]) {
      const previous = observeRows(controller.getSnapshot().data)
      const calls = fixture.backend.calls.length
      rows.splice(
        0,
        rows.length,
        ...Array.from({ length: count }, (_, id) => ({
          id,
          rank: Math.floor(id / 6),
          group: count,
        })),
      )
      // Refreshing only the outer row query still allows its fresh page
      // cache. Prefix invalidation is the explicit two-cache refresh path.
      await fixture.source.utils.refetch({ throwOnError: true })
      expect(observeRows(controller.getSnapshot().data)).toEqual(previous)
      expect(fixture.backend.calls).toHaveLength(calls)
      await fixture.refresh()
      const expected = expectedWindow(rows, scope, 3)
      await vi.waitFor(() => {
        expect(observeRows(controller.getSnapshot().data)).toEqual(
          expected.rows,
        )
        expect(controller.getSnapshot().hasNextPage).toBe(expected.hasNextPage)
      })
    }
    await controller.fetchNextPage()
    expect(observeRows(controller.getSnapshot().data)).toEqual(
      expectedWindow(rows, scope, 6).rows,
    )
    expect(controller.getSnapshot().hasNextPage).toBe(true)
  } finally {
    stop()
    controller.dispose()
    await fixture.cleanup()
  }
}

// One matrix cell: grow the window page by page and compare each snapshot
// and every ready publication with the model's window.
async function publishExactPages({
  count,
  backendSize,
  pageSize,
  descending,
}: (typeof matrix)[number]): Promise<void> {
  const rows = Array.from({ length: count }, (_, id) => ({
    id,
    rank: Math.floor(id / 6),
    group: id % 2,
  }))
  const scope = { group: undefined, descending }
  const fixture = createFixture(rows, scope, backendSize)
  const controller = createLiveQueryWindowController(fixture.live, {
    pageSize,
  })
  const publications: Array<{
    rows: Array<Row>
    pages: number
    more: boolean
    ready: boolean
  }> = []
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getSnapshot()
    publications.push({
      rows: observeRows(snapshot.data),
      pages: snapshot.pageParams.length,
      more: snapshot.hasNextPage,
      ready: snapshot.isReady,
    })
  })
  try {
    await controller.preload()
    for (let page = 1; page <= Math.ceil(count / pageSize) + 1; page++) {
      const expected = expectedWindow(rows, scope, page * pageSize)
      const snapshot = controller.getSnapshot()
      expect(observeRows(snapshot.data)).toEqual(expected.rows)
      expect(snapshot.hasNextPage).toBe(expected.hasNextPage)
      expect(observeRows(snapshot.pages.flat())).toEqual(expected.rows)
      if (!expected.hasNextPage) break
      await controller.fetchNextPage()
    }
    expect(publications.length).toBeGreaterThan(0)
    expect(publications.some((published) => published.ready)).toBe(true)
    for (const published of publications) {
      if (published.ready) {
        const expected = expectedWindow(rows, scope, published.pages * pageSize)
        expect(published.rows).toEqual(expected.rows)
        expect(published.more).toBe(expected.hasNextPage)
      }
    }
    expect(fixture.requests.length).toBeGreaterThan(0)
    expect(fixture.requests[0]?.limit).toBe(pageSize + 1)
    if (count > pageSize) {
      expect(fixture.cursorRequestCount()).toBeGreaterThan(0)
    }
    expect(fixture.backend.calls).toHaveLength(
      Math.max(1, Math.ceil(count / backendSize)),
    )
  } finally {
    unsubscribe()
    controller.dispose()
    await fixture.cleanup()
  }
}

describe(`cursor adapter through production pagination`, () => {
  // A handler-free direct write surgically changes an eager Query Collection's
  // rows and compatible row-cache arrays. It must preserve an envelope's other
  // fields and leave the pager's rows and Query state alone, even when the page
  // key is nested beneath the row key (a shape the guide advises against).
  //
  // The independent answer is a copy of 2–6 initial rows folded through 1–8
  // insert/update/delete steps. Positions 0–10 may wrap to an existing row;
  // deletion of the last row is followed by an insert. The three cache shapes
  // distinguish raw sibling keys, raw nested keys, and a selected `items`
  // envelope. Removing a write kind, the nested placement, or the envelope
  // would lose that distinction. Duplicate IDs, writes during a pending fetch,
  // and arbitrary derived selects are outside this bounded grammar.
  //
  // Each campaign drives QueryClient, the real eager Query Collection, and a
  // cursor pager. Immediately after each direct write it compares public rows
  // and row-cache data with the fold, then checks that the page Query retains
  // its prior state and the pager retains its original rows. Fixed seed
  // 20261012 and random campaigns use the same property and 50-run budget.
  // Replay one shrink directly with TANSTACK_DB_ORACLE_SEED, _PATH, and
  // _PROPERTY=cursor-pagination.manual-write.
  describe.each([
    { wrapped: false, nested: false },
    { wrapped: false, nested: true },
    { wrapped: true, nested: false },
  ])(
    `manual cache shape wrapped=$wrapped nested=$nested`,
    ({ wrapped, nested }) => {
      oracleProperty({
        id: manualWriteProperty,
        law: {
          statement: `Direct writes update eager Collection rows and compatible row caches surgically while preserving page state and pager rows.`,
          authority: `queryCollectionOptions direct-write contract; cursor-pagination/README.md`,
          limits: `Handler-free writes after eager load, raw or items-envelope row caches; no writes during a pending fetch.`,
        },
        // What this oracle owns: the opaque pager through a real QueryCollection and
        // live-query window (createCursorPager, queryCollectionOptions). Its model is
        // the full-relation window in cursor-pagination/model-oracle.ts.
        owns: [
          `src/cursor-pagination.ts#createCursorPager`,
          `src/query.ts#queryCollectionOptions`,
        ],
        histories: {
          arbitrary: fc.tuple(
            fc.array(
              fc.record({
                kind: fc.constantFrom(`insert`, `update`, `delete`),
                position: fc.nat({ max: 10 }),
              }),
              { minLength: 1, maxLength: 8 },
            ),
            fc.integer({ min: 2, max: 6 }),
          ),
          runs: 50,
          fixedSeeds: [20261012],
        },
        resolve: manualWritePlan,
        model: (plan) =>
          Object.fromEntries(
            plan.edits.flatMap((edit, step) => [
              [`source-${step}`, edit.rows],
              [
                `row-cache-${step}`,
                wrapped ? { items: edit.rows, label: `keep` } : edit.rows,
              ],
              ...(!wrapped ? [[`empty-cache-${step}`, edit.rows]] : []),
              [`page-state-${step}`, true],
              [`pager-${step}`, plan.rows],
            ]),
          ),
        driver: async (plan, observe) => {
          const cleanupFailures: Array<unknown> = []
          let lawFailure: unknown
          try {
            const client = new QueryClient({
              defaultOptions: {
                queries: {
                  retry: false,
                  staleTime: Infinity,
                  gcTime: Infinity,
                },
              },
            })
            const { rows, edits } = plan
            const pageKey = [`manual`, `pages`]
            const rowKey = nested ? [`manual`] : [`manual`, `rows`]
            const pager = createCursorPager({
              queryClient: client,
              queryKey: pageKey,
              fetchPage: () => Promise.resolve({ rows, nextCursor: null }),
            })
            const common = {
              queryClient: client,
              queryKey: rowKey,
              getKey: (row: Row) => row.id,
            }
            const source = createCollection(
              wrapped
                ? queryCollectionOptions({
                    ...common,
                    queryFn: async () => ({
                      items: await pager.read({}),
                      label: `keep`,
                    }),
                    select: (response) => response.items,
                  })
                : queryCollectionOptions({
                    ...common,
                    queryFn: () => pager.read({}),
                  }),
            )
            try {
              await source.preload()
              // Raw row caches with no data must still be seeded by manual writes.
              const emptyKey = [...rowKey, `unloaded`]
              if (!wrapped)
                client.getQueryCache().build(client, { queryKey: emptyKey })
              for (const [step, edit] of edits.entries()) {
                await client.invalidateQueries({
                  queryKey: pageKey,
                  exact: true,
                  refetchType: `none`,
                })
                const previous = client.getQueryState(pageKey)
                if (edit.kind === `insert`)
                  source.utils.writeInsert({ ...edit.value })
                else if (edit.kind === `update`)
                  source.utils.writeUpdate({ ...edit.value })
                else source.utils.writeDelete(edit.id)
                observe(
                  `source-${step}`,
                  observeRows([...source.values()]).map((row) => ({ ...row })),
                )
                observe(
                  `row-cache-${step}`,
                  structuredClone(client.getQueryData(rowKey)),
                )
                if (!wrapped)
                  observe(
                    `empty-cache-${step}`,
                    structuredClone(client.getQueryData(emptyKey)),
                  )
                observe(
                  `page-state-${step}`,
                  client.getQueryState(pageKey) === previous,
                )
                observe(
                  `pager-${step}`,
                  (await pager.read({})).map((row) => ({ ...row })),
                )
              }
            } finally {
              try {
                await source.cleanup()
              } catch (error) {
                cleanupFailures.push(
                  new Error(`Source cleanup failed`, { cause: error }),
                )
              }
              try {
                client.clear()
              } catch (error) {
                cleanupFailures.push(
                  new Error(`QueryClient clear failed`, { cause: error }),
                )
              }
            }
          } catch (error) {
            lawFailure = error
          }
          if (lawFailure !== undefined && cleanupFailures.length)
            throw new AggregateError(
              [lawFailure, ...cleanupFailures],
              `Manual-write law and cleanup failed`,
              { cause: lawFailure },
            )
          if (lawFailure !== undefined) throw lawFailure
          if (cleanupFailures.length === 1) throw cleanupFailures[0]
          if (cleanupFailures.length > 1)
            throw new AggregateError(
              cleanupFailures,
              `Manual-write cleanup failed`,
              { cause: cleanupFailures[0] },
            )
        },
        check: (_plan, trace, expected) =>
          checkManualWriteTrace(trace, expected),
      })
    },
  )
  oracleProperty({
    id: `cursor-pagination.refresh-before-growth`,
    law: {
      statement: `After the backend changes, the visible window and hasNextPage keep their prior values until the page caches refresh, and then match the independent full-relation window before the window grows.`,
      authority: `cursor-pagination/README.md; the end-to-end contract at the top of this file.`,
      limits: `Three to nine rows of one rank, both directions and backend page sizes 2 and 5, through a real QueryCollection and live-query window controller.`,
    },
    owns: [
      `src/cursor-pagination.ts#createCursorPager`,
      `src/query.ts#queryCollectionOptions`,
    ],
    histories: refreshCases,
    label: ({ descending, backendSize }) =>
      `refreshes changed backend rows before growing the window ${descending}/${backendSize}`,
    resolve: (refreshCase) => ({ refreshCase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`refresh before growth`, plan, observe, () =>
        refreshBeforeGrowth(plan.refreshCase),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `cursor-pagination.exact-pages`,
    law: {
      statement: `Every ready publication and every page of the window equals the independent full-relation window for its page count, with exact exhaustion and one backend read per backend page.`,
      authority: `cursor-pagination/README.md; the end-to-end contract at the top of this file.`,
      limits: `The finite matrix of row counts 0, 1, 9 and 20, backend page sizes 2 and 5, window page sizes 3 and 7 and both directions.`,
    },
    owns: [
      `src/cursor-pagination.ts#createCursorPager`,
      `src/query.ts#queryCollectionOptions`,
    ],
    histories: matrix,
    label: ({ count, backendSize, pageSize, descending }) =>
      `publishes exact pages and exhaustion ${count}/${backendSize}/${pageSize}/${descending}`,
    resolve: (pageCase) => ({ pageCase }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`exact pages`, plan, observe, () =>
        publishExactPages(plan.pageCase),
      ),
    check: forwardAssertionJudgment,
  })
})
