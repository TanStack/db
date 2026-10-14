import { QueryClient } from '@tanstack/query-core'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  eq,
  getLoadSubsetDemandKey,
  isUndefined,
  not,
} from '@tanstack/db'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../../db/tests/oracle-config.js'
import { evaluateReferenceExpression } from '../../db/tests/reference-expression-oracle'
import { queryCollectionOptions } from '../src/query'
import type { LoadSubsetOptions, SyncConfig } from '@tanstack/db'

/**
 * # Does an on-demand refetch keep every served ordered prefix whole?
 *
 * ## Contract
 *
 * The ordered loader pages a window through `loadSubset`: a first page
 * (`orderBy`, `limit`), tie requests (`where` equal to a boundary value), and
 * continuation pages that carry both a `cursor` and an `offset`. A provider may
 * honor either encoding (`LoadSubsetOptions`). After a page settles, the
 * loader's boundary is the leading order value of the page's last row
 * (ARCHITECTURE.md, "Ordered requests, continuation, and recovery"). The
 * loader then treats every row through that boundary as loaded.
 *
 * The LoadSubset contract therefore requires the provider to keep each served
 * prefix whole (issue #2136). After `utils.refetch()`, the provider must
 * deliver every row that now sorts at or before each served boundary. If it
 * refetches each page alone, a row that now sorts between two pages is in no
 * result, and the loader sees no change that would start another load.
 *
 * Law: after preload, and after a refetch settles and the loader reaches its
 * fixed point, the public window equals the window over the current backend
 * rows. A refetch is either `utils.refetch()` or a Query refetch of the
 * collection's pages, such as `invalidateQueries`. Between those checkpoints
 * the provider may lag the backend, so no window is owed.
 *
 * Two neighboring laws bound how the refetch does its work:
 * - Repeating a refetch with an unchanged backend serves no more rows than the
 *   refetch before it. A refetch reads the served prefixes, not a prefix that
 *   grows with each read.
 * - A provider that honors neither `cursor` nor `offset` breaks the request
 *   contract. Refetch must then settle with an error, not request forever.
 * Each request also carries a Query key that matches its own request data,
 * so a `queryFn` may read either one.
 *
 * Limits:
 * - The generated campaigns use a provider that honors `cursor`. A provider
 *   that honors only `offset` already gets a wrong window at preload under a
 *   joined filter: the loader repeats a continuation offset capped at the
 *   window size. That loader defect is separate from #2136 and is recorded as
 *   open in the coverage map. The named replays still run both encodings.
 * - It does not check the window after a marker flip, even when the provider
 *   is current. There the loader can stop refilling after a joined-side
 *   removal when its continuation returns only rows it already holds. That
 *   defect predates this fix and is recorded as open in the coverage map.
 * - It does not check refetch request counts or cost. The cursor-pagination
 *   integration oracle owns the zero-call law for a fresh `createCursorPager`
 *   cache.
 * - The provider is controlled: it evaluates each request exactly.
 */

type Item = { id: number; rank: number }
type Marker = { id: number; itemId: number }

// ## Model
//
// The window is a pure function of the backend rows, the local markers, and
// the query's order and window. A LEFT-joined marker filters rows after the
// provider's order and limit, so the loader must page past a filtered row.
// The model sorts the current backend rows with an independent comparator.
// It shares no production cursor, comparator, or ordering code.
type Scenario = {
  // `ignore` honors neither cursor nor offset. It breaks the request
  // contract and is used only to check that refetch fails fast.
  encoding: `cursor` | `offset` | `ignore`
  // A function Query key derives each key from the request data.
  functionKey: boolean
  // One order term uses unique ranks. Two terms allow rank ties, which the
  // loader resolves with separate tie requests.
  terms: 1 | 2
  limit: number
  offset: number
}

function compareRows(a: Item, b: Item, terms: 1 | 2): number {
  return b.rank - a.rank || (terms === 2 ? a.id - b.id : 0)
}

function expectedWindow(
  backend: ReadonlyMap<number, Item>,
  markers: ReadonlySet<number>,
  scenario: Scenario,
): Array<number> {
  return [...backend.values()]
    .filter((row) => markers.has(row.id))
    .sort((a, b) => compareRows(a, b, scenario.terms))
    .slice(scenario.offset, scenario.offset + scenario.limit)
    .map((row) => row.id)
}

// ## History grammar
//
// - `upsert` and `delete` change only the backend. The provider sends nothing
//   until the next refetch, like a Query cache that is not refetched.
// - `flip` adds or removes one local marker. Removing a window row's marker
//   makes the loader request another page from the current backend.
// - `invalidate` invalidates the Query cache, which refetches each active page
//   through Query Core rather than `utils.refetch()`. Each page must still read
//   its whole served prefix, and a later `refetch` must still cover the
//   boundary the loader proved at serve time.
// - `refetch` calls `utils.refetch()`, which makes the provider current.
//
// A generated history is one to three rounds. Each round flips markers, which
// makes the loader serve continuation pages, then changes the backend while the
// provider lags, may flip again, may invalidate and change the backend again,
// and ends with a refetch. Ids come from a small
// space, so inserts often land between served pages and upserts often move a
// served row. Named replays use the same commands in other orders. With one order term, the fixture maps a
// generated rank to `rank * 100 + id`, so ranks stay unique.
type Command =
  | { type: `upsert`; id: number; rank: number }
  | { type: `delete`; id: number }
  | { type: `flip`; id: number }
  | { type: `invalidate` }
  | { type: `refetch` }

type Case = {
  scenario: Scenario
  initial: Array<{ id: number; rank: number; marked: boolean }>
  history: Array<Command>
}

const ids = fc.integer({ min: 0, max: 7 })
const ranks = fc.integer({ min: 0, max: 5 })

const flip: fc.Arbitrary<Command> = fc.record({
  type: fc.constant(`flip` as const),
  id: ids,
})
const backendChange: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`upsert` as const),
      id: ids,
      rank: ranks,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ type: fc.constant(`delete` as const), id: ids }),
  },
)

const caseArbitrary: fc.Arbitrary<Case> = fc.record({
  scenario: fc.record({
    encoding: fc.constant(`cursor` as const),
    functionKey: fc.boolean(),
    terms: fc.constantFrom(1 as const, 2 as const),
    limit: fc.integer({ min: 1, max: 3 }),
    offset: fc.integer({ min: 0, max: 1 }),
  }),
  initial: fc.uniqueArray(
    fc.record({ id: ids, rank: ranks, marked: fc.boolean() }),
    { selector: (row) => row.id, minLength: 2, maxLength: 8 },
  ),
  history: fc
    .array(
      fc.tuple(
        fc.array(flip, { maxLength: 3 }),
        fc.array(backendChange, { minLength: 1, maxLength: 4 }),
        fc.array(flip, { maxLength: 2 }),
        fc.option(fc.array(backendChange, { minLength: 1, maxLength: 3 })),
      ),
      { minLength: 1, maxLength: 3 },
    )
    .map((rounds) =>
      rounds.flatMap(([before, changes, after, afterInvalidate]) => [
        ...before,
        ...changes,
        ...after,
        // An invalidation, then backend changes that a later refetch must
        // cover through the boundary proved before the invalidation.
        ...(afterInvalidate
          ? [{ type: `invalidate` as const }, ...afterInvalidate]
          : []),
        { type: `refetch` as const },
      ]),
    ),
})

// ## Production driver
//
// A real QueryClient backs an on-demand Query Collection with an eager B-tree
// index. Its query function serves each request from the current backend:
// `where` (including tie requests), then the encoding's continuation, then
// order and limit. A `cursor` provider applies `cursor.whereFrom` and ignores
// `offset` when a cursor is present. An `offset` provider ignores the cursor
// and skips `offset` rows. The marker Collection is a local eager source.
type Run = {
  windowIds: () => Array<number>
  backend: Map<number, Item>
  markers: Set<number>
  apply: (command: Command) => Promise<void>
  requests: Array<LoadSubsetOptions>
  // Rows returned by the provider so far.
  servedRows: () => number
  // Requests whose Query key does not match their request data.
  keyMismatches: () => number
  setEncoding: (encoding: Scenario[`encoding`]) => void
  refetch: (opts?: { throwOnError?: boolean }) => Promise<unknown>
  cleanup: () => Promise<Array<unknown>>
}

let collectionSequence = 0

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function startRun(testCase: Case): Promise<Run> {
  const { scenario } = testCase
  const id = `refetch-ordered-prefix-${collectionSequence++}`
  const toItem = (row: { id: number; rank: number }): Item => ({
    id: row.id,
    rank: scenario.terms === 1 ? row.rank * 100 + row.id : row.rank,
  })
  const backend = new Map(testCase.initial.map((row) => [row.id, toItem(row)]))
  const markers = new Set(
    testCase.initial.filter((row) => row.marked).map((row) => row.id),
  )
  const requests: Array<LoadSubsetOptions> = []
  let encoding = scenario.encoding
  let servedRows = 0
  let keyMismatches = 0
  const keyFor = (options: LoadSubsetOptions) => {
    const demandKey = getLoadSubsetDemandKey(options)
    return demandKey === undefined ? [id] : [id, demandKey]
  }
  const serve = (options: LoadSubsetOptions): Array<Item> => {
    requests.push(options)
    const usesCursor = encoding === `cursor` && options.cursor
    const predicates = [
      options.where,
      usesCursor ? options.cursor!.whereFrom : undefined,
    ].filter((where) => where !== undefined)
    let page = [...backend.values()].filter((row) =>
      predicates.every(
        (where) => evaluateReferenceExpression(where, row) === true,
      ),
    )
    if (options.orderBy) {
      page.sort((a, b) => compareRows(a, b, scenario.terms))
      if (!usesCursor && encoding !== `ignore`) {
        page = page.slice(options.offset ?? 0)
      }
      if (options.limit !== undefined) page = page.slice(0, options.limit)
    }
    servedRows += page.length
    return page.map((row) => ({ ...row }))
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  })
  const items = createCollection(
    queryCollectionOptions<Item>({
      id,
      queryClient,
      queryKey: scenario.functionKey ? keyFor : [id],
      syncMode: `on-demand`,
      queryFn: (context) => {
        const options = context.meta!.loadSubsetOptions!
        if (
          scenario.functionKey &&
          JSON.stringify(context.queryKey) !== JSON.stringify(keyFor(options))
        ) {
          keyMismatches++
        }
        return Promise.resolve(serve(options))
      },
      getKey: (row) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
    }),
  )

  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
  const markerCollection = createCollection<Marker, number>({
    id: `${id}-markers`,
    getKey: (marker) => marker.id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        operations.begin()
        for (const itemId of markers) {
          operations.write({ type: `insert`, value: { id: itemId, itemId } })
        }
        operations.commit()
        operations.markReady()
      },
    },
  })

  const window = createLiveQueryCollection((q) => {
    const ordered = q
      .from({ item: items })
      .leftJoin({ marker: markerCollection }, ({ item, marker }) =>
        eq(item.id, marker.itemId),
      )
      .where(({ marker }) => not(isUndefined(marker.itemId)))
      .orderBy(({ item }) => item.rank, `desc`)
    return (
      scenario.terms === 2
        ? ordered.orderBy(({ item }) => item.id, `asc`)
        : ordered
    )
      .offset(scenario.offset)
      .limit(scenario.limit)
      .select(({ item }) => ({ id: item.id }))
  })

  const apply = async (command: Command): Promise<void> => {
    switch (command.type) {
      case `upsert`:
        backend.set(command.id, toItem(command))
        return
      case `delete`:
        backend.delete(command.id)
        return
      case `flip`: {
        const marked = markers.has(command.id)
        if (marked) markers.delete(command.id)
        else markers.add(command.id)
        markerSync.begin()
        markerSync.write({
          type: marked ? `delete` : `insert`,
          value: { id: command.id, itemId: command.id },
        })
        const receipt = markerSync.commit()
        if (receipt !== true) await receipt
        await settle()
        return
      }
      case `invalidate`:
        await queryClient.invalidateQueries({ queryKey: [id] })
        await settle()
        return
      case `refetch`:
        await items.utils.refetch()
        await settle()
        return
    }
  }

  await window.preload()
  await settle()
  return {
    windowIds: () => window.toArray.map((row) => row.id),
    backend,
    markers,
    apply,
    requests,
    servedRows: () => servedRows,
    keyMismatches: () => keyMismatches,
    setEncoding: (next) => {
      encoding = next
    },
    refetch: (opts) => items.utils.refetch(opts),
    cleanup: async () => {
      const failures: Array<unknown> = []
      for (const collection of [window, items, markerCollection]) {
        try {
          await collection.cleanup()
        } catch (error) {
          failures.push(error)
        }
      }
      queryClient.clear()
      return failures
    },
  }
}

// ## Refinement check
//
// The checkpoints are preload, every invalidation, and every refetch. There the
// public window's
// ordered ids must equal the model's ids. The comparison keeps order, duplicates, and missing
// rows. A failure names its checkpoint, so a loader defect at preload is not
// mistaken for a refetch defect.
//
// The run also records the premise of the gap: a refetch or invalidation of a
// lagging provider after a continuation page was served. The campaigns must reach it.
type Observation = {
  reachedLaggingRefetchAfterContinuation: boolean
}

async function checkCase(testCase: Case): Promise<Observation> {
  const run = await startRun(testCase)
  let reachedLaggingRefetchAfterContinuation = false
  let primary: unknown
  const check = (checkpoint: string) => {
    const expected = expectedWindow(run.backend, run.markers, testCase.scenario)
    const actual = run.windowIds()
    if (!sameOrderedIds(actual, expected)) {
      throw new Error(
        `window ${checkpoint} was ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`,
      )
    }
  }
  try {
    check(`after preload`)
    let providerCurrent = true
    const history: Array<Command> = [...testCase.history, { type: `refetch` }]
    for (const [step, command] of history.entries()) {
      if (
        (command.type === `refetch` || command.type === `invalidate`) &&
        !providerCurrent &&
        run.requests.some((options) => options.cursor !== undefined)
      ) {
        reachedLaggingRefetchAfterContinuation = true
      }
      await run.apply(command)
      if (command.type === `upsert` || command.type === `delete`) {
        providerCurrent = false
      } else if (command.type === `refetch` || command.type === `invalidate`) {
        providerCurrent = true
        check(`after ${command.type} at step ${step}`)
      }
    }
    // Repeat the refetch twice with the backend unchanged. The second read
    // must serve no more rows than the first.
    const servedBy = async () => {
      const before = run.servedRows()
      await run.apply({ type: `refetch` })
      return run.servedRows() - before
    }
    const first = await servedBy()
    const second = await servedBy()
    if (second > first) {
      throw new Error(
        `a repeated refetch served ${second} rows after ${first} with an unchanged backend`,
      )
    }
    check(`after repeated refetches`)
    if (run.keyMismatches() > 0) {
      throw new Error(
        `${run.keyMismatches()} requests carried a Query key that did not match their request data`,
      )
    }
  } catch (error) {
    primary = error
  }
  const cleanupFailures = await run.cleanup()
  if (primary !== undefined && cleanupFailures.length > 0) {
    throw new AggregateError(
      [primary, ...cleanupFailures],
      `refetch prefix law and cleanup failed`,
      { cause: primary },
    )
  }
  if (primary !== undefined) throw primary
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `refetch prefix cleanup failed`)
  }
  return { reachedLaggingRefetchAfterContinuation }
}

// A history that never settles is a progress failure, not a slow pass. The
// deadline turns it into a counterexample that fast-check can shrink. It is
// generous because a long history runs many settle loops on a loaded machine.
async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`history did not settle within 30 s`)),
          30_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function sameOrderedIds(
  actual: ReadonlyArray<number>,
  expected: ReadonlyArray<number>,
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((id, index) => actual[index] === id)
  )
}

const property = `query-db.refetch-ordered-prefix`
const replay = readOracleRunConfig()
const campaigns =
  replay.replayPath === undefined
    ? ([`fixed`, `random`] as const)
    : replay.replayProperty === property
      ? ([`replay`] as const)
      : ([] as const)

describe(`query-db on-demand refetch keeps served ordered prefixes whole`, () => {
  it(`the comparison rejects a window with the right size but a stale row`, () => {
    expect(sameOrderedIds([5, 4], [5, 4])).toBe(true)
    expect(sameOrderedIds([4, 1], [5, 4])).toBe(false)
    expect(sameOrderedIds([4, 5], [5, 4])).toBe(false)
    expect(sameOrderedIds([5], [5, 4])).toBe(false)
  })

  // The issue's trace (rank desc, limit 2). Removing rank 10's marker makes
  // the loader serve a continuation after rank 4. The backend then gains
  // rank 5 (marked) and rank 6 (unmarked). The refetched first page ends at
  // 6, the continuation still starts after 4, and rank 5 is in neither.
  it.each([`cursor`, `offset`] as const)(
    `shows a row that moved between two served pages after a refetch (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        // With one order term the fixture rank is `rank * 100 + id`, so
        // rank 0 orders these rows by id: 10, 4, 1, 0.
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // The issue's trace again, but the pages refetch through a Query
  // invalidation instead of `utils.refetch()`. Each page refetches alone, so
  // each must read its own served prefix.
  it.each([`cursor`, `offset`] as const)(
    `shows a row that moved between two served pages after a Query invalidation (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: false,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [10, 4, 1, 0].map((id) => ({ id, rank: 0, marked: true })),
        history: [
          { type: `flip`, id: 10 },
          { type: `upsert`, id: 5, rank: 0 },
          { type: `flip`, id: 5 },
          { type: `upsert`, id: 6, rank: 0 },
          { type: `invalidate` },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // A second refetch must still cover the first served boundary. The first
  // refetch inserts rows ahead of it; the backend then gains a row between
  // the new and old ends, which the second refetch must deliver.
  it.each([`cursor`, `offset`] as const)(
    `a second refetch still covers the first served boundary (%s encoding)`,
    async (encoding) => {
      const observation = await checkCase({
        scenario: {
          encoding,
          functionKey: true,
          terms: 2,
          limit: 2,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 6, marked: true },
          { id: 1, rank: 4, marked: true },
          { id: 2, rank: 1, marked: true },
          { id: 3, rank: 0, marked: true },
        ],
        history: [
          { type: `flip`, id: 0 },
          { type: `upsert`, id: 7, rank: 5 },
          { type: `refetch` },
          { type: `upsert`, id: 8, rank: 3 },
          { type: `flip`, id: 8 },
        ],
      })
      expect(observation.reachedLaggingRefetchAfterContinuation).toBe(true)
    },
  )

  // A provider that honors neither encoding returns the same page for every
  // continuation. Refetch must settle with an error instead of requesting
  // forever (AGENTS.md: fail fast on a contradictory collaborator signal).
  it(`refetch rejects when the provider honors neither cursor nor offset`, async () => {
    const run = await startRun({
      scenario: {
        encoding: `cursor`,
        functionKey: false,
        terms: 1,
        limit: 1,
        offset: 0,
      },
      // With one order term the fixture rank is `rank * 100 + id`: 3, 2, 1, 0.
      initial: [3, 2, 1, 0].map((id) => ({ id, rank: 0, marked: id === 0 })),
      history: [],
    })
    // Query DB logs the rejected fetch; the rejection itself is the check.
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      expect(run.requests.some((options) => options.cursor)).toBe(true)
      run.setEncoding(`ignore`)
      await expect(
        withDeadline(run.refetch({ throwOnError: true })),
      ).rejects.toThrow(/did not advance/)
    } finally {
      loggedError.mockRestore()
      await run.cleanup()
    }
  })

  // Known loader defects outside #2136. These witnesses fail today and
  // reproduce on main; `it.fails` turns green work into a red signal once the
  // ordered loader is fixed, so the limits above can be removed.
  it.fails(
    `an offset-only provider fills a joined window at preload (known loader defect)`,
    async () => {
      const run = await startRun({
        scenario: {
          encoding: `offset`,
          functionKey: false,
          terms: 1,
          limit: 1,
          offset: 0,
        },
        initial: [
          { id: 0, rank: 0, marked: true },
          { id: 1, rank: 0, marked: false },
          { id: 2, rank: 0, marked: false },
        ],
        history: [],
      })
      try {
        expect(run.windowIds()).toEqual([0])
      } finally {
        await run.cleanup()
      }
    },
  )

  it.fails(
    `a current provider refills a joined window after a marker removal (known loader defect)`,
    async () => {
      const testCase: Case = {
        scenario: {
          encoding: `cursor`,
          functionKey: false,
          terms: 1,
          limit: 2,
          offset: 0,
        },
        initial: [
          { id: 5, rank: 2, marked: true },
          { id: 1, rank: 2, marked: false },
          { id: 3, rank: 2, marked: false },
        ],
        history: [
          { type: `flip`, id: 2 },
          { type: `upsert`, id: 7, rank: 5 },
          { type: `delete`, id: 1 },
          { type: `refetch` },
          { type: `flip`, id: 1 },
          { type: `flip`, id: 7 },
          { type: `upsert`, id: 1, rank: 1 },
          { type: `upsert`, id: 2, rank: 0 },
          { type: `upsert`, id: 6, rank: 1 },
          { type: `upsert`, id: 7, rank: 3 },
          { type: `flip`, id: 2 },
          { type: `refetch` },
          // The provider is current here; removing 7's marker must refill.
          { type: `flip`, id: 7 },
        ],
      }
      const run = await startRun(testCase)
      try {
        for (const command of testCase.history) await run.apply(command)
        expect(run.windowIds()).toEqual(
          expectedWindow(run.backend, run.markers, testCase.scenario),
        )
      } finally {
        await run.cleanup()
      }
    },
  )

  it.each(campaigns)(
    `generated refetch histories (%s campaign)`,
    async (campaign) => {
      let reached = 0
      await fc.assert(
        fc.asyncProperty(caseArbitrary, async (testCase) => {
          const observation = await withDeadline(checkCase(testCase))
          if (observation.reachedLaggingRefetchAfterContinuation) reached++
        }),
        campaign === `fixed`
          ? { seed: 20261013, numRuns: oracleRuns(80) }
          : {
              ...oraclePropertyOptions(80, property),
              ...(campaign === `replay` ? { numRuns: 1 } : {}),
            },
      )
      // Positive reach witness: generated histories serve continuation pages
      // before a refetch, which is the premise of the gap.
      if (campaign !== `replay`) expect(reached).toBeGreaterThan(0)
    },
    120_000,
  )
})
