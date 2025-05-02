import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { Collection } from "../src/collection"

describe(`Object-Key Association`, () => {
  let collection: Collection<{ name: string; age: number }>

  beforeEach(() => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    collection = new Collection<{ name: string; age: number }>({
      id: `test-sync`,
      schema,
      sync: {
        sync: async () => {},
      },
      mutationFn: async () => {},
    })
  })

  it(`should associate an object with its key after insert`, () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert(data, { key: `user1` })

    const item = collection.state.get(`user1`)

    // Make sure item exists before using it as a key
    expect(item).toBeDefined()

    // Update using the object reference
    collection.update(item, (draft) => {
      draft.age = 31
    })

    // Verify the update worked
    const updated = collection.state.get(`user1`)
    expect(updated).toEqual({ name: `John`, age: 31 })
  })

  it(`should work with multiple objects`, () => {
    // Insert multiple objects
    const johnData = { name: `John`, age: 30 }
    const janeData = { name: `Jane`, age: 28 }

    collection.insert([johnData, janeData], {
      key: [`user1`, `user2`],
    })

    const john = collection.state.get(`user1`)
    const jane = collection.state.get(`user2`)

    // Update multiple objects using their references
    collection.update([john!, jane!], (items) => {
      if (items[0] && items[1]) {
        items[0].age = 31
        items[1].name = `Jane Doe`
      }
    })

    // Verify updates
    expect(collection.state.get(`user1`)).toEqual({ name: `John`, age: 31 })
    expect(collection.state.get(`user2`)).toEqual({ name: `Jane Doe`, age: 28 })
  })

  it(`should handle delete with object reference`, () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert(data, { key: `user1` })

    const john = collection.state.get(`user1`)

    // Delete using the object reference
    collection.delete(john)

    // Verify deletion
    expect(collection.state.get(`user1`)).toBeUndefined()
  })

  it(`should maintain object-key association after updates`, () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert(data, { key: `user1` })

    const john = collection.state.get(`user1`)

    // First update
    collection.update(john, (item) => {
      item.age = 31
    })

    // Second update using the same object reference
    collection.update(john, (item) => {
      item.name = `John Doe`
    })

    // Verify both updates worked
    const updated = collection.state.get(`user1`)
    expect(updated).toEqual({ name: `John Doe`, age: 31 })
  })

  it(`should throw error when object is not associated with any key`, () => {
    const unknownObject = { name: `Unknown`, age: 25 }

    // Try to update using an object that wasn't inserted
    expect(() => {
      collection.update(unknownObject, (item) => {
        item.age = 26
      })
    }).toThrow()
  })

  it(`should support bulk insert with multiple keys`, () => {
    // Insert multiple objects
    const johnData = { name: `John`, age: 30 }
    const janeData = { name: `Jane`, age: 28 }
    const bobData = { name: `Bob`, age: 35 }

    collection.insert([johnData, janeData, bobData], {
      key: [`user1`, `user2`, `user3`],
    })

    const john = collection.state.get(`user1`)
    const jane = collection.state.get(`user2`)
    const bob = collection.state.get(`user3`)

    // Verify inserts
    expect(john).toEqual({ name: `John`, age: 30 })
    expect(jane).toEqual({ name: `Jane`, age: 28 })
    expect(bob).toEqual({ name: `Bob`, age: 35 })
  })
})
