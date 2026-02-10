import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

type LeftRow = {
  id: number
  joinedAt: Date
  name: string
}

type RightRow = {
  id: number
  joinedAt: Date
  label: string
}

function createLeftCollection(
  autoIndex: `off` | `eager`,
  initialData: Array<LeftRow>,
) {
  return createCollection(
    mockSyncCollectionOptions<LeftRow>({
      id: `join-date-left-${autoIndex}`,
      getKey: (row) => row.id,
      initialData,
      autoIndex,
    }),
  )
}

function createRightCollection(
  autoIndex: `off` | `eager`,
  initialData: Array<RightRow>,
) {
  return createCollection(
    mockSyncCollectionOptions<RightRow>({
      id: `join-date-right-${autoIndex}`,
      getKey: (row) => row.id,
      initialData,
      autoIndex,
    }),
  )
}

describe.each([`off`, `eager`] as const)(
  `Date joins with autoIndex %s`,
  (autoIndex) => {
    const baseTimestamp = Date.parse(`2025-01-15T12:34:56.789Z`)

    test(`matches Date join keys by timestamp instead of object reference`, () => {
      const leftData: Array<LeftRow> = [
        { id: 1, joinedAt: new Date(baseTimestamp), name: `left-1` },
      ]
      const rightData: Array<RightRow> = [
        { id: 10, joinedAt: new Date(baseTimestamp), label: `right-10` },
      ]

      // Guard against accidentally sharing the same Date object instance.
      expect(leftData[0]!.joinedAt).not.toBe(rightData[0]!.joinedAt)
      expect(leftData[0]!.joinedAt.getTime()).toBe(
        rightData[0]!.joinedAt.getTime(),
      )

      const leftCollection = createLeftCollection(autoIndex, leftData)
      const rightCollection = createRightCollection(autoIndex, rightData)

      const query = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ left: leftCollection })
            .innerJoin({ right: rightCollection }, ({ left, right }) =>
              eq(left.joinedAt, right.joinedAt),
            )
            .select(({ left, right }) => ({
              leftId: left.id,
              rightId: right.id,
            })),
      })

      expect(query.toArray).toHaveLength(1)
      expect(query.toArray[0]).toEqual({ leftId: 1, rightId: 10 })
    })

    test(`updates Date join matches when timestamp changes`, () => {
      const leftCollection = createLeftCollection(autoIndex, [
        { id: 1, joinedAt: new Date(baseTimestamp), name: `left-1` },
      ])
      const rightCollection = createRightCollection(autoIndex, [
        {
          id: 10,
          joinedAt: new Date(baseTimestamp + 1),
          label: `right-10`,
        },
      ])

      const query = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ left: leftCollection })
            .innerJoin({ right: rightCollection }, ({ left, right }) =>
              eq(left.joinedAt, right.joinedAt),
            )
            .select(({ left, right }) => ({
              leftId: left.id,
              rightId: right.id,
            })),
      })

      expect(query.toArray).toHaveLength(0)

      rightCollection.utils.begin()
      rightCollection.utils.write({
        type: `update`,
        value: { id: 10, joinedAt: new Date(baseTimestamp), label: `right-10` },
      })
      rightCollection.utils.commit()

      expect(query.toArray).toHaveLength(1)
      expect(query.toArray[0]).toEqual({ leftId: 1, rightId: 10 })
    })
  },
)
