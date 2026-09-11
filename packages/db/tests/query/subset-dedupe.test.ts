import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe'
import { eq, gt } from '../../src/query/builder/functions'
import { Func, PropRef, Value } from '../../src/query/ir'
import { compileSingleRowExpression } from '../../src/query/compiler/evaluators'
import type { LoadSubsetFn, LoadSubsetOptions } from '../../src/types'

const ref = (name: string) => new PropRef([name])
const val = <T>(value: T) => new Value(value)

describe(`DeduplicatedLoadSubset`, () => {
  it(`deduplicates only completed exact demands`, async () => {
    const loadSubset = vi.fn<LoadSubsetFn>().mockResolvedValue(undefined)
    const onDeduplicate = vi.fn()
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset,
      onDeduplicate,
    })

    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      limit: 2,
    })
    expect(
      deduplicated.loadSubset({
        where: gt(ref(`age`), val(10)),
        limit: 2,
      }),
    ).toBe(true)
    expect(loadSubset).toHaveBeenCalledTimes(1)
    expect(onDeduplicate).toHaveBeenCalledTimes(1)

    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(20)),
      limit: 2,
    })
    await deduplicated.loadSubset({
      where: gt(ref(`age`), val(10)),
      limit: 3,
    })
    expect(loadSubset).toHaveBeenCalledTimes(3)
  })

  it(`does not infer coverage from a broader predicate or window`, async () => {
    const loadSubset = vi.fn<LoadSubsetFn>().mockResolvedValue(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })

    await deduplicated.loadSubset({ where: gt(ref(`age`), val(10)) })
    await deduplicated.loadSubset({ where: gt(ref(`age`), val(20)) })
    await deduplicated.loadSubset({ limit: 10, offset: 0 })
    await deduplicated.loadSubset({ limit: 5, offset: 2 })

    expect(loadSubset).toHaveBeenCalledTimes(4)
  })

  it(`shares exact in-flight work when it has no cancellation owner`, async () => {
    let resolve!: () => void
    const loadSubset = vi.fn<LoadSubsetFn>(
      () => new Promise<void>((done) => (resolve = done)),
    )
    const onDeduplicate = vi.fn()
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset,
      onDeduplicate,
    })

    const first = deduplicated.loadSubset({ limit: 2 })
    const second = deduplicated.loadSubset({ limit: 2 })

    expect(second).toBe(first)
    expect(loadSubset).toHaveBeenCalledTimes(1)
    expect(onDeduplicate).not.toHaveBeenCalled()

    resolve()
    await Promise.all([first, second])
    expect(onDeduplicate).toHaveBeenCalledTimes(1)
    expect(deduplicated.loadSubset({ limit: 2 })).toBe(true)
  })

  describe.each([`resolve`, `reject`] as const)(
    `shared transport %s with deduplication observers`,
    (outcome) => {
      it.each([
        { waiters: 2, throws: false },
        { waiters: 2, throws: true },
        { waiters: 3, throws: false },
        { waiters: 3, throws: true },
      ])(
        `preserves settlement without unhandled rejections ($waiters waiters, throws=$throws)`,
        async ({ waiters, throws }) => {
          const transportError = new Error(`transport failed`)
          const observerError = new Error(`deduplication observer failed`)
          let resolve!: () => void
          let reject!: (reason: unknown) => void
          const loadSubset = vi.fn<LoadSubsetFn>(
            () =>
              new Promise<void>((done, fail) => {
                resolve = done
                reject = fail
              }),
          )
          const onDeduplicate = vi.fn(() => {
            if (throws) throw observerError
          })
          const deduplicated = new DeduplicatedLoadSubset({
            loadSubset,
            onDeduplicate,
          })
          const unhandled: Array<unknown> = []
          const recordUnhandled = (reason: unknown) => unhandled.push(reason)
          process.on(`unhandledRejection`, recordUnhandled)
          try {
            const requests = Array.from({ length: waiters }, () =>
              deduplicated.loadSubset({ limit: 2 }),
            )
            const settled = Promise.allSettled(requests)
            expect(requests.every((request) => request === requests[0])).toBe(
              true,
            )
            expect(loadSubset).toHaveBeenCalledTimes(1)
            expect(onDeduplicate).not.toHaveBeenCalled()

            if (outcome === `resolve`) resolve()
            else reject(transportError)

            expect(await settled).toEqual(
              Array.from({ length: waiters }, () =>
                outcome === `resolve`
                  ? { status: `fulfilled`, value: undefined }
                  : { status: `rejected`, reason: transportError },
              ),
            )
            // Let the host report rejected detached observer promises too.
            await new Promise<void>((done) => setTimeout(done, 0))
            expect(onDeduplicate).toHaveBeenCalledTimes(
              outcome === `resolve` ? waiters - 1 : 0,
            )
            expect(unhandled).toEqual([])
          } finally {
            process.off(`unhandledRejection`, recordUnhandled)
          }
        },
      )
    },
  )

  it(`gives independently abortable demands independent transports`, async () => {
    const pending: Array<() => void> = []
    const signals: Array<AbortSignal | undefined> = []
    const loadSubset = vi.fn<LoadSubsetFn>(
      (options) =>
        new Promise<void>((resolve) => {
          signals.push(options.signal)
          pending.push(resolve)
        }),
    )
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })
    const firstOwner = new AbortController()
    const secondOwner = new AbortController()

    const first = deduplicated.loadSubset({
      limit: 2,
      signal: firstOwner.signal,
    })
    const second = deduplicated.loadSubset({
      limit: 2,
      signal: secondOwner.signal,
    })

    expect(first).not.toBe(second)
    expect(loadSubset).toHaveBeenCalledTimes(2)
    expect(signals).toEqual([firstOwner.signal, secondOwner.signal])

    pending.forEach((resolve) => resolve())
    await Promise.all([first, second])
  })

  it(`does not cache work that settles after its owner aborts`, async () => {
    let resolve!: () => void
    const loadSubset = vi
      .fn<LoadSubsetFn>()
      .mockImplementationOnce(
        () => new Promise<void>((done) => (resolve = done)),
      )
      .mockResolvedValue(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })
    const owner = new AbortController()

    const first = deduplicated.loadSubset({ limit: 2, signal: owner.signal })
    owner.abort()
    resolve()
    await first
    await deduplicated.loadSubset({ limit: 2 })

    expect(loadSubset).toHaveBeenCalledTimes(2)
  })

  it(`retries an exact demand after rejection`, async () => {
    const loadSubset = vi
      .fn<LoadSubsetFn>()
      .mockRejectedValueOnce(new Error(`offline`))
      .mockResolvedValueOnce(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })

    await expect(deduplicated.loadSubset({ limit: 2 })).rejects.toThrow(
      `offline`,
    )
    await deduplicated.loadSubset({ limit: 2 })

    expect(loadSubset).toHaveBeenCalledTimes(2)
  })

  it(`erases completed and in-flight evidence on reset`, async () => {
    const pending: Array<() => void> = []
    const loadSubset = vi.fn<LoadSubsetFn>(
      () => new Promise<void>((resolve) => pending.push(resolve)),
    )
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })

    const stale = deduplicated.loadSubset({ limit: 2 })
    deduplicated.reset()
    const fresh = deduplicated.loadSubset({ limit: 2 })
    expect(loadSubset).toHaveBeenCalledTimes(2)

    pending[0]!()
    await stale
    expect(deduplicated.loadSubset({ limit: 2 })).toBe(fresh)

    pending[1]!()
    await fresh
    expect(deduplicated.loadSubset({ limit: 2 })).toBe(true)
  })

  it(`does not retain synchronous work from before a reentrant reset`, () => {
    const loadSubset = vi
      .fn<LoadSubsetFn>()
      .mockImplementationOnce(() => {
        deduplicated.reset()
        return true
      })
      .mockReturnValue(true)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })

    expect(deduplicated.loadSubset({ limit: 2 })).toBe(true)
    expect(deduplicated.loadSubset({ limit: 2 })).toBe(true)
    expect(loadSubset).toHaveBeenCalledTimes(2)
  })

  it(`does not retain asynchronous work from before a reentrant reset`, async () => {
    let resolveStale!: () => void
    const loadSubset = vi
      .fn<LoadSubsetFn>()
      .mockImplementationOnce(() => {
        deduplicated.reset()
        return new Promise<void>((resolve) => (resolveStale = resolve))
      })
      .mockResolvedValue(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })

    const stale = deduplicated.loadSubset({ limit: 2 })
    const fresh = deduplicated.loadSubset({ limit: 2 })
    expect(loadSubset).toHaveBeenCalledTimes(2)

    resolveStale()
    await Promise.all([stale, fresh])
  })

  it.each([
    {
      name: `Date`,
      value: new Date(7),
      equal: new Date(7),
      different: new Date(8),
    },
    {
      name: `binary`,
      value: new Uint8Array([1]),
      equal: new Uint8Array([1]),
      different: new Uint8Array([2]),
    },
    {
      name: `Buffer`,
      value: Buffer.from([1]),
      equal: new Uint8Array([1]),
      different: Buffer.from([2]),
    },
  ])(
    `passes immutable $name values through and deduplicates by equality`,
    ({ value, equal, different }) => {
      const loadSubset = vi.fn<LoadSubsetFn>().mockReturnValue(true)
      const deduplicated = new DeduplicatedLoadSubset({ loadSubset })
      const options = { where: eq(ref(`key`), val(value)) }
      deduplicated.loadSubset(options)
      expect(loadSubset.mock.calls[0]![0]).toBe(options)
      const matches = compileSingleRowExpression(
        loadSubset.mock.calls[0]![0].where!,
      )
      expect([value, equal, different].map((key) => matches({ key }))).toEqual([
        true,
        true,
        false,
      ])
      expect(
        deduplicated.loadSubset({ where: eq(ref(`key`), val(equal)) }),
      ).toBe(true)
      expect(loadSubset).toHaveBeenCalledTimes(1)
      deduplicated.loadSubset({ where: eq(ref(`key`), val(different)) })
      expect(loadSubset).toHaveBeenCalledTimes(2)
    },
  )

  it(`keeps immutable order and cursor data with its opaque identity`, () => {
    const opaque = Object.freeze({ id: 1 })
    const options: LoadSubsetOptions = {
      orderBy: [
        {
          expression: ref(`rank`),
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `locale`,
            localeOptions: Object.freeze({ numeric: true }),
          },
        },
      ],
      cursor: {
        whereFrom: gt(ref(`rank`), val(opaque)),
        whereCurrent: eq(ref(`rank`), val(opaque)),
      },
    }
    const request = captureRequest(options)
    expect(request).toBe(options)
    expect(((request.cursor!.whereFrom as Func).args[1] as Value).value).toBe(
      opaque,
    )
    expect(
      compileSingleRowExpression(request.cursor!.whereCurrent)({
        rank: opaque,
      }),
    ).toBe(true)
    expect(
      compileSingleRowExpression(request.cursor!.whereCurrent)({
        rank: { id: 1 },
      }),
    ).toBe(false)
  })

  it(`keeps completed cursor requests distinct from replacement Date constants`, async () => {
    const loadSubset = vi.fn<LoadSubsetFn>().mockResolvedValue(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })
    const request = (year: number): LoadSubsetOptions => ({
      cursor: {
        whereFrom: gt(ref(`createdAt`), val(new Date(year, 0))),
        whereCurrent: eq(ref(`createdAt`), val(new Date(year, 0))),
      },
      limit: 10,
    })
    await deduplicated.loadSubset(request(2025))
    await deduplicated.loadSubset(request(2026))
    expect(deduplicated.loadSubset(request(2025))).toBe(true)
    expect(loadSubset).toHaveBeenCalledTimes(2)
  })

  it(`does not substitute comparison payloads with custom instance methods`, () => {
    const date = new Date(2)
    const bytes = new Uint8Array([1, 2, 3])
    Object.defineProperty(date, `getTime`, { value: () => 1 })
    Object.defineProperty(bytes, `slice`, { value: () => bytes })
    const where = new Func<boolean>(`and`, [
      eq(ref(`date`), val(date)),
      eq(ref(`bytes`), val(bytes)),
    ])
    const request = captureRequest({ where })
    const rows = [
      { date, bytes },
      { date: new Date(2), bytes: new Uint8Array([1, 2, 3]) },
    ]
    expect(request.where).toBe(where)
    expect(rows.map(compileSingleRowExpression(request.where!))).toEqual(
      rows.map(compileSingleRowExpression(where)),
    )
  })

  describe.each([`Date`, `Uint8Array`] as const)(
    `request transport preserves %s predicate matches`,
    (type) => {
      it.each([`local`, `foreign`] as const)(`in the %s realm`, (realm) => {
        const local = type === `Date` ? new Date(2) : new Uint8Array([1, 2])
        const foreign: unknown = runInNewContext(
          type === `Date` ? `new Date(2)` : `new Uint8Array([1, 2])`,
        )
        const value = realm === `local` ? local : foreign
        for (const where of [
          eq(ref(`value`), val(value)),
          new Func<boolean>(`in`, [ref(`value`), val([value])]),
        ]) {
          const request = captureRequest({ where })
          const matches = compileSingleRowExpression(request.where!)
          expect(
            [foreign, local].map((item) => matches({ value: item })),
          ).toEqual(realm === `foreign` ? [true, false] : [false, true])
        }
      })
    },
  )

  it.each([`coalesce`, `caseWhen`] as const)(
    `preserves membership results through %s`,
    (wrapper) => {
      const candidates = Object.freeze([new Uint8Array([1])])
      const expression =
        wrapper === `coalesce`
          ? new Func(`coalesce`, [val(candidates)])
          : new Func(`caseWhen`, [val(true), val(candidates), val([])])
      const request = captureRequest({
        where: new Func(`in`, [ref(`token`), expression]),
      })
      const matches = compileSingleRowExpression(request.where!)
      expect(
        [1, 2, 3].map((n) => matches({ token: new Uint8Array([n]) })),
      ).toEqual([true, false, false])
      expect(candidates).toEqual([new Uint8Array([1])])
    },
  )

  it(`preserves immutable array ordering operands`, () => {
    const boundary = Object.freeze([1, Object.freeze([2])])
    const request = captureRequest({ where: gt(ref(`tuple`), val(boundary)) })
    const matches = compileSingleRowExpression(request.where!)
    expect(
      [
        [1, [1]],
        [1, [2]],
        [1, [3]],
      ].map((tuple) => matches({ tuple })),
    ).toEqual([false, false, true])
  })

  it.each([`in`, `gt`])(`preserves immutable sparse %s array data`, (name) => {
    const values = new Array<Date>(3)
    values[1] = new Date(7)
    Object.freeze(values)
    const request = captureRequest({
      where: new Func(name, [ref(`value`), val(values)]),
    })
    const payload = ((request.where as Func).args[1] as Value<Array<Date>>)
      .value
    expect(payload).toBe(values)
    expect(payload.length).toBe(3)
    expect(Object.hasOwn(payload, 0)).toBe(false)
    expect(Object.hasOwn(payload, 2)).toBe(false)
    expect(payload[1]!.getTime()).toBe(7)
  })

  it.each([`in`, `gt`])(
    `preserves nested-array comparison semantics for %s`,
    (name) => {
      const nested = [2]
      const values = Object.freeze([nested])
      const request = captureRequest({
        where: new Func(name, [ref(`value`), val(values)]),
      })
      const matches = compileSingleRowExpression(request.where!)
      const rows = name === `in` ? [nested, [2]] : [[[1]], [[2]], [[3]]]
      expect(rows.map((value) => matches({ value }))).toEqual(
        name === `in` ? [true, false] : [false, false, true],
      )
    },
  )
})

function captureRequest(options: LoadSubsetOptions): LoadSubsetOptions {
  let request!: LoadSubsetOptions
  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: (value) => {
      request = value
      return true
    },
  })
  deduplicated.loadSubset(options)
  return request
}
