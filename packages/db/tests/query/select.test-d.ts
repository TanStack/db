import { describe, expectTypeOf, test } from "vitest"
import { createCollection } from "../../src/collection.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { mockSyncCollectionOptions } from "../utls.js"
import { upper } from "../../src/query/builder/functions.js"

type User = {
  id: number
  name: string
  profile: {
    bio: string
    preferences: {
      notifications: boolean
      theme: `light` | `dark`
    }
  }
  address?: {
    city: string
    coordinates: {
      lat: number
      lng: number
    }
  }
}

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: "nested-select-users-type",
      getKey: (u) => u.id,
      initialData: [],
    })
  )
}

describe("nested select types", () => {
  test("nested object selection infers nested result type", () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        meta: {
          city: u.address?.city,
          coords: u.address?.coordinates,
        },
      }))
    )

    type Expected = Array<{
      id: number
      meta: {
        city: string | undefined
        coords: { lat: number; lng: number } | undefined
      }
    }>

    expectTypeOf(col.toArray).toEqualTypeOf<Expected>()
  })

  test("nested spread preserves object structure types", () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        user: {
          id: u.id,
          nameUpper: upper(u.name),
          profile: { ...u.profile },
        },
      }))
    )

    type Expected = Array<{
      user: {
        id: number
        nameUpper: string
        profile: {
          bio: string
          preferences: { notifications: boolean; theme: `light` | `dark` }
        }
      }
    }>

    expectTypeOf(col.toArray).toEqualTypeOf<Expected>()
  })
})


