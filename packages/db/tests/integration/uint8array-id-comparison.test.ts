import { describe, expect, it } from "vitest"
import { createCollection, eq } from "../../src/index.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { mockSyncCollectionOptions } from "../utils.js"

interface Item {
  id: Uint8Array
  name: string
}

describe(`Uint8Array ID comparison (user reproduction)`, () => {
  it(`should find items by Uint8Array ID using eq`, async () => {
    const makeItemName = (index: number) => `Item ${index}`

    // Create data exactly like the user's reproduction
    const data = Array.from({ length: 10 }).map(
      (_, index): Item => ({
        id: new Uint8Array(index), // Creates arrays of different lengths
        name: makeItemName(index),
      })
    )

    const itemCollection = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `uint8array-test`,
        getKey: (item) => item.id.toString(),
        initialData: data,
        autoIndex: `eager`, // Enable auto-indexing to test index lookups
      })
    )

    const selectedItemIndex = 5

    // Test: Find item by Uint8Array ID (this is what the user is trying to do)
    const queryCollection = createLiveQueryCollection((q) =>
      q
        .from({ item: itemCollection })
        .where(({ item }) => eq(item.id, new Uint8Array(selectedItemIndex)))
        .findOne()
    )

    await queryCollection.preload()

    // For findOne(), get the single result from entries
    const result = Array.from(queryCollection.entries())[0]?.[1]

    // Should find "Item 5"
    expect(result).toBeDefined()
    expect(result?.name).toBe(makeItemName(selectedItemIndex))

    // Test with a different index
    const queryCollection2 = createLiveQueryCollection((q) =>
      q
        .from({ item: itemCollection })
        .where(({ item }) => eq(item.id, new Uint8Array(0)))
        .findOne()
    )

    await queryCollection2.preload()

    const result2 = Array.from(queryCollection2.entries())[0]?.[1]

    expect(result2).toBeDefined()
    expect(result2?.name).toBe(makeItemName(0))

    // Test: Find by string name (this should work)
    const queryByName = createLiveQueryCollection((q) =>
      q
        .from({ item: itemCollection })
        .where(({ item }) => eq(item.name, makeItemName(selectedItemIndex)))
        .findOne()
    )

    await queryByName.preload()

    const resultByName = Array.from(queryByName.entries())[0]?.[1]

    expect(resultByName).toBeDefined()
    expect(resultByName?.name).toBe(makeItemName(selectedItemIndex))
  })
})
