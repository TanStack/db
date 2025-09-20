import { beforeEach, describe, expect, it } from "vitest"
import { createCollection } from "../../src/collection/index.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { mockSyncCollectionOptions } from "../utils.js"
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

const data: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    profile: {
      bio: `Engineer`,
      preferences: { notifications: true, theme: `dark` },
    },
    address: { city: `NYC`, coordinates: { lat: 40.7, lng: -74.0 } },
  },
  {
    id: 2,
    name: `Bob`,
    profile: {
      bio: `Dev`,
      preferences: { notifications: false, theme: `light` },
    },
  },
]

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `nested-select-users`,
      getKey: (u) => u.id,
      initialData: data,
    })
  )
}

describe(`nested select projections`, () => {
  let users: ReturnType<typeof createUsers>

  beforeEach(() => {
    users = createUsers()
  })

  it(`selects nested object structure`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        meta: {
          city: u.address?.city,
          coords: u.address?.coordinates,
        },
      }))
    )

    await collection.preload()

    const r1 = collection.get(1) as any
    expect(r1).toMatchObject({
      id: 1,
      meta: { city: `NYC`, coords: { lat: 40.7, lng: -74.0 } },
    })

    const r2 = collection.get(2) as any
    expect(r2).toMatchObject({ id: 2 })
    expect(r2.meta?.city).toBeUndefined()
    expect(r2.meta?.coords).toBeUndefined()
  })

  it(`supports nested spread of object refs under a key`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        preferences: {
          // spread all preference fields under preferences
          ...u.profile.preferences,
        },
      }))
    )

    await collection.preload()

    const r1 = collection.get(1) as any
    expect(r1.preferences).toEqual({ notifications: true, theme: `dark` })

    const r2 = collection.get(2) as any
    expect(r2.preferences).toEqual({ notifications: false, theme: `light` })
  })

  it(`allows mixing nested spreads and computed fields`, async () => {
    const collection = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        user: {
          id: u.id,
          nameUpper: upper(u.name),
          profile: {
            ...u.profile,
          },
        },
      }))
    )

    await collection.preload()

    const r1 = collection.get(1) as any
    expect(r1.user.id).toBe(1)
    expect(r1.user.nameUpper).toBe(`ALICE`)
    expect(r1.user.profile).toEqual({
      bio: `Engineer`,
      preferences: { notifications: true, theme: `dark` },
    })
  })
})
