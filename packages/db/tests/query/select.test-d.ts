import { describe, expectTypeOf, test } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { mockSyncCollectionOptions } from "../utils.js"
import { upper } from "../../src/query/builder/functions.js"

type User = {
  id: number
  name: string
  joinedDate: Date
  something: string
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
      id: `nested-select-users-type`,
      getKey: (u) => u.id,
      initialData: [],
    })
  )
}

describe(`select types`, () => {
  test(`works with functions`, () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        nameUpper: upper(u.name),
      }))
    )

    type Expected = {
      id: number
      nameUpper: string
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toEqualTypeOf<Expected>()
  })

  test(`works with js built-ins objects`, () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        joinedDate: u.joinedDate,
        name: u.name,
        something: u.something,
      }))
    )

    type Expected = {
      id: number
      joinedDate: Date
      name: string
      something: string
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toEqualTypeOf<Expected>()
  })

  test(`nested object selection infers nested result type`, () => {
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

    type Expected = {
      id: number
      meta: {
        city: string | undefined
        coords: { lat: number; lng: number } | undefined
      }
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toEqualTypeOf<Expected>()
  })

  test(`nested spread preserves object structure types`, () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) => {
      const r = q.from({ u: users }).select(({ u }) => {
        const s = {
          nameUpper: upper(u.name),
          user: {
            id: u.id,
            profile: { ...u.profile },
          },
        }
        return s
      })

      return r
    })

    type Expected = {
      nameUpper: string
      user: {
        id: number
        profile: {
          bio: string
          preferences: { notifications: boolean; theme: `light` | `dark` }
        }
      }
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toEqualTypeOf<Expected>()
  })
})
