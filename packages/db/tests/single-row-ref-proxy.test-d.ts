/**
 * Oracle owner: SingleRowRefProxy compile-time projection.
 *
 * Runtime callbacks receive one truthy path-recording proxy. Schema-level
 * nullishness nevertheless owns whether nested object access requires optional
 * chaining. TypeScript's structural assignability and `@ts-expect-error` are
 * the independent judges; the paired runtime test owns the recorded path.
 */
import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { eq, isNull } from '../src/query/builder/functions.js'
import type { Collection } from '../src/collection/index.js'
import type { SingleRowRefProxy } from '../src/query/builder/ref-proxy.js'
import type { RefLeaf } from '../src/query/builder/types.js'

interface Timestamp {
  seconds: number
  nanoseconds: number
}

type Variant =
  | { kind: `created`; payload: { author: string } }
  | { kind: `deleted`; payload: { reason: string } }

type Row = {
  id: string
  name: string
  nickname?: string
  deletedBy: string | null
  optionalTimestamp?: Timestamp
  nullableTimestamp: Timestamp | null
  nullishTimestamp?: Timestamp | null
  nested: { timestamp?: Timestamp }
  exactNull: null
  exactUndefined: undefined
  variant?: Variant
  mixed: Timestamp | string | undefined
  requiredDate: Date
  optionalDate?: Date
  nullableDate: Date | null
  requiredTags: Array<string>
  optionalTags?: Array<string>
  nullableTags: Array<string> | null
  requiredMap: Map<string, number>
  optionalMap?: Map<string, number>
  nullableMap: Map<string, number> | null
  requiredCallback: () => string
  optionalCallback?: () => string
  nullableCallback: (() => string) | null
  mixedObjects: Timestamp | Date | null
}

const collection = createCollection<Row, string>({
  getKey: (row) => row.id,
  sync: { sync: () => {} },
})

describe(`SingleRowRefProxy type algebra`, () => {
  test(`optional and nullable objects remain traversable with schema guards`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.optionalTimestamp).toEqualTypeOf<
        SingleRowRefProxy<Timestamp> | undefined
      >()
      expectTypeOf(row.optionalTimestamp?.seconds).toEqualTypeOf<
        RefLeaf<number> | undefined
      >()
      expectTypeOf(
        row.nullableTimestamp,
      ).toEqualTypeOf<SingleRowRefProxy<Timestamp> | null>()
      expectTypeOf(row.nullableTimestamp?.seconds).toEqualTypeOf<
        RefLeaf<number> | undefined
      >()
      expectTypeOf(row.nullishTimestamp).toEqualTypeOf<
        SingleRowRefProxy<Timestamp> | null | undefined
      >()
      expectTypeOf(row.nested.timestamp?.nanoseconds).toEqualTypeOf<
        RefLeaf<number> | undefined
      >()

      // @ts-expect-error Optional objects require a guard before traversal.
      row.optionalTimestamp.seconds
      // @ts-expect-error Nullable objects require a guard before traversal.
      row.nullableTimestamp.seconds
      // @ts-expect-error Unknown nested keys must not be fabricated.
      row.optionalTimestamp?.milliseconds

      return row.optionalTimestamp?.seconds
    })
  })

  test(`scalar and exact-nullish leaves retain their declared domains`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.name).toEqualTypeOf<RefLeaf<string>>()
      expectTypeOf(row.nickname).toEqualTypeOf<
        RefLeaf<string | undefined> | undefined
      >()
      expectTypeOf(row.deletedBy).toEqualTypeOf<RefLeaf<string | null>>()
      expectTypeOf(row.exactNull).toEqualTypeOf<RefLeaf<null>>()
      expectTypeOf(row.exactUndefined).toEqualTypeOf<RefLeaf<undefined>>()

      // @ts-expect-error Scalar leaves are not traversable objects.
      row.nickname?.length
      // @ts-expect-error Exact null does not acquire object fields.
      row.exactNull.value

      return row.name
    })
  })

  test(`JavaScript built-ins and functions remain scalar leaves`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.requiredDate).toEqualTypeOf<RefLeaf<Date>>()
      expectTypeOf(row.optionalDate).toEqualTypeOf<
        RefLeaf<Date | undefined> | undefined
      >()
      expectTypeOf(row.nullableDate).toEqualTypeOf<RefLeaf<Date | null>>()

      expectTypeOf(row.requiredTags).toEqualTypeOf<RefLeaf<Array<string>>>()
      expectTypeOf(row.optionalTags).toEqualTypeOf<
        RefLeaf<Array<string> | undefined> | undefined
      >()
      expectTypeOf(row.nullableTags).toEqualTypeOf<
        RefLeaf<Array<string> | null>
      >()

      expectTypeOf(row.requiredMap).toEqualTypeOf<
        RefLeaf<Map<string, number>>
      >()
      expectTypeOf(row.optionalMap).toEqualTypeOf<
        RefLeaf<Map<string, number> | undefined> | undefined
      >()
      expectTypeOf(row.nullableMap).toEqualTypeOf<
        RefLeaf<Map<string, number> | null>
      >()

      expectTypeOf(row.requiredCallback).toEqualTypeOf<RefLeaf<() => string>>()
      expectTypeOf(row.optionalCallback).toEqualTypeOf<
        RefLeaf<(() => string) | undefined> | undefined
      >()
      expectTypeOf(row.nullableCallback).toEqualTypeOf<
        RefLeaf<(() => string) | null>
      >()

      // @ts-expect-error Date methods are value behavior, not query paths.
      row.requiredDate.getTime
      // @ts-expect-error Optional Date methods are not traversable query paths.
      row.optionalDate?.toISOString
      // @ts-expect-error Array members are not traversable query paths.
      row.optionalTags?.length
      // @ts-expect-error Map methods are not traversable query paths.
      row.nullableMap.get
      // @ts-expect-error Function values remain leaves, not callable proxies.
      row.requiredCallback()

      return row.requiredDate
    })
  })

  test(`leaf-compatible helpers retain required and nullish built-ins`, () => {
    collection.createIndex((row) => {
      const requiredDate: RefLeaf<Date> = row.requiredDate
      const nullableDate: RefLeaf<Date | null> = row.nullableDate
      const optionalDate: RefLeaf<Date | undefined> | undefined =
        row.optionalDate
      const requiredTags: RefLeaf<Array<string>> = row.requiredTags
      const optionalTags: RefLeaf<Array<string> | undefined> | undefined =
        row.optionalTags
      const nullableMap: RefLeaf<Map<string, number> | null> = row.nullableMap
      const optionalCallback: RefLeaf<(() => string) | undefined> | undefined =
        row.optionalCallback

      void [
        requiredDate,
        nullableDate,
        optionalDate,
        requiredTags,
        optionalTags,
        nullableMap,
        optionalCallback,
      ]
      return row.id
    })
  })

  test(`direct expression consumers continue accepting built-in leaves`, () => {
    collection.createIndex((row) => {
      const equality = eq(row.nullableDate, new Date(0))
      const nullCheck = isNull(row.optionalDate)
      void [equality, nullCheck]
      return row.requiredDate
    })

    collection.subscribeChanges(() => {}, {
      where: (row) => isNull(row.nullableMap),
    })
  })

  test(`object unions expose shared structure without inventing variant keys`, () => {
    collection.createIndex((row) => {
      expectTypeOf(row.variant?.kind).toEqualTypeOf<
        RefLeaf<`created`> | RefLeaf<`deleted`> | undefined
      >()

      // Ref leaves record expressions; they do not provide value-level
      // discriminant narrowing for sibling proxy fields.
      // @ts-expect-error Variant-only nested fields remain unavailable.
      row.variant?.payload.author
      // @ts-expect-error Mixed object/scalar unions are opaque leaves.
      row.mixed.seconds
      expectTypeOf(row.mixedObjects).toEqualTypeOf<
        RefLeaf<Timestamp | Date | null>
      >()
      // @ts-expect-error Mixed plain/built-in object unions stay opaque.
      row.mixedObjects.seconds

      return row.variant?.kind
    })
  })

  test(`constrained generic optional objects retain guaranteed fields`, () => {
    function addTimestampIndex<T extends { id: string; timestamp?: Timestamp }>(
      rows: Collection<T, string>,
    ) {
      rows.createIndex((row) => row.timestamp?.seconds)
      rows.subscribeChanges(() => {}, {
        where: (row) => eq(row.timestamp?.nanoseconds, 0),
      })
    }

    void addTimestampIndex

    function keepBuiltInLeaves<
      T extends {
        id: string
        date?: Date
        tags: Array<string> | null
      },
    >(rows: Collection<T, string>) {
      rows.createIndex((row) => {
        const date: RefLeaf<Date | undefined> | undefined = row.date
        const tags: RefLeaf<Array<string> | null> = row.tags
        void [date, tags]
        return row.id
      })
    }

    void keepBuiltInLeaves
  })

  test(`all public SingleRowRefProxy callback paths share the same projection`, () => {
    collection.createIndex((row) => row.optionalTimestamp?.seconds)
    collection.subscribeChanges(() => {}, {
      where: (row) => eq(row.nullishTimestamp?.nanoseconds, 0),
    })
  })
})
