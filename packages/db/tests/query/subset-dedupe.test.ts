import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import {
  DeduplicatedLoadSubset,
  cloneOptions,
} from '../../src/query/subset-dedupe'
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
      value: new Date(`2025-01-01T00:00:00.000Z`),
      mutate: (value: Date) => value.setUTCFullYear(2030),
      read: (value: Date) => value.getUTCFullYear(),
      expected: 2025,
    },
    {
      name: `binary`,
      value: new Uint8Array([1, 2, 3]),
      mutate: (value: Uint8Array) => (value[0] = 9),
      read: (value: Uint8Array) => value[0],
      expected: 1,
    },
  ])(
    `snapshots a mutable $name equality value`,
    ({ value, mutate, read, expected }) => {
      let request: LoadSubsetOptions | undefined
      const deduplicated = new DeduplicatedLoadSubset({
        loadSubset: (options) => {
          request = options
          return true
        },
      })

      deduplicated.loadSubset({ where: eq(ref(`key`), val(value)) })
      mutate(value as never)

      const stored = (request!.where as Func).args[1] as Value<never>
      expect(read(stored.value)).toBe(expected)
    },
  )

  it(`clones order and cursor structure without changing opaque identity`, () => {
    const opaque = Object.freeze({ id: 1 })
    const options: LoadSubsetOptions = {
      orderBy: [
        {
          expression: ref(`rank`),
          compareOptions: {
            direction: `asc`,
            nulls: `first`,
            stringSort: `locale`,
            localeOptions: { numeric: true },
          },
        },
      ],
      cursor: {
        whereFrom: gt(ref(`rank`), val(opaque)),
        whereCurrent: eq(ref(`rank`), val(opaque)),
      },
    }

    const cloned = cloneOptions(options)
    expect(cloned).not.toBe(options)
    expect(cloned.orderBy).not.toBe(options.orderBy)
    expect(cloned.cursor).not.toBe(options.cursor)
    expect(((cloned.cursor!.whereFrom as Func).args[1] as Value).value).toBe(
      opaque,
    )

    const originalCompareOptions = options.orderBy![0]!.compareOptions
    const clonedCompareOptions = cloned.orderBy![0]!.compareOptions
    if (
      originalCompareOptions.stringSort !== `locale` ||
      clonedCompareOptions.stringSort !== `locale`
    ) {
      throw new Error(`Expected locale comparison options`)
    }
    const originalLocaleOptions = originalCompareOptions.localeOptions as {
      numeric?: boolean
    }
    const clonedLocaleOptions = clonedCompareOptions.localeOptions as {
      numeric?: boolean
    }
    originalLocaleOptions.numeric = false
    expect(clonedLocaleOptions.numeric).toBe(true)
  })

  it(`keeps a completed cursor identity stable after its Date is mutated`, async () => {
    const loadSubset = vi.fn<LoadSubsetFn>().mockResolvedValue(undefined)
    const deduplicated = new DeduplicatedLoadSubset({ loadSubset })
    const boundary = new Date(`2025-01-01T00:00:00.000Z`)

    await deduplicated.loadSubset({
      cursor: {
        whereFrom: gt(ref(`createdAt`), val(boundary)),
        whereCurrent: eq(ref(`createdAt`), val(boundary)),
      },
      limit: 10,
    })
    boundary.setUTCFullYear(2026)
    await deduplicated.loadSubset({
      cursor: {
        whereFrom: gt(
          ref(`createdAt`),
          val(new Date(`2026-01-01T00:00:00.000Z`)),
        ),
        whereCurrent: eq(
          ref(`createdAt`),
          val(new Date(`2026-01-01T00:00:00.000Z`)),
        ),
      },
      limit: 10,
    })

    expect(loadSubset).toHaveBeenCalledTimes(2)
  })

  it(`snapshots comparison values without calling mutable instance methods`, () => {
    const date = new Date(2)
    Object.defineProperty(date, `getTime`, { value: () => 1 })
    const bytes = new Uint8Array([1, 2, 3])
    Object.defineProperty(bytes, `slice`, { value: () => bytes })

    const cloned = cloneOptions({
      where: new Func(`and`, [
        eq(ref(`date`), val(date)),
        eq(ref(`bytes`), val(bytes)),
      ]),
    })
    const [dateComparison, byteComparison] = (cloned.where as Func).args as [
      Func,
      Func,
    ]
    const clonedDate = (dateComparison.args[1] as Value<Date>).value
    const clonedBytes = (byteComparison.args[1] as Value<Uint8Array>).value

    expect(clonedDate.getTime()).toBe(2)
    expect(clonedBytes).not.toBe(bytes)
    expect(clonedBytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it(`preserves opaque cross-realm binary comparison identity`, () => {
    const bytes = runInNewContext(`new Uint8Array([1, 2, 3])`) as Uint8Array
    const cloned = cloneOptions({ where: eq(ref(`bytes`), val(bytes)) })
    const clonedBytes = ((cloned.where as Func).args[1] as Value<Uint8Array>)
      .value

    bytes[0] = 9
    expect(clonedBytes).toBe(bytes)
  })

  describe.each([`Date`, `Uint8Array`] as const)(
    `request cloning preserves %s predicate matches`,
    (type) => {
      it.each([`local`, `foreign`] as const)(`in the %s realm`, (realm) => {
        const local = type === `Date` ? new Date(2) : new Uint8Array([1, 2])
        const foreign: unknown = runInNewContext(
          type === `Date` ? `new Date(2)` : `new Uint8Array([1, 2])`,
        )
        const value = realm === `local` ? local : foreign
        for (const predicate of [
          eq(ref(`value`), val(value)),
          new Func<boolean>(`in`, [ref(`value`), val([value])]),
        ]) {
          const original = compileSingleRowExpression(predicate)
          const cloned = compileSingleRowExpression(
            cloneOptions({ where: predicate }).where!,
          )
          const rows = [foreign, local].map((item) => ({ value: item }))
          const expected = realm === `foreign` ? [true, false] : [false, true]
          expect(rows.map(original)).toEqual(expected)
          expect(rows.map(cloned)).toEqual(expected)
        }
      })
    },
  )

  it.each([`coalesce`, `caseWhen`] as const)(
    `snapshots membership candidates returned by %s`,
    (wrapper) => {
      const candidates = [new Uint8Array([1])]
      const candidateExpression =
        wrapper === `coalesce`
          ? new Func(`coalesce`, [new Value(candidates)])
          : new Func(`caseWhen`, [
              new Value(true),
              new Value(candidates),
              new Value([]),
            ])
      const cloned = cloneOptions({
        where: new Func(`in`, [ref(`token`), candidateExpression]),
      })

      candidates[0]![0] = 2
      candidates.push(new Uint8Array([3]))

      const clonedCandidates = (
        ((cloned.where as Func).args[1] as Func).args[
          wrapper === `coalesce` ? 0 : 1
        ] as Value<Array<Uint8Array>>
      ).value
      expect(clonedCandidates).toEqual([new Uint8Array([1])])
    },
  )

  it(`snapshots array ordering operands by value`, () => {
    const boundary: [number, Array<number>] = [1, [2]]
    const cloned = cloneOptions({ where: gt(ref(`tuple`), val(boundary)) })
    boundary[0] = 9
    boundary[1][0] = 9

    expect(((cloned.where as Func).args[1] as Value).value).toEqual([1, [2]])
  })

  it.each([
    { name: `in`, context: `membership candidate` },
    { name: `gt`, context: `ordering operand` },
  ])(
    `rejects observable $context accessors without calling them`,
    ({ name, context }) => {
      const candidates: Array<number> = []
      const get = vi.fn(() => 1)
      Object.defineProperty(candidates, 0, {
        enumerable: true,
        get,
      })
      candidates.length = 1

      expect(() =>
        cloneOptions({ where: new Func(name, [ref(`id`), val(candidates)]) }),
      ).toThrow(`Cannot snapshot ${context} accessor`)
      expect(get).not.toHaveBeenCalled()
    },
  )

  it.each([`in`, `gt`])(
    `preserves sparse %s arrays without reading inherited entries`,
    (name) => {
      const date = new Date(7)
      const values = new Array<Date>(3)
      values[1] = date
      const get = vi.fn(() => new Date(99))
      Object.setPrototypeOf(
        values,
        Object.create(Array.prototype, { 0: { get } }),
      )
      const cloned = cloneOptions({
        where: new Func(name, [ref(`value`), val(values)]),
      })
      const snapshot = ((cloned.where as Func).args[1] as Value<Array<Date>>)
        .value

      expect(snapshot).not.toBe(values)
      expect(snapshot.length).toBe(3)
      expect(Object.hasOwn(snapshot, 0)).toBe(false)
      expect(Object.hasOwn(snapshot, 2)).toBe(false)
      expect(get).not.toHaveBeenCalled()
      expect(snapshot[1]).not.toBe(date)
      date.setTime(9)
      expect(snapshot[1]!.getTime()).toBe(7)
    },
  )

  it.each([`in`, `gt`])(
    `preserves the nested-array snapshot depth for %s`,
    (name) => {
      const nested = [new Date(7)]
      const cloned = cloneOptions({
        where: new Func(name, [ref(`value`), val([nested])]),
      })
      const snapshot = (
        (cloned.where as Func).args[1] as Value<Array<Array<Date>>>
      ).value

      if (name === `in`) expect(snapshot[0]).toBe(nested)
      else {
        expect(snapshot[0]).not.toBe(nested)
        expect(snapshot[0]![0]).not.toBe(nested[0])
      }
      nested[0]!.setTime(9)
      expect(snapshot[0]![0]!.getTime()).toBe(name === `in` ? 9 : 7)
    },
  )
})
