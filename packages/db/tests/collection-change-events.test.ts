import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "../src/collection/index.js"
import { currentStateAsChanges } from "../src/collection/change-events.js"
import { PropRef, Value } from "../src/query/ir.js"
import { DEFAULT_COMPARE_OPTIONS } from "../src/utils.js"
import { eq, gt } from "../src/query/builder/operators/index.js"

interface TestUser {
  id: string
  name: string
  age: number
  score: number
  status: `active` | `inactive`
}

describe(`currentStateAsChanges`, () => {
  let mockSync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockSync = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const users: Array<TestUser> = [
    { id: `1`, name: `Alice`, age: 25, score: 100, status: `active` },
    { id: `2`, name: `Bob`, age: 30, score: 80, status: `inactive` },
    { id: `3`, name: `Charlie`, age: 35, score: 90, status: `active` },
    { id: `4`, name: `David`, age: 20, score: 70, status: `active` },
    { id: `5`, name: `Eve`, age: 28, score: 95, status: `inactive` },
  ]

  // Helper function to create and populate collection with test data
  async function createAndPopulateCollection(
    autoIndex: `eager` | `off` = `eager`
  ) {
    const collection = createCollection<TestUser>({
      id: `test-collection-${autoIndex}`,
      getKey: (user) => user.id,
      autoIndex,
      sync: {
        sync: mockSync,
      },
    })

    // Insert users via sync
    mockSync.mockImplementation(({ begin, write, commit }) => {
      begin()
      users.forEach((user) => {
        write({
          type: `insert`,
          value: user,
        })
      })
      commit()
    })

    collection.startSyncImmediate()
    await collection.stateWhenReady()

    return collection
  }

  describe.each([
    [`with auto-indexing`, `eager`],
    [`without auto-indexing`, `off`],
  ])(`%s`, (testName, autoIndex) => {
    describe(`where clause without orderBy or limit`, () => {
      it(`should return all items when no where clause is provided`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection)

        expect(result).toHaveLength(5)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`,
          `Bob`,
          `Charlie`,
          `David`,
          `Eve`,
        ])
      })

      it(`should filter items based on where clause`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          where: eq(new PropRef([`status`]), new Value(`active`)),
        })

        expect(result).toHaveLength(3)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`,
          `Charlie`,
          `David`,
        ])
      })

      it(`should filter items based on numeric where clause`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          where: gt(new PropRef([`age`]), new Value(25)),
        })

        expect(result).toHaveLength(3)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Bob`,
          `Charlie`,
          `Eve`,
        ])
      })
    })

    describe(`orderBy without limit and no where clause`, () => {
      it(`should return all items ordered by name ascending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`name`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
        })

        expect(result).toHaveLength(5)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`,
          `Bob`,
          `Charlie`,
          `David`,
          `Eve`,
        ])
      })

      it(`should return all items ordered by score descending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`score`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` },
            },
          ],
        })

        expect(result).toHaveLength(5)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`, // score: 100
          `Eve`, // score: 95
          `Charlie`, // score: 90
          `Bob`, // score: 80
          `David`, // score: 70
        ])
      })

      it(`should return all items ordered by age ascending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`age`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
        })

        expect(result).toHaveLength(5)
        expect(result?.map((change) => change.value.name)).toEqual([
          `David`, // age: 20
          `Alice`, // age: 25
          `Eve`, // age: 28
          `Bob`, // age: 30
          `Charlie`, // age: 35
        ])
      })
    })

    describe(`orderBy with limit and no where clause`, () => {
      it(`should return top 3 items ordered by score descending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`score`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` },
            },
          ],
          limit: 3,
        })

        expect(result).toHaveLength(3)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`, // score: 100
          `Eve`, // score: 95
          `Charlie`, // score: 90
        ])
      })
    })

    describe(`orderBy with limit and where clause`, () => {
      it(`should return top active users ordered by score descending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          where: eq(new PropRef([`status`]), new Value(`active`)),
          orderBy: [
            {
              expression: new PropRef([`score`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` },
            },
          ],
          limit: 2,
        })

        expect(result).toHaveLength(2)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`, // score: 100, status: active
          `Charlie`, // score: 90, status: active
        ])
      })

      it(`should return top users over 25 ordered by age ascending`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          where: gt(new PropRef([`age`]), new Value(25)),
          orderBy: [
            {
              expression: new PropRef([`age`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
          limit: 2,
        })

        expect(result).toHaveLength(2)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Eve`, // age: 28
          `Bob`, // age: 30
        ])
      })

      it(`should handle multi-column orderBy with where clause`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          where: eq(new PropRef([`status`]), new Value(`active`)),
          orderBy: [
            {
              expression: new PropRef([`score`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `desc` },
            },
            {
              expression: new PropRef([`age`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
          limit: 2,
        })

        expect(result).toHaveLength(2)
        // Should be ordered by score desc, then age asc for ties
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`, // score: 100, age: 25
          `Charlie`, // score: 90, age: 35
        ])
      })
    })

    describe(`error cases`, () => {
      it(`should throw error when limit is provided without orderBy`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        expect(() => {
          currentStateAsChanges(collection, {
            limit: 5,
          })
        }).toThrow(`limit cannot be used without orderBy`)
      })

      it(`should throw error when limit is provided without orderBy even with where clause`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        expect(() => {
          currentStateAsChanges(collection, {
            where: eq(new PropRef([`status`]), new Value(`active`)),
            limit: 3,
          })
        }).toThrow(`limit cannot be used without orderBy`)
      })
    })

    describe(`optimizedOnly option`, () => {
      it(`should return undefined when optimizedOnly is true and no index is available`, async () => {
        // Only test this with auto-indexing disabled
        if (autoIndex === `off`) {
          const collection = await createAndPopulateCollection(`off`)

          const result = currentStateAsChanges(collection, {
            orderBy: [
              {
                expression: new PropRef([`score`]),
                compareOptions: {
                  ...DEFAULT_COMPARE_OPTIONS,
                  direction: `desc`,
                },
              },
            ],
            limit: 1,
            optimizedOnly: true,
          })

          expect(result).toBeUndefined()
        }
      })

      it(`should return results when optimizedOnly is true and index is available`, async () => {
        // Only test this with auto-indexing enabled
        if (autoIndex === `eager`) {
          const collection = await createAndPopulateCollection(`eager`)

          const result = currentStateAsChanges(collection, {
            orderBy: [
              {
                expression: new PropRef([`score`]),
                compareOptions: {
                  ...DEFAULT_COMPARE_OPTIONS,
                  direction: `desc`,
                },
              },
            ],
            limit: 1,
            optimizedOnly: true,
          })

          expect(result).toHaveLength(1)
          expect(result?.[0]?.value.name).toBe(`Alice`)
        }
      })
    })

    describe(`edge cases`, () => {
      it(`should handle empty collection`, () => {
        const collection = createCollection<TestUser>({
          id: `test-collection-empty-${autoIndex}`,
          getKey: (user) => user.id,
          autoIndex: autoIndex as `eager` | `off`,
          sync: {
            sync: mockSync,
          },
        })

        // Don't populate the collection
        collection.startSyncImmediate()

        const result = currentStateAsChanges(collection)

        expect(result).toHaveLength(0)
      })

      it(`should handle limit larger than collection size`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`name`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
          limit: 10, // More than the 5 items in collection
        })

        expect(result).toHaveLength(5)
        expect(result?.map((change) => change.value.name)).toEqual([
          `Alice`,
          `Bob`,
          `Charlie`,
          `David`,
          `Eve`,
        ])
      })

      it(`should handle limit of 0`, async () => {
        const collection = await createAndPopulateCollection(
          autoIndex as `eager` | `off`
        )

        const result = currentStateAsChanges(collection, {
          orderBy: [
            {
              expression: new PropRef([`name`]),
              compareOptions: { ...DEFAULT_COMPARE_OPTIONS, direction: `asc` },
            },
          ],
          limit: 0,
        })

        expect(result).toHaveLength(0)
      })
    })
  })
})
