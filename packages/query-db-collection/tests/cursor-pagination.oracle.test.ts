import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import {
  differs,
  oracleProperty,
  pass,
} from '../../db/tests/oracle-property.js'
import { createDeferred } from '../../db/src/deferred.js'
import { oracleRoute } from '../../db/tests/oracle-config.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model-oracle.js'
import { createCursorPager } from './cursor-pagination/pager.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { Row, Scope, Window } from './cursor-pagination/model-oracle.js'

/**
 * # Can opaque pages reconstruct any requested ordered slice?
 *
 * Contract authority: cursor-pagination/README.md, "Contract before
 * implementation," and the exported createCursorPager API.
 *
 * The backend owns unreadable continuation tokens and one stable filtered,
 * totally ordered sequence. The pager may fetch and cache pages, but `read()`
 * must equal the independent full-relation model for any offset and limit.
 * The comparison detects missing, duplicate, and misordered rows. The pager
 * rejects invalid windows and repeated cursors; the fixture rejects foreign
 * tokens.
 *
 * Generated sources vary IDs, ties, groups, direction, backend page size, and
 * requested windows. The model never sees tokens. The driver observes returned
 * rows, fetch order, cancellation, and bounded page traversal. This separation
 * prevents a pager and its oracle from sharing the same cursor arithmetic.
 * This owner does not claim snapshot consistency for changing endpoints or
 * public Collection publication; the cache and integration owners cover those
 * separate boundaries.
 * `Scope` is model-only shorthand for the backend group filter and order
 * direction; the public pager has no Scope object.
 */

const rowsArbitrary = fc.uniqueArray(
  fc.record({
    id: fc.integer({ min: 0, max: 60 }),
    rank: fc.integer({ min: -3, max: 3 }),
    group: fc.integer({ min: 0, max: 2 }),
  }),
  { selector: (row) => row.id, maxLength: 30 },
)
const scopeArbitrary = fc.record({
  group: fc.option(fc.integer({ min: 0, max: 2 }), { nil: undefined }),
  descending: fc.boolean(),
})
const windowArbitrary = fc.record({
  offset: fc.integer({ min: 0, max: 35 }),
  limit: fc.option(fc.integer({ min: 0, max: 35 }), { nil: undefined }),
})
const fixtureRows: Array<Row> = Array.from({ length: 9 }, (_, id) => ({
  id,
  rank: Math.floor(id / 6),
  group: id % 2,
}))
const allAscending: Scope = { group: undefined, descending: false }

const fixedSeed = 1_779_001
const pagerLaw = {
  authority: `cursor-pagination/README.md, Contract before implementation; createCursorPager`,
  limits: `Bounded immutable backend sequences; no changing HTTP endpoint snapshots.`,
}

// Keep the old exact comparisons, including Error equality, in the native
// check. Only a comparison AssertionError becomes a law verdict; runtime and
// cleanup errors remain errors from the production driver.
function checkPagerTrace(
  trace: ReadonlyArray<Observation>,
  expected: Readonly<Record<string, unknown>>,
): Verdict {
  for (const observation of trace) {
    try {
      expect(observation.value, observation.checkpoint).toEqual(
        expected[observation.checkpoint],
      )
    } catch (error) {
      if (!(error instanceof Error) || error.name !== `AssertionError`)
        throw error
      return {
        kind: `violation`,
        checkpoint: observation.checkpoint,
        law: `opaque pager`,
        difference: error.message,
        cause: error,
      }
    }
  }
  return (
    differs(
      `complete pager history`,
      `opaque pager`,
      trace.length,
      Object.keys(expected).length,
    ) ?? pass
  )
}

oracleProperty({
  id: `cursor-pagination.backend-ownership`,
  law: {
    ...pagerLaw,
    statement: `Backend sequences reject foreign continuation tokens while retaining their own continuations.`,
  },
  // What this oracle owns: the opaque cursor pager that createCursorPager builds
  // over a backend. The pager's reads must equal the full-relation model (see
  // the declaration below), and its fetched-page counts must follow the
  // transport rules.
  owns: [`src/cursor-pagination.ts#createCursorPager`],
  histories: {
    arbitrary: fc.tuple(fc.integer({ min: 1, max: 5 }), fc.boolean()),
    runs: 50,
    fixedSeeds: [fixedSeed],
  },
  model: ([size, descending]) => ({
    'separate-tokens': true,
    'foreign-rejected': true,
    own: expectedRows(
      Array.from({ length: size * 3 }, (_, id) => ({ id, rank: id, group: 0 })),
      { group: undefined, descending },
      { offset: size, limit: size },
    ),
  }),
  driver: async ([size, descending], observe) => {
    const scope = { group: undefined, descending }
    const rows = Array.from({ length: size * 3 }, (_, id) => ({
      id,
      rank: id,
      group: 0,
    }))
    const a = createBackend(rows, scope, size)
    const b = createBackend(rows, scope, size)
    const firstA = await a.fetchPage(undefined),
      firstB = await b.fetchPage(undefined)
    observe(`separate-tokens`, firstA.nextCursor !== firstB.nextCursor)
    try {
      await Promise.resolve().then(() => b.fetchPage(firstA.nextCursor!))
      observe(`foreign-rejected`, false)
    } catch (error) {
      observe(
        `foreign-rejected`,
        error instanceof Error && error.message.includes(`Foreign`),
      )
    }
    observe(`own`, (await b.fetchPage(firstB.nextCursor!)).rows)
  },
  check: (_history, trace, expected) => checkPagerTrace(trace, expected),
})

async function checkRead(
  source: Array<Row>,
  scope: Scope,
  window: Window,
  read: (window: Window) => Promise<Array<Row>>,
) {
  const expected = expectedRows(source, scope, window)
  expect(await read(window), `ordered slice ${JSON.stringify(window)}`).toEqual(
    expected,
  )
}

describe(`cursor pagination reference`, () => {
  it(`preserves ties, filtering and reverse total order`, () => {
    oracleRoute(`case`)
    expect(
      expectedRows(
        fixtureRows,
        { group: 1, descending: true },
        { offset: 1, limit: 3 },
      ).map((row) => row.id),
    ).toEqual([5, 3, 1])
    expect(
      expectedRows(fixtureRows, allAscending, { offset: 0, limit: 0 }),
    ).toEqual([])
  })

  it(`rejects capped-page, wrong-order and duplicate-row answers`, async () => {
    oracleRoute(`calibration`)
    const window = { offset: 0, limit: 8 }
    const expected = expectedRows(fixtureRows, allAscending, window)
    for (const wrong of [
      expected.slice(0, 2),
      [...expected].reverse(),
      [...expected.slice(0, 7), expected[0]!],
    ]) {
      await expect(
        checkRead(fixtureRows, allAscending, window, () =>
          Promise.resolve(wrong),
        ),
      ).rejects.toThrow(`ordered slice`)
    }
    await checkRead(fixtureRows, allAscending, window, () =>
      Promise.resolve(expected),
    )
  })
})

describe(`opaque cursor adapter`, () => {
  oracleProperty({
    id: `cursor-pagination.partition`,
    law: {
      ...pagerLaw,
      statement: `The requested full-relation slice is invariant under backend page repartition.`,
    },
    owns: [`src/cursor-pagination.ts#createCursorPager`],
    histories: {
      arbitrary: fc.tuple(rowsArbitrary, scopeArbitrary, windowArbitrary),
      runs: 100,
      fixedSeeds: [fixedSeed],
    },
    model: ([rows, scope, window]) =>
      Object.fromEntries(
        [1, 4, 50].map((size) => [
          `page-size-${size}`,
          expectedRows(rows, scope, window),
        ]),
      ),
    driver: async ([rows, scope, window], observe) => {
      for (const size of [1, 4, 50]) {
        const backend = createBackend(rows, scope, size, true)
        observe(
          `page-size-${size}`,
          await createCursorPager(backend.fetchPage).read(window),
        )
      }
    },
    check: (_history, trace, expected) => checkPagerTrace(trace, expected),
  })

  it.each([`abort`, `reject`, `reset`] as const)(
    `keeps a healthy peer usable after held response %s`,
    async (action) => {
      oracleRoute(`case`)
      const backend = createBackend(fixtureRows, allAscending, 2)
      const gate = createDeferred<void>()
      const abort = new AbortController()
      const failure = new Error(`backend failed`)
      let calls = 0
      const pager = createCursorPager(async (cursor, signal) => {
        const page = await backend.fetchPage(cursor, signal)
        if (++calls === 1) await gate.promise
        return page
      })
      const outcomes: Array<string> = []
      const first = pager.read({ offset: 0, limit: 2 }, abort.signal).then(
        () => {
          outcomes.push(`first-success`)
          return undefined
        },
        (error: unknown) => {
          outcomes.push(`first-error`)
          return error
        },
      )
      await vi.waitFor(() => expect(calls).toBe(1))
      expect(outcomes).toEqual([])
      if (action === `abort`) abort.abort()
      if (action === `reset`) pager.reset()
      const peer = pager.read({ offset: 0, limit: 6 })
      const peerObserved = peer.then((rows) => {
        outcomes.push(`peer-success`)
        return rows
      })
      if (action === `reject`) gate.reject(failure)
      else gate.resolve()
      const error = await first
      if (action === `reject`) expect(error).toBe(failure)
      else expect(error).toMatchObject({ name: `AbortError` })
      await expect(peerObserved).resolves.toEqual(
        expectedRows(fixtureRows, allAscending, { offset: 0, limit: 6 }),
      )
      expect(outcomes).toEqual([`first-error`, `peer-success`])
      // Cancelling a reader leaves the shared Query fetch active. A successful
      // page remains reusable; failed or reset Query fetches start again.
      if (action === `abort`) {
        expect(backend.calls[1]).toEqual(expect.any(String))
        expect(backend.calls).toHaveLength(3)
      } else {
        expect(backend.calls.slice(0, 2)).toEqual([undefined, undefined])
      }
    },
  )

  oracleProperty({
    id: `cursor-pagination.reset`,
    law: {
      ...pagerLaw,
      statement: `Resetting a pager changes its source generation without changing an independent filter/order scope.`,
    },
    owns: [`src/cursor-pagination.ts#createCursorPager`],
    histories: {
      arbitrary: fc.tuple(rowsArbitrary, scopeArbitrary, scopeArbitrary),
      runs: 50,
      fixedSeeds: [fixedSeed],
    },
    model: ([rows, firstScope, secondScope]) => {
      const changed = rows.map((row) => ({
        ...row,
        rank: -row.rank,
        id: row.id + 100,
      }))
      const all = { offset: 0, limit: undefined }
      return {
        initial: expectedRows(rows, firstScope, all),
        changed: expectedRows(changed, secondScope, all),
        independent: expectedRows(rows, firstScope, all),
        reread: expectedRows(changed, secondScope, all),
      }
    },
    driver: async ([rows, firstScope, secondScope], observe) => {
      let backend = createBackend(rows, firstScope, 3)
      const pager = createCursorPager((cursor, signal) =>
        backend.fetchPage(cursor, signal),
      )
      const all = { offset: 0, limit: undefined }
      observe(`initial`, await pager.read(all))
      const changed = rows.map((row) => ({
        ...row,
        rank: -row.rank,
        id: row.id + 100,
      }))
      backend = createBackend(changed, secondScope, 2)
      pager.reset()
      observe(`changed`, await pager.read(all))
      const independent = createCursorPager(
        createBackend(rows, firstScope, 4).fetchPage,
      )
      observe(`independent`, await independent.read(all))
      observe(`reread`, await pager.read(all))
    },
    check: (_history, trace, expected) => checkPagerTrace(trace, expected),
  })

  oracleProperty({
    id: `cursor-pagination.failure`,
    law: {
      ...pagerLaw,
      statement: `An intermediate page fault rejects its reader without preventing a healthy peer or causing refetches of an already cached slice.`,
    },
    owns: [`src/cursor-pagination.ts#createCursorPager`],
    histories: {
      arbitrary: fc.tuple(
        fc.array(fc.integer({ min: -2, max: 2 }), {
          minLength: 12,
          maxLength: 24,
        }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 2 }),
        fc.boolean(),
        fc.constantFrom(`reject`, `abort`),
      ),
      runs: 100,
      fixedSeeds: [fixedSeed],
    },
    model: ([ranks, size, faultPage, descending, fault]) => {
      const rows = ranks.map((rank, id) => ({ id, rank, group: id % 2 }))
      const scope = { group: undefined, descending }
      return {
        outcomes: [
          { status: `rejected`, reason: new Error(`page failure`) },
          {
            status: `fulfilled`,
            value: expectedRows(rows, scope, { offset: 0, limit: undefined }),
          },
        ],
        'page-count':
          Math.ceil(rows.length / size) +
          (fault === `reject` ? faultPage + 1 : 0),
        'cached-slice': expectedRows(rows, scope, { offset: 1, limit: 3 }),
        'cached-fetch-count': 0,
      }
    },
    driver: async ([ranks, size, faultPage, descending, fault], observe) => {
      const rows = ranks.map((rank, id) => ({ id, rank, group: id % 2 }))
      const scope = { group: undefined, descending }
      const backend = createBackend(rows, scope, size)
      const abort = new AbortController()
      const error = new Error(`page failure`)
      let calls = 0
      const pager = createCursorPager(async (cursor, signal) => {
        const page = await backend.fetchPage(cursor, signal)
        if (calls++ === faultPage) {
          if (fault === `reject`) throw error
          abort.abort(error)
        }
        return page
      })
      const all = { offset: 0, limit: undefined }
      const failed = pager.read(all, abort.signal)
      // Attach observers before the healthy peer can expose a failure.
      const outcomes = Promise.allSettled([failed, pager.read(all)])
      const [first, peer] = await outcomes
      observe(`outcomes`, [first, peer])
      observe(`page-count`, backend.calls.length)
      const before = backend.calls.length
      observe(`cached-slice`, await pager.read({ offset: 1, limit: 3 }))
      observe(`cached-fetch-count`, backend.calls.length - before)
    },
    check: (_history, trace, expected) => checkPagerTrace(trace, expected),
  })
})

// ---------------------------------------------------------------------------
// Read histories over one pager, on oracleProperty
// ---------------------------------------------------------------------------
//
// Law (cursor-pagination/README.md, "Contract before implementation"): a
// successful read returns exactly the requested slice of the whole filtered,
// ordered relation, or fewer rows only at exhaustion; an invalid window
// rejects with RangeError before transport; reads of one pager serialize and
// reuse fetched pages; zero limit performs no transport work; short and empty
// nonterminal pages do not establish exhaustion. So the pages fetched after
// any step are the shortest prefix of the backend's pages that covers every
// window read so far, or every page when a window drains the source.
//
// History: rows, a scope, a backend page size (1 to 8, or 50, larger than
// any relation here), and whether the backend's
// first page is empty and nonterminal; then one to six steps, each one to
// three windows read at once, valid or invalid, with the caller's window
// objects optionally changed right after each call; then every valid window
// read again in reverse order, which must fetch nothing.
//
// Model: `expectedRows` for each valid window, `RangeError` for each invalid
// one, and the page count from the backend's page sizes alone (the model
// never sees tokens). That the count is the shortest covering prefix is not
// one README sentence: it follows from its transport rules with the exact
// counts the previous fixed tests asserted (three peer windows on pages of two
// fetch 4 pages; a drained source fetches every page). Production driver: the production pager over the opaque backend;
// it records each read's rows or error name and the backend's call count
// after each step. Limits: one scope per pager, no reset, faults, or
// cancellation (the reset and failure properties below own those).

const invalidWindows: ReadonlyArray<Window> = [
  { offset: -1, limit: 1 },
  { offset: 0.5, limit: 1 },
  { offset: Infinity, limit: 1 },
  { offset: NaN, limit: 1 },
  { offset: 0, limit: -1 },
  { offset: 0, limit: 0.5 },
  { offset: 0, limit: Infinity },
  { offset: 0, limit: NaN },
  { offset: Number.MAX_SAFE_INTEGER, limit: 1 },
]
type Read = { window: Window } | { invalid: number }
type ReadHistory = {
  rows: Array<Row>
  scope: Scope
  pageSize: number
  emptyFirst: boolean
  steps: Array<{ reads: Array<Read>; changeAfterCall: boolean }>
}
const readArbitrary: fc.Arbitrary<Read> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ window: windowArbitrary }) },
  // The window whose end is the largest safe integer is valid. A pager that
  // rejected at MAX_SAFE_INTEGER would still pass every invalid window.
  {
    weight: 1,
    arbitrary: fc.record({
      window: fc.record({
        offset: fc.constant(Number.MAX_SAFE_INTEGER - 1),
        limit: fc.constant(1),
      }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      invalid: fc.integer({ min: 0, max: invalidWindows.length - 1 }),
    }),
  },
)
const readHistory: fc.Arbitrary<ReadHistory> = fc.record({
  rows: rowsArbitrary,
  scope: scopeArbitrary,
  // A page of 50 is larger than any relation here: one terminal page.
  pageSize: fc.oneof(
    { weight: 4, arbitrary: fc.integer({ min: 1, max: 8 }) },
    { weight: 1, arbitrary: fc.constant(50) },
  ),
  emptyFirst: fc.boolean(),
  steps: fc.array(
    fc.record({
      reads: fc.array(readArbitrary, { minLength: 1, maxLength: 3 }),
      changeAfterCall: fc.boolean(),
    }),
    // Up to 30 reads, past the 20 sequential windows the previous history
    // property drew.
    { minLength: 1, maxLength: 10, size: `medium` },
  ),
})

const windowOf = (read: Read): Window =>
  `window` in read ? read.window : invalidWindows[read.invalid]!
const validWindows = ({ steps }: ReadHistory) =>
  steps.flatMap(({ reads }) =>
    reads.flatMap((read) => (`window` in read ? [read.window] : [])),
  )

type ReadResult = { rows: Array<Row> } | { error: string }
type StepRecord = { results: Array<ReadResult>; calls: number }

/** The backend's page sizes, from the filtered row count alone. */
function pageSizes({ rows, scope, pageSize, emptyFirst }: ReadHistory) {
  const count = expectedRows(rows, scope, {
    offset: 0,
    limit: undefined,
  }).length
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(count / pageSize)) },
    (_, index) => Math.min(pageSize, count - index * pageSize),
  )
  return { count, pages: emptyFirst ? [0, ...pages] : pages }
}

/** Pages a window needs: the shortest covering prefix, or every page. */
function pagesFor(history: ReadHistory, { offset, limit }: Window): number {
  if (limit === 0) return 0
  const { pages } = pageSizes(history)
  if (limit === undefined) return pages.length
  let rows = 0
  for (const [index, size] of pages.entries()) {
    rows += size
    if (rows >= offset + limit) return index + 1
  }
  return pages.length
}

function readModel(history: ReadHistory): Map<string, StepRecord> {
  const owed = new Map<string, StepRecord>()
  let calls = 0
  const resultOf = (read: Read): ReadResult =>
    `window` in read
      ? { rows: expectedRows(history.rows, history.scope, read.window) }
      : { error: `RangeError` }
  for (const [index, { reads }] of history.steps.entries()) {
    for (const read of reads)
      if (`window` in read)
        calls = Math.max(calls, pagesFor(history, read.window))
    owed.set(`step ${index}`, { results: reads.map(resultOf), calls })
  }
  owed.set(`reread`, {
    results: [...validWindows(history)].reverse().map((window) => ({
      rows: expectedRows(history.rows, history.scope, window),
    })),
    calls,
  })
  return owed
}

async function driveReads(
  history: ReadHistory,
  observe: (checkpoint: string, value: unknown) => void,
) {
  const backend = createBackend(
    history.rows,
    history.scope,
    history.pageSize,
    history.emptyFirst,
  )
  const pager = createCursorPager(backend.fetchPage)
  const settle = (promise: Promise<Array<Row>>) =>
    promise.then(
      (rows): ReadResult => ({ rows }),
      // An invalid window must reject with a RangeError instance; any other
      // rejection keeps its name and message for the failure.
      (error: unknown): ReadResult => ({
        error:
          error instanceof RangeError
            ? `RangeError`
            : error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
      }),
    )
  for (const [index, { reads, changeAfterCall }] of history.steps.entries()) {
    const windows = reads.map((read) => ({ ...windowOf(read) }))
    const pending = windows.map((window) => settle(pager.read(window)))
    // Reads of one pager queue behind each other, so a window must be
    // captured when it is called, not when its queued work starts.
    if (changeAfterCall)
      for (const window of windows) {
        window.offset = 7
        window.limit = 1
      }
    observe(`step ${index}`, {
      results: await Promise.all(pending),
      calls: backend.calls.length,
    } satisfies StepRecord)
  }
  const results: Array<ReadResult> = []
  for (const window of [...validWindows(history)].reverse())
    results.push(await settle(pager.read({ ...window })))
  observe(`reread`, {
    results,
    calls: backend.calls.length,
  } satisfies StepRecord)
}

function checkReads(
  _history: ReadHistory,
  trace: ReadonlyArray<Observation>,
  owed: ReturnType<typeof readModel>,
) {
  for (const [checkpoint, expected] of owed) {
    const seen = trace.find((entry) => entry.checkpoint === checkpoint)
      ?.value as StepRecord | undefined
    const wrong =
      differs(
        checkpoint,
        `invalid`,
        seen?.results.map((result) => `error` in result),
        expected.results.map((result) => `error` in result),
        `a read rejected or fulfilled against its window's validity`,
      ) ??
      differs(
        checkpoint,
        `slice`,
        seen?.results,
        expected.results,
        `a read returned another slice`,
      ) ??
      differs(
        checkpoint,
        `transport`,
        seen?.calls,
        expected.calls,
        `the pager fetched another number of pages`,
      )
    if (wrong) return wrong
  }
  return pass
}

const fixedHistory = (
  name: string,
  pageSize: number,
  steps: ReadHistory[`steps`],
): { name: string; history: ReadHistory } => ({
  name,
  history: {
    rows: fixtureRows,
    scope: allAscending,
    pageSize,
    emptyFirst: false,
    steps,
  },
})
const readsOf = (...windows: Array<Window>) => ({
  reads: windows.map((window) => ({ window })),
  changeAfterCall: false,
})

oracleProperty({
  id: `cursor-pagination.history`,
  law: {
    statement: `A cursor pager returns exactly the requested slice of the whole filtered ordered relation, rejects an invalid window with RangeError before transport, captures each window when called, and fetches only the shortest prefix of backend pages that covers what was read, reusing fetched pages.`,
    authority: `packages/query-db-collection/tests/cursor-pagination/README.md, "Contract before implementation" (transport rules) and "Chosen implementation" (loading more fetches the missing suffix); the exact page counts the previous fixed tests pinned; the exported createCursorPager API`,
    limits: `One scope per pager; no reset, faults, or cancellation in this property; a stable backend relation, not snapshot consistency for changing endpoints.`,
  },
  owns: [`src/cursor-pagination.ts#createCursorPager`],
  histories: {
    arbitrary: readHistory,
    states: [],
    measured: [
      `invalid window`,
      `peer reads`,
      `empty first page`,
      `zero limit`,
      `window past the end`,
      `window changed after call`,
    ],
    runs: 100,
    fixedSeeds: [fixedSeed],
    fixed: [
      ...[1, 2, 5, 50].map((pageSize) =>
        fixedHistory(`windows across backend pages of ${pageSize}`, pageSize, [
          readsOf(
            { offset: 0, limit: 0 },
            { offset: 0, limit: 3 },
            { offset: 2, limit: 6 },
          ),
          readsOf({ offset: 0, limit: undefined }, { offset: 30, limit: 2 }),
        ]),
      ),
      fixedHistory(`unequal peer windows serialize without refetching`, 2, [
        readsOf(
          { offset: 0, limit: 3 },
          { offset: 2, limit: 6 },
          { offset: 0, limit: 2 },
        ),
      ]),
      // Alone and first, so no peer's fetch hides a zero-limit fetch.
      fixedHistory(`a zero limit performs no transport work`, 2, [
        readsOf({ offset: 3, limit: 0 }),
        readsOf({ offset: 0, limit: 0 }),
      ]),
      fixedHistory(`the largest safe window end`, 2, [
        readsOf({ offset: Number.MAX_SAFE_INTEGER - 1, limit: 1 }),
      ]),
      fixedHistory(`a window changed after its call`, 2, [
        { reads: [{ window: { offset: 1, limit: 3 } }], changeAfterCall: true },
      ]),
      ...invalidWindows.map(({ offset, limit }, invalid) =>
        fixedHistory(
          `invalid window ${offset}/${limit} rejects before transport`,
          2,
          [
            { reads: [{ invalid }], changeAfterCall: false },
            readsOf({ offset: 0, limit: 2 }),
          ],
        ),
      ),
    ],
  },
  model: readModel,
  reached: (history) => {
    const all = history.steps.flatMap(({ reads }) => reads)
    const { count } = pageSizes(history)
    return [
      ...(all.some((read) => `invalid` in read) ? [`invalid window`] : []),
      ...(history.steps.some(({ reads }) => reads.length > 1)
        ? [`peer reads`]
        : []),
      ...(history.emptyFirst ? [`empty first page`] : []),
      ...(validWindows(history).some((window) => window.limit === 0)
        ? [`zero limit`]
        : []),
      ...(validWindows(history).some((window) => window.offset > count)
        ? [`window past the end`]
        : []),
      ...(history.steps.some(({ changeAfterCall }) => changeAfterCall)
        ? [`window changed after call`]
        : []),
    ]
  },
  driver: driveReads,
  check: checkReads,
  calibrations: [
    {
      name: `a read returns one page only`,
      law: `slice`,
      corrupt: (trace) => {
        const at = trace.findIndex(({ value }) =>
          (value as StepRecord).results.some(
            (result) => `rows` in result && result.rows.length > 2,
          ),
        )
        if (at < 0) return undefined
        return trace.map((entry, index) =>
          index === at
            ? {
                ...entry,
                value: {
                  ...(entry.value as StepRecord),
                  results: (entry.value as StepRecord).results.map((result) =>
                    `rows` in result
                      ? { rows: result.rows.slice(0, 2) }
                      : result,
                  ),
                },
              }
            : entry,
        )
      },
    },
    {
      name: `a reread fetches again`,
      law: `transport`,
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `reread`
            ? {
                ...entry,
                value: {
                  ...(entry.value as StepRecord),
                  calls: (entry.value as StepRecord).calls + 1,
                },
              }
            : entry,
        ),
    },
    {
      name: `an invalid window reaches transport and fulfills`,
      law: `invalid`,
      corrupt: (trace) => {
        const at = trace.findIndex(({ value }) =>
          (value as StepRecord).results.some((result) => `error` in result),
        )
        if (at < 0) return undefined
        return trace.map((entry, index) =>
          index === at
            ? {
                ...entry,
                value: {
                  ...(entry.value as StepRecord),
                  results: (entry.value as StepRecord).results.map((result) =>
                    `error` in result ? { rows: [] } : result,
                  ),
                },
              }
            : entry,
        )
      },
    },
  ],
})
