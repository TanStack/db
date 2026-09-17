import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { createDeferred } from '../../db/src/deferred.js'
import { oraclePropertyOptions } from '../../db/tests/oracle-config.js'
import { createBackend } from './cursor-pagination/backend.js'
import { expectedRows } from './cursor-pagination/model.js'
import { createCursorPager } from './cursor-pagination/pager.js'
import type { Row, Scope, Window } from './cursor-pagination/model.js'

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

it(`backend sequences reject foreign tokens while retaining their own continuations`, async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 5 }),
      fc.boolean(),
      async (size, descending) => {
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
        expect(firstA.nextCursor).not.toBe(firstB.nextCursor)
        await expect(
          Promise.resolve().then(() => b.fetchPage(firstA.nextCursor!)),
        ).rejects.toThrow(`Foreign`)
        const own = await b.fetchPage(firstB.nextCursor!)
        expect(own.rows).toEqual(
          expectedRows(rows, scope, { offset: size, limit: size }),
        )
      },
    ),
    oraclePropertyOptions(50, `cursor-pagination.backend-ownership`),
  )
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
  it.each([
    { offset: -1, limit: 1 },
    { offset: 0.5, limit: 1 },
    { offset: Infinity, limit: 1 },
    { offset: NaN, limit: 1 },
    { offset: 0, limit: -1 },
    { offset: 0, limit: 0.5 },
    { offset: 0, limit: Infinity },
    { offset: 0, limit: NaN },
    { offset: Number.MAX_SAFE_INTEGER, limit: 1 },
  ])(
    `rejects invalid windows before transport: $offset/$limit`,
    async (window) => {
      const backend = createBackend(fixtureRows, allAscending, 2)
      const pager = createCursorPager(backend.fetchPage)
      await expect(pager.read(window)).rejects.toThrow(RangeError)
      expect(backend.calls).toEqual([])
      await checkRead(
        fixtureRows,
        allAscending,
        { offset: 0, limit: 2 },
        pager.read,
      )
    },
  )

  it(`captures each requested window before queued work starts`, async () => {
    const backend = createBackend(fixtureRows, allAscending, 2)
    const pager = createCursorPager(backend.fetchPage)
    const window = { offset: 1, limit: 3 }
    const expected = expectedRows(fixtureRows, allAscending, window)
    const pending = pager.read(window)
    window.offset = 7
    window.limit = 1
    expect(await pending).toEqual(expected)
  })

  it(`accepts large backend pages without spreading rows into arguments`, async () => {
    const rows = Array.from({ length: 150_000 }, (_, id) => id)
    const pager = createCursorPager(() =>
      Promise.resolve({ rows, nextCursor: null }),
    )
    expect(await pager.read({ offset: 149_997, limit: undefined })).toEqual(
      rows.slice(149_997),
    )
    expect(await pager.read({ offset: 0, limit: 2 })).toEqual(rows.slice(0, 2))
  })

  it.each([1, 2, 5, 50])(
    `fulfills windows across backend pages of %i`,
    async (pageSize) => {
      const backend = createBackend(fixtureRows, allAscending, pageSize)
      const pager = createCursorPager(backend.fetchPage)
      for (const window of [
        { offset: 0, limit: 0 },
        { offset: 0, limit: 3 },
        { offset: 2, limit: 6 },
        { offset: 0, limit: undefined },
        { offset: 30, limit: 2 },
      ]) {
        await checkRead(fixtureRows, allAscending, window, pager.read)
      }
      expect(backend.calls).toHaveLength(
        Math.ceil(fixtureRows.length / pageSize),
      )
    },
  )

  it(`matches whole-relation slices across random window histories`, async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArbitrary,
        scopeArbitrary,
        fc.integer({ min: 1, max: 8 }),
        fc.array(windowArbitrary, { minLength: 1, maxLength: 20 }),
        async (rows, scope, pageSize, windows) => {
          const backend = createBackend(rows, scope, pageSize)
          const pager = createCursorPager(backend.fetchPage)
          for (const window of windows)
            await checkRead(rows, scope, window, pager.read)
          const calls = backend.calls.length
          for (const window of [...windows].reverse())
            await checkRead(rows, scope, window, pager.read)
          expect(backend.calls).toHaveLength(calls)
        },
      ),
      oraclePropertyOptions(100, `cursor-pagination.history`),
    )
  })

  it(`keeps answers invariant under backend page repartition`, async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArbitrary,
        scopeArbitrary,
        windowArbitrary,
        async (rows, scope, window) => {
          for (const size of [1, 4, 50]) {
            const backend = createBackend(rows, scope, size, true)
            await checkRead(
              rows,
              scope,
              window,
              createCursorPager(backend.fetchPage).read,
            )
          }
        },
      ),
      oraclePropertyOptions(100, `cursor-pagination.partition`),
    )
  })

  it.each([`abort`, `reject`, `reset`] as const)(
    `keeps a healthy peer usable after held response %s`,
    async (action) => {
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
      // Cancelling a reader does not cancel Query's shared acquisition. A
      // successful page remains reusable; failed/reset acquisitions restart.
      if (action === `abort`) {
        expect(backend.calls[1]).toEqual(expect.any(String))
        expect(backend.calls).toHaveLength(3)
      } else {
        expect(backend.calls.slice(0, 2)).toEqual([undefined, undefined])
      }
    },
  )

  it(`serializes unequal peer windows without refetching cached pages`, async () => {
    const backend = createBackend(fixtureRows, allAscending, 2)
    const pager = createCursorPager(backend.fetchPage)
    const windows = [
      { offset: 0, limit: 3 },
      { offset: 2, limit: 6 },
      { offset: 0, limit: 2 },
    ]
    const results = await Promise.all(
      windows.map((window) => pager.read(window)),
    )
    expect(results).toEqual(
      windows.map((window) => expectedRows(fixtureRows, allAscending, window)),
    )
    expect(backend.calls).toHaveLength(4)
    await checkRead(fixtureRows, allAscending, windows[0]!, pager.read)
    expect(backend.calls).toHaveLength(4)
  })

  it(`resets source generations and isolates filter/order scopes`, async () => {
    await fc.assert(
      fc.asyncProperty(
        rowsArbitrary,
        scopeArbitrary,
        scopeArbitrary,
        async (rows, firstScope, secondScope) => {
          let backend = createBackend(rows, firstScope, 3)
          const pager = createCursorPager((cursor, signal) =>
            backend.fetchPage(cursor, signal),
          )
          const all = { offset: 0, limit: undefined }
          await checkRead(rows, firstScope, all, pager.read)
          const changed = rows.map((row) => ({
            ...row,
            rank: -row.rank,
            id: row.id + 100,
          }))
          backend = createBackend(changed, secondScope, 2)
          pager.reset()
          await checkRead(changed, secondScope, all, pager.read)
          const independent = createCursorPager(
            createBackend(rows, firstScope, 4).fetchPage,
          )
          await checkRead(rows, firstScope, all, independent.read)
          await checkRead(changed, secondScope, all, pager.read)
        },
      ),
      oraclePropertyOptions(50, `cursor-pagination.reset`),
    )
  })

  it(`rejects a repeated opaque cursor without looping`, async () => {
    let calls = 0
    const pager = createCursorPager(() => {
      calls++
      return Promise.resolve({ rows: [], nextCursor: `same` })
    })
    await expect(pager.read({ offset: 0, limit: 1 })).rejects.toThrow(
      `repeated`,
    )
    expect(calls).toBe(2)
  })

  it(`recovers after faults at generated intermediate page boundaries`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -2, max: 2 }), {
          minLength: 12,
          maxLength: 24,
        }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 2 }),
        fc.boolean(),
        fc.constantFrom(`reject`, `abort`),
        async (ranks, size, faultPage, descending, fault) => {
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
          expect(first).toEqual({ status: `rejected`, reason: error })
          expect(peer).toEqual({
            status: `fulfilled`,
            value: expectedRows(rows, scope, all),
          })
          expect(backend.calls).toHaveLength(
            // Query marks failed acquisitions stale and rebuilds their prefix.
            Math.ceil(rows.length / size) +
              (fault === `reject` ? faultPage + 1 : 0),
          )
          const before = backend.calls.length
          await checkRead(rows, scope, { offset: 1, limit: 3 }, pager.read)
          expect(backend.calls).toHaveLength(before)
        },
      ),
      oraclePropertyOptions(100, `cursor-pagination.failure`),
    )
  })
})
