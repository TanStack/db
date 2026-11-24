// Fixed examples for how value classes order and which objects are excluded.
// The law and its generated histories are owned by
// serialized-value-equality-oracle.property.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { Query } from '../../src/query/builder/index.js'
import {
  and,
  createLiveQueryCollection,
  eq,
  gte,
} from '../../src/query/index.js'
import { createPooledLiveQuery } from '../../src/query/pooled-live-query.js'
import { createLiveQueryObserver } from '../../src/live-query-observer.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import {
  compareValues,
  normalizeValue,
  serializedClassValue,
} from '../../src/utils/comparison.js'
import { mockSyncCollectionOptions } from '../utils.js'

// A built query is the builder class this entry point takes.
const poolQuery = (query: unknown) => createPooledLiveQuery(query as never)

class Bound {
  constructor(
    readonly json: string,
    readonly rank: number,
  ) {}
  toJSON() {
    return this.json
  }
  valueOf() {
    return this.rank
  }
}

const throwing = <T extends object>(target: T): T =>
  Object.defineProperty(target, `toJSON`, {
    get() {
      throw new Error(`toJSON was read`)
    },
  })

describe(`compareValues with value classes`, () => {
  it(`orders by the serialized value, not valueOf`, () => {
    expect(compareValues(new Bound(`b`, 1), new Bound(`a`, 9))).toBe(1)
    expect(compareValues(new Bound(`a`, 9), new Bound(`b`, 1))).toBe(-1)
    expect(compareValues(new Bound(`a`, 1), new Bound(`a`, 9))).toBe(0)
  })

  it(`puts primitives before a value class and other objects after it`, () => {
    expect(compareValues(new Bound(`a`, -1), 100)).toBe(1)
    expect(compareValues(100, new Bound(`a`, 999))).toBe(-1)
    expect(compareValues(new Bound(`a`, 999), new Map())).toBe(-1)
    expect(compareValues(new Map(), new Bound(`a`, 999))).toBe(1)
  })

  it(`compares arrays that hold value classes by those values`, () => {
    expect(compareValues([new Bound(`b`, 1)], [new Bound(`a`, 9)])).toBe(1)
    expect(compareValues([new Bound(`a`, 1)], [new Bound(`a`, 9)])).toBe(0)
  })

  it(`leaves values without a value class to the native operators`, () => {
    expect(compareValues(2, 10)).toBe(-1)
    expect(compareValues(`b`, `a`)).toBe(1)
    expect(compareValues(new Date(2), new Date(1))).toBe(1)
    expect(compareValues([2], [10])).toBe(1)
  })
})

describe(`compareValues with object leaves in value class arrays`, () => {
  it(`does not let an object leaf's reference break a tie`, () => {
    const shared = { shape: 1 }
    const row = [shared, new Bound(`a`, 1)]
    expect(compareValues(row, [shared, new Bound(`a`, 2)])).toBe(0)
    expect(compareValues(row, [{ shape: 1 }, new Bound(`a`, 2)])).toBe(0)
    expect(compareValues([{ shape: 1 }, new Bound(`a`, 2)], row)).toBe(0)
  })

  it(`orders by the value class after an object leaf`, () => {
    const row = [{ shape: 1 }, new Bound(`b`, 1)]
    expect(compareValues(row, [{ shape: 1 }, new Bound(`a`, 9)])).toBe(1)
    expect(compareValues([{ shape: 1 }, new Bound(`a`, 9)], row)).toBe(-1)
  })

  it(`orders an array holding a value class apart from a plain object`, () => {
    const array = [new Bound(`a`, 1)]
    for (const object of [{}, new Map()]) {
      expect(compareValues(array, object)).toBe(1)
      expect(compareValues(object, array)).toBe(-1)
    }
  })

  it(`terminates on cyclic arrays`, () => {
    const left: Array<unknown> = [new Bound(`a`, 1)]
    const right: Array<unknown> = [new Bound(`a`, 2)]
    left.push(left)
    right.push(right)
    expect(compareValues(left, right)).toBe(0)
  })
})

describe(`compareValues allocation`, () => {
  afterEach(() => vi.unstubAllGlobals())

  it(`allocates no Set unless an operand is an array`, () => {
    let created = 0
    class CountingSet<T> extends Set<T> {
      constructor(values?: Iterable<T>) {
        super(values)
        created++
      }
    }
    const date = new Date(1)
    const bound = new Bound(`a`, 1)
    vi.stubGlobal(`Set`, CountingSet)
    compareValues(1, 2)
    compareValues(`a`, `b`)
    compareValues(date, date)
    compareValues(bound, bound)
    vi.unstubAllGlobals()
    expect(created).toBe(0)
  })
})

describe(`indexes follow a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string | null }

  it.each([
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(
    `keeps ordered keys through sync writes with %s`,
    async (name, indexType) => {
      const collection = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `equal-replacement-sync-${name}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, ref: `text` },
            { id: `r1`, ref: new Map() },
          ],
          autoIndex: `off`,
          defaultIndexType: indexType,
        }),
      )
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.ref)
      for (const ref of [new Map(), null]) {
        collection.utils.begin()
        collection.utils.write({ type: `update`, value: { id: `r1`, ref } })
        collection.utils.commit()
      }
      expect(index.takeFromStart(2).sort()).toEqual([`r0`, `r1`])
      await collection.cleanup()
    },
  )

  it.each([
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(
    `keeps ordered keys through optimistic writes with %s`,
    async (name, indexType) => {
      const collection = createCollection({
        ...mockSyncCollectionOptions<Row>({
          id: `equal-replacement-optimistic-${name}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `r0`, ref: `text` },
            { id: `r1`, ref: new Map() },
          ],
          autoIndex: `off`,
          defaultIndexType: indexType,
        }),
        onUpdate: () => new Promise<void>(() => {}),
      })
      await collection.stateWhenReady()
      const index = collection.createIndex((row) => row.ref)
      for (const ref of [new Map(), null]) {
        collection.update(`r1`, (draft) => {
          draft.ref = ref
        })
      }
      expect(index.takeFromStart(2).sort()).toEqual([`r0`, `r1`])
    },
  )
})

describe(`a reference filter follows a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string }

  it.each([
    [`no index`, undefined],
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(`drops and regains the row with %s`, async (name, indexType) => {
    const first = new Map([[`k`, 1]])
    const second = new Map([[`k`, 1]])
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `reference-filter-${name}`,
        getKey: (row) => row.id,
        initialData: [
          { id: `a`, ref: first },
          { id: `b`, ref: `text` },
        ],
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    await collection.stateWhenReady()
    if (indexType !== undefined) collection.createIndex((row) => row.ref)
    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(first),
    ])
    const filtered: Array<string> = []
    const unfiltered: Array<string> = []
    const subscriptions = [
      collection.subscribeChanges(
        (changes) => {
          for (const change of changes)
            filtered.push(`${change.type}:${change.key}`)
        },
        { includeInitialState: true, whereExpression: where },
      ),
      collection.subscribeChanges((changes) => {
        for (const change of changes)
          unfiltered.push(`${change.type}:${change.key}`)
      }),
    ]
    const fresh = () =>
      collection.currentStateAsChanges({ where })!.map((change) => change.key)
    const replace = (ref: object) => {
      collection.utils.begin()
      collection.utils.write({ type: `update`, value: { id: `a`, ref } })
      collection.utils.commit()
    }

    replace(second)
    expect(fresh()).toEqual([])
    replace(first)
    expect(fresh()).toEqual([`a`])
    // Row b is rewritten deep-equal: no filter changes its answer.
    collection.utils.begin()
    collection.utils.write({ type: `update`, value: { id: `b`, ref: `text` } })
    collection.utils.commit()

    expect(filtered).toEqual([`insert:a`, `delete:a`, `insert:a`])
    expect(unfiltered).toEqual([])
    for (const subscription of subscriptions) subscription.unsubscribe()
    await collection.cleanup()
  })
})

describe(`queries follow a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string }
  let sources = 0
  const sourceOf = async (rows: Array<Row>) => {
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `query-replacement-${sources++}`,
        getKey: (row) => row.id,
        initialData: rows,
        autoIndex: `off`,
      }),
    )
    await collection.stateWhenReady()
    return collection
  }
  const replace = (
    collection: Awaited<ReturnType<typeof sourceOf>>,
    id: string,
    ref: object,
  ) => {
    collection.utils.begin()
    collection.utils.write({ type: `update`, value: { id, ref } })
    collection.utils.commit()
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it(`leaves and rejoins a join on a shared instance`, async () => {
    const shared = new Map()
    const left = await sourceOf([{ id: `l`, ref: shared }])
    const right = await sourceOf([{ id: `r`, ref: shared }])
    const pairs = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ a: left })
          .join({ b: right }, ({ a, b }) => eq(a.ref, b.ref), `inner`)
          .select(({ a, b }) => ({ a: a.id, b: b.id })),
    })
    await pairs.preload()
    expect(pairs.size).toBe(1)
    replace(right, `r`, new Map())
    await flush()
    expect(pairs.size).toBe(0)
    replace(right, `r`, shared)
    await flush()
    expect(pairs.size).toBe(1)
  })

  it(`follows a functional filter`, async () => {
    const shared = new Map()
    const source = await sourceOf([{ id: `a`, ref: shared }])
    const filtered = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source }).fn.where((row) => row.item.ref === shared),
    })
    await filtered.preload()
    expect(filtered.size).toBe(1)
    replace(source, `a`, new Map())
    await flush()
    expect(filtered.size).toBe(0)
    replace(source, `a`, shared)
    await flush()
    expect(filtered.size).toBe(1)
  })

  it(`follows a filter over a projection`, async () => {
    const shared = new Map()
    const source = await sourceOf([{ id: `a`, ref: shared }])
    const projected = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: source })
          .select(({ item }) => ({ id: item.id, ref: item.ref })),
    })
    const filtered = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: projected })
          .where(({ item }) => eq(item.ref as never, shared as never)),
    })
    await filtered.preload()
    expect(filtered.size).toBe(1)
    replace(source, `a`, new Map())
    await flush()
    expect(filtered.size).toBe(0)
    replace(source, `a`, shared)
    await flush()
    expect(filtered.size).toBe(1)
  })

  it(`tells nothing to readers that keep the row`, async () => {
    const source = await sourceOf([{ id: `a`, ref: new Map() }])
    const live = createLiveQueryCollection({
      query: (q) =>
        q.from({ item: source }).where(({ item }) => eq(item.id, `a`)),
    })
    await live.preload()
    const seen: Array<string> = []
    const record = (changes: Array<{ type: string }>) => {
      for (const change of changes) seen.push(change.type)
    }
    const subscriptions = [
      live.subscribeChanges(record),
      source.subscribeChanges(record, {
        where: (row) => eq(row.id, `a`),
      }),
    ]
    const effect = createEffect<Row, string>({
      query: (q) =>
        q.from({ item: source }).where(({ item }) => eq(item.id, `a`)),
      skipInitial: true,
      onEnter: () => void seen.push(`enter`),
      onExit: () => void seen.push(`exit`),
      onUpdate: () => void seen.push(`update`),
    })
    await flush()
    replace(source, `a`, new Map())
    await flush()
    expect(seen).toEqual([])
    for (const subscription of subscriptions) subscription.unsubscribe()
    await effect.dispose()
  })

  it.each([`unordered`, `ordered`] as const)(
    `keeps another row's update in a %s Effect`,
    async (variant) => {
      type Versioned = Row & { version: number }
      // Deep-equal to any other version under row equality.
      class PrivateVersion {
        readonly kind = `version`
        #version: number
        constructor(version: number) {
          this.#version = version
        }
        get version() {
          return this.#version
        }
      }
      const source = createCollection(
        mockSyncCollectionOptions<Versioned>({
          id: `effect-scope-${variant}`,
          getKey: (row) => row.id,
          initialData: [
            { id: `a`, ref: new Map(), version: 0 },
            { id: `b`, ref: `text`, version: 0 },
          ],
          autoIndex: `off`,
        }),
      )
      await source.stateWhenReady()
      const project = (row: { item: Versioned }) => ({
        id: row.item.id,
        state: new PrivateVersion(row.item.version),
      })
      const seen: Array<[string, number]> = []
      const effect = createEffect<
        { id: string; state: PrivateVersion },
        string
      >({
        query: (q) =>
          variant === `ordered`
            ? q
                .from({ item: source })
                .orderBy(({ item }) => item.id)
                .limit(2)
                .fn.select(project)
            : q.from({ item: source }).fn.select(project),
        skipInitial: true,
        onUpdate: (event) =>
          void seen.push([event.value.id, event.value.state.version]),
      })
      await flush()
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: `a`, ref: new Map(), version: 0 },
      })
      source.utils.write({
        type: `update`,
        value: { id: `b`, ref: `text`, version: 1 },
      })
      source.utils.commit()
      await flush()
      expect(seen).toEqual([[`b`, 1]])
      await effect.dispose()
    },
  )

  it(`ends an Effect's row when its join stops matching`, async () => {
    const shared = new Map()
    const left = await sourceOf([{ id: `l`, ref: shared }])
    const right = await sourceOf([{ id: `r`, ref: shared }])
    const seen: Array<string> = []
    const effect = createEffect({
      query: (q) =>
        q
          .from({ a: left })
          .join({ b: right }, ({ a, b }) => eq(a.ref, b.ref), `inner`)
          .select(({ a, b }) => ({ a: a.id, b: b.id })),
      skipInitial: true,
      onEnter: () => void seen.push(`enter`),
      onExit: () => void seen.push(`exit`),
      onUpdate: () => void seen.push(`update`),
    })
    await flush()
    replace(right, `r`, new Map())
    await flush()
    expect(seen).toEqual([`exit`])
    await effect.dispose()
  })
})

describe(`pooled queries follow a deep-equal row replacement`, () => {
  type Row = { id: string; ref: object | string }
  // Deep-equal to any other instance, since its value is private.
  class Hidden {
    readonly kind = `hidden`
    #json: string
    constructor(json: string) {
      this.#json = json
    }
    toJSON() {
      return this.#json
    }
  }
  let sources = 0
  const setup = async (ref: object, where: any) => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `pooled-replacement-${sources++}`,
        getKey: (row) => row.id,
        initialData: [{ id: `a`, ref }],
        autoIndex: `off`,
      }),
    )
    await source.stateWhenReady()
    const build = () => new Query().from({ item: source }).where(where)
    const view = poolQuery(build())!
    const ordinary = createLiveQueryCollection({ query: () => build() as any })
    await ordinary.preload()
    const replace = (next: object) => {
      source.utils.begin()
      source.utils.write({ type: `update`, value: { id: `a`, ref: next } })
      source.utils.commit()
    }
    const attached = createLiveQueryObserver<Row, string>(view as never)
    const stop = attached.subscribe(() => {})
    const detached = createLiveQueryObserver<Row, string>(view as never)
    const ids = (observer: typeof attached) =>
      (observer.getSnapshot().data as Array<Row>).map((row) => row.id)
    const expectRows = (rows: Array<string>) => {
      expect(ordinary.toArray.map((row) => row.id)).toEqual(rows)
      expect(ids(attached)).toEqual(rows)
      expect(ids(detached)).toEqual(rows)
    }
    return {
      replace,
      expectRows,
      attached,
      done: async () => {
        stop()
        attached.dispose()
        detached.dispose()
        await view.cleanup()
        await ordinary.cleanup()
      },
    }
  }

  it(`follows a reference residual`, async () => {
    const shared = new Map()
    const query = await setup(shared, ({ item }: any) =>
      and(eq(item.id, `a`), eq(item.ref, shared)),
    )
    query.expectRows([`a`])
    query.replace(new Map())
    query.expectRows([])
    query.replace(shared)
    query.expectRows([`a`])
    await query.done()
  })

  it(`follows a value class across a serialized range bound`, async () => {
    const query = await setup(new Hidden(`m`), ({ item }: any) =>
      and(eq(item.id, `a`), gte(item.ref, new Hidden(`k`) as never)),
    )
    query.expectRows([`a`])
    query.replace(new Hidden(`c`))
    query.expectRows([])
    query.replace(new Hidden(`z`))
    query.expectRows([`a`])
    await query.done()
  })

  it(`follows a value class out of its equality group`, async () => {
    const query = await setup(new Hidden(`m`), ({ item }: any) =>
      eq(item.ref, new Hidden(`m`) as never),
    )
    query.expectRows([`a`])
    query.replace(new Hidden(`n`))
    query.expectRows([])
    await query.done()
  })

  it(`keeps its snapshot when the row stays matched`, async () => {
    const query = await setup(new Map(), ({ item }: any) =>
      and(eq(item.id, `a`), gte(item.id, `a`)),
    )
    const before = query.attached.getSnapshot()
    query.replace(new Map())
    expect(query.attached.getSnapshot()).toBe(before)
    query.expectRows([`a`])
    await query.done()
  })
})

describe(`arrays shared between the operands of a range`, () => {
  it(`orders a row that holds the capture like one that holds a copy`, () => {
    const capture = [[new Bound(`one`, 1)]]
    const copy = [[new Bound(`one`, 2)]]
    expect(compareValues([capture], capture)).toBe(1)
    expect(compareValues([copy], capture)).toBe(1)
    expect(compareValues(capture, [capture])).toBe(-1)
    expect(compareValues(capture, [copy])).toBe(-1)
    // The same array on both sides at one depth is still equal to itself.
    expect(compareValues([capture, capture], [capture, copy])).toBe(0)
  })

  it(`ends on arrays that contain themselves`, () => {
    const loop = (): Array<unknown> => {
      const array: Array<unknown> = [new Bound(`x`, 1)]
      array.push(array)
      return array
    }
    const a = loop()
    const b = loop()
    const unrolled: Array<unknown> = [new Bound(`x`, 1)]
    unrolled.push([new Bound(`x`, 2), unrolled])
    expect(compareValues(a, a)).toBe(0)
    expect(compareValues(a, b)).toBe(0)
    expect(compareValues(a, unrolled)).toBe(0)
    const later = loop()
    later[0] = new Bound(`y`, 0)
    expect(compareValues(a, later)).toBe(-1)
    expect(compareValues(later, a)).toBe(1)
  })
})

describe(`excluded objects with a throwing toJSON accessor`, () => {
  const excluded = (): Array<[string, object]> => [
    [`plain record`, throwing({ a: 1 })],
    [`null-prototype record`, throwing(Object.create(null))],
    [`array`, throwing([1])],
    [`Date`, throwing(new Date(1))],
    [`Map`, throwing(new Map())],
    [`Set`, throwing(new Set())],
    [`ArrayBuffer`, throwing(new ArrayBuffer(1))],
    [`typed array`, throwing(new Uint8Array(1))],
  ]

  it.each(excluded())(`does not read it on a %s`, (_name, value) => {
    expect(serializedClassValue(value)).toBeUndefined()
    expect(() => normalizeValue(value)).not.toThrow()
  })

  it.each([
    [`no index`, undefined],
    [`BasicIndex`, BasicIndex],
    [`BTreeIndex`, BTreeIndex],
  ] as const)(`keeps reference equality with %s`, async (_name, indexType) => {
    type Row = { id: string; ref: object }
    const ref = throwing({ a: 1 })
    const collection = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `excluded-accessor-${_name}`,
        getKey: (row) => row.id,
        initialData: [
          { id: `same`, ref },
          { id: `other`, ref: throwing({ a: 1 }) },
        ],
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    await collection.stateWhenReady()
    if (indexType !== undefined) collection.createIndex((row) => row.ref)
    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(ref),
    ])
    expect(
      collection.currentStateAsChanges({ where })!.map((change) => change.key),
    ).toEqual([`same`])
    await collection.cleanup()
  })
})

describe(`distinct shows an instance a row still holds`, () => {
  class Versioned {
    #version: number
    constructor(
      readonly json: string,
      version: number,
    ) {
      this.#version = version
    }
    get version() {
      return this.#version
    }
    toJSON() {
      return this.json
    }
  }
  type Row = { id: string; at: Versioned }
  type Source = ReturnType<typeof sourceOf>

  let nextSource = 0
  const sourceOf = (rows: Array<Row>) =>
    createCollection(
      mockSyncCollectionOptions<Row>({
        id: `distinct-instance-${nextSource++}`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
  const queries = {
    unordered: (source: Source) =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: source })
            .select(({ item }) => ({ at: item.at }))
            .distinct(),
      }),
    ordered: (source: Source) =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ item: source })
            .select(({ item }) => ({ at: item.at }))
            .distinct()
            .orderBy(({ item }) => item.at),
      }),
  }
  const write = (
    source: Source,
    changes: Array<{ type: `update` | `delete`; value: Row }>,
  ) => {
    source.utils.begin()
    for (const change of changes) source.utils.write(change)
    source.utils.commit()
  }

  describe.each([`unordered`, `ordered`] as const)(`%s`, (kind) => {
    const open = async (rows: Array<Row>) => {
      const source = sourceOf(rows)
      const live = queries[kind](source)
      await live.preload()
      const changes: Array<unknown> = []
      const subscription = live.subscribeChanges((batch) => {
        changes.push(...batch)
      })
      return { source, live, changes, subscription }
    }

    it(`follows the only row in the group`, async () => {
      const next = new Versioned(`a`, 2)
      const { source, live, changes, subscription } = await open([
        { id: `r1`, at: new Versioned(`a`, 1) },
      ])
      write(source, [{ type: `update`, value: { id: `r1`, at: next } }])
      expect(live.toArray).toHaveLength(1)
      expect(live.toArray[0]!.at).toBe(next)
      expect(live.toArray[0]!.at.version).toBe(2)
      expect(changes).toEqual([])
      subscription.unsubscribe()
    })

    it(`follows repeated replacements and then retracts`, async () => {
      const second = new Versioned(`a`, 2)
      const third = new Versioned(`a`, 3)
      const { source, live, subscription } = await open([
        { id: `r1`, at: new Versioned(`a`, 1) },
      ])
      write(source, [{ type: `update`, value: { id: `r1`, at: second } }])
      write(source, [{ type: `update`, value: { id: `r1`, at: third } }])
      expect(live.toArray[0]!.at).toBe(third)
      write(source, [{ type: `delete`, value: { id: `r1`, at: third } }])
      expect(live.toArray).toEqual([])
      subscription.unsubscribe()
    })

    it(`follows every row replaced in one batch`, async () => {
      const old = new Versioned(`a`, 1)
      const next = new Versioned(`a`, 2)
      const { source, live, subscription } = await open([
        { id: `r1`, at: old },
        { id: `r2`, at: old },
      ])
      write(source, [
        { type: `update`, value: { id: `r1`, at: next } },
        { type: `update`, value: { id: `r2`, at: next } },
      ])
      expect(live.toArray.map((row) => row.at)).toEqual([next])
      expect(live.toArray[0]!.at).toBe(next)
      subscription.unsubscribe()
    })

    it(`leaves a replaced instance while another row stays`, async () => {
      const old = new Versioned(`a`, 1)
      const other = new Versioned(`a`, 3)
      const next = new Versioned(`a`, 2)
      const { source, live, subscription } = await open([
        { id: `r1`, at: old },
        { id: `r2`, at: other },
      ])
      const shown = live.toArray[0]!.at
      const shownId = shown === old ? `r1` : `r2`
      write(source, [{ type: `update`, value: { id: shownId, at: next } }])
      expect(live.toArray).toHaveLength(1)
      expect(live.toArray[0]!.at).not.toBe(shown)
      expect([old, other, next]).toContain(live.toArray[0]!.at)
      subscription.unsubscribe()
    })

    it(`moves to a remaining row when the shown row is deleted`, async () => {
      const first = new Versioned(`a`, 1)
      const second = new Versioned(`a`, 2)
      const rows = [
        { id: `r1`, at: first },
        { id: `r2`, at: second },
      ]
      const { source, live, subscription } = await open(rows)
      const shown = live.toArray[0]!.at
      const removed = rows.find((row) => row.at === shown)!
      const kept = rows.find((row) => row.at !== shown)!
      write(source, [{ type: `delete`, value: removed }])
      expect(live.toArray).toHaveLength(1)
      expect(live.toArray[0]!.at).toBe(kept.at)
      write(source, [{ type: `delete`, value: kept }])
      expect(live.toArray).toEqual([])
      subscription.unsubscribe()
    })
  })
})

describe(`an update between values that hash alike`, () => {
  class Labelled {
    constructor(readonly label: string) {}
  }
  type Row = { id: string; value: object }

  it(`reaches an ordered query and a filter over it`, async () => {
    const before = { label: `a` }
    const after = new Labelled(`a`)
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `hash-alike-update`,
        getKey: (row) => row.id,
        initialData: [{ id: `r1`, value: before }],
      }),
    )
    const ordered = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: source })
          .orderBy(({ item }) => item.id)
          .select(({ item }) => ({ id: item.id, value: item.value })),
    })
    const filtered = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ item: ordered })
          .where(({ item }) => eq(item.value as never, before as never)),
    })
    await Promise.all([ordered.preload(), filtered.preload()])
    expect(filtered.toArray).toHaveLength(1)

    source.utils.begin()
    source.utils.write({ type: `update`, value: { id: `r1`, value: after } })
    source.utils.commit()

    expect(ordered.toArray[0]!.value).toBe(after)
    expect(filtered.toArray).toEqual([])
  })
})

describe(`abandoned pooled views`, () => {
  it(`cost a deep-equal replacement nothing while a peer stays mounted`, async () => {
    type Row = { id: string; meta: { n: number } }
    let reads = 0
    // Counts reads of `meta.n`, which each residual filter evaluates. A row is
    // stored as a shallow copy, so the nested getter still runs on reads. Two
    // rows that hold the same `n` are deep-equal.
    const counted = (): Row => ({
      id: `a`,
      meta: Object.defineProperty({} as { n: number }, `n`, {
        enumerable: true,
        get: () => {
          reads++
          return 1
        },
      }),
    })
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `abandoned-pooled-views`,
        getKey: (row) => row.id,
        initialData: [counted()],
        autoIndex: `off`,
      }),
    )
    await source.stateWhenReady()
    // A mounted peer with no residual filter keeps the partition alive.
    const peer = createLiveQueryObserver<Row, string>(
      poolQuery(
        new Query()
          .from({ item: source })
          .where(({ item }) => eq(item.id, `a`)),
      ) as never,
    )
    const stopPeer = peer.subscribe(() => {})
    const replace = () => {
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: counted(),
      })
      source.utils.commit()
    }
    replace()
    reads = 0
    replace()
    const baseline = reads

    for (let index = 0; index < 20; index++) {
      const view = poolQuery(
        new Query()
          .from({ item: source })
          .where(({ item }) => and(eq(item.id, `a`), gte(item.meta.n, -index))),
      )
      const observer = createLiveQueryObserver<Row, string>(view as never)
      // Mounted, read, then unmounted without cleaning the view up.
      observer.subscribe(() => {})()
      observer.getSnapshot()
      observer.dispose()
    }
    reads = 0
    replace()
    expect(reads).toBe(baseline)

    stopPeer()
    peer.dispose()
    await source.cleanup()
  })
})
