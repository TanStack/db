import { describe, expect, it, vi } from 'vitest'
import {
  DeduplicatedLoadSubset,
  cloneOptions,
} from '../../src/query/subset-dedupe'
import { eq, gt } from '../../src/query/builder/functions'
import { Func, PropRef, Value } from '../../src/query/ir'
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
      .mockImplementationOnce(() =>
        new Promise<void>((done) => (resolve = done)),
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
  ])(`snapshots a mutable $name equality value`, ({ value, mutate, read, expected }) => {
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
  })

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

    options.orderBy![0]!.compareOptions.localeOptions!.numeric = false
    expect(cloned.orderBy![0]!.compareOptions.localeOptions?.numeric).toBe(true)
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
})
