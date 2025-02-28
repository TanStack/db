import { describe, it, expect, beforeEach } from "vitest"
import { Collection } from "./collection"
import { z } from "zod"
import "fake-indexeddb/auto"

describe(`Object-Key Association`, () => {
  let collection: Collection<{ name: string; age: number }>

  beforeEach(() => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    })

    collection = new Collection<{ name: string; age: number }>({
      name: `test-collection`,
      schema,
      sync: {
        id: `test-sync`,
        sync: async () => {},
      },
      mutationFn: {
        persist: async () => {},
        awaitSync: async () => {},
      },
    })
  })

  it(`should associate an object with its key after insert`, async () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert({
      key: `user1`,
      data,
    })

    const item = collection.value.get(`user1`)

    // Make sure item exists before using it as a key
    expect(item).toBeDefined()

    // Update using the object reference
    collection.update({
      key: item!,
      callback: (item) => {
        item.age = 31
      },
    })

    // Verify the update worked
    const updated = collection.value.get(`user1`)
    expect(updated).toEqual({ name: `John`, age: 31 })
  })

  it(`should work with multiple objects`, async () => {
    // Insert multiple objects
    const johnData = { name: `John`, age: 30 }
    const janeData = { name: `Jane`, age: 28 }

    collection.insert({
      key: `user1`,
      data: johnData,
    })

    collection.insert({
      key: `user2`,
      data: janeData,
    })

    const john = collection.value.get(`user1`)
    const jane = collection.value.get(`user2`)

    // Update multiple objects using their references
    collection.update({
      key: [john, jane],
      callback: ([johnProxy, janeProxy]) => {
        johnProxy.age = 31
        janeProxy.name = `Jane Doe`
      },
    })

    // Verify updates
    expect(collection.value.get(`user1`)).toEqual({ name: `John`, age: 31 })
    expect(collection.value.get(`user2`)).toEqual({ name: `Jane Doe`, age: 28 })
  })

  it(`should handle delete with object reference`, async () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert({
      key: `user1`,
      data,
    })

    const john = collection.value.get(`user1`)

    // Delete using the object reference
    collection.delete({
      key: john,
    })

    // Verify deletion
    expect(collection.value.get(`user1`)).toBeUndefined()
  })

  it(`should maintain object-key association after updates`, async () => {
    // Insert an object
    const data = { name: `John`, age: 30 }
    collection.insert({
      key: `user1`,
      data,
    })

    const john = collection.value.get(`user1`)

    // First update
    collection.update({
      key: john,
      callback: (proxy) => {
        proxy.age = 31
      },
    })

    // Second update using the same object reference
    collection.update({
      key: john,
      callback: (proxy) => {
        proxy.name = `John Doe`
      },
    })

    // Verify both updates worked
    const updated = collection.value.get(`user1`)
    expect(updated).toEqual({ name: `John Doe`, age: 31 })
  })

  it(`should throw error when object is not associated with any key`, () => {
    const unknownObject = { name: `Unknown`, age: 25 }

    // Try to update using an object that wasn't inserted
    expect(() => {
      collection.update({
        key: unknownObject,
        callback: (proxy) => {
          proxy.age = 26
        },
      })
    }).toThrow()
  })
})
