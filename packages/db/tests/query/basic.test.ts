import { beforeEach, describe, expect, test } from "vitest"
import {
  concat,
  createLiveQueryCollection,
  eq,
  gt,
  upper,
} from "../../src/query/index.js"
import { createCollection } from "../../src/collection.js"
import { mockSyncCollectionOptions } from "../utls.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
  profile?: {
    bio: string
    avatar: string
    preferences: {
      notifications: boolean
      theme: `light` | `dark`
    }
  }
  address?: {
    street: string
    city: string
    country: string
    coordinates: {
      lat: number
      lng: number
    }
  }
}

// Sample data for tests
const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    age: 25,
    email: `alice@example.com`,
    active: true,
    profile: {
      bio: `Software engineer with 5 years experience`,
      avatar: `https://example.com/alice.jpg`,
      preferences: {
        notifications: true,
        theme: `dark`,
      },
    },
    address: {
      street: `123 Main St`,
      city: `New York`,
      country: `USA`,
      coordinates: {
        lat: 40.7128,
        lng: -74.006,
      },
    },
  },
  {
    id: 2,
    name: `Bob`,
    age: 19,
    email: `bob@example.com`,
    active: true,
    profile: {
      bio: `Junior developer`,
      avatar: `https://example.com/bob.jpg`,
      preferences: {
        notifications: false,
        theme: `light`,
      },
    },
  },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
    address: {
      street: `456 Oak Ave`,
      city: `San Francisco`,
      country: `USA`,
      coordinates: {
        lat: 37.7749,
        lng: -122.4194,
      },
    },
  },
  { id: 4, name: `Dave`, age: 22, email: `dave@example.com`, active: true },
]

function createUsersCollection(autoIndex: `off` | `eager` = `eager`) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: sampleUsers,
      autoIndex,
    })
  )
}

function createBasicTests(autoIndex: `off` | `eager`) {
  describe(`with autoIndex ${autoIndex}`, () => {
    let usersCollection: ReturnType<typeof createUsersCollection>

    beforeEach(() => {
      usersCollection = createUsersCollection(autoIndex)
    })

    test(`should create, update and delete a live query collection with config`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            age: user.age,
            email: user.email,
            active: user.active,
          })),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(4)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Charlie`, `Dave`])
      )

      // Insert a new user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should create, update and delete a live query collection with query function`, async () => {
      const liveCollection = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).select(({ user }) => ({
          id: user.id,
          name: user.name,
          age: user.age,
          email: user.email,
          active: user.active,
        }))
      )

      await liveCollection.preload()

      const results = liveCollection.toArray

      expect(results).toHaveLength(4)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Charlie`, `Dave`])
      )

      // Insert a new user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toMatchObject(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should create, update and delete a live query collection with WHERE clause`, () => {
      const activeLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              active: user.active,
            })),
      })

      const results = activeLiveCollection.toArray

      expect(results).toHaveLength(3)
      expect(results.every((u) => u.active)).toBe(true)
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Dave`])
      )

      // Insert a new active user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(4) // Should include the new active user
      expect(activeLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve`,
        active: true,
      })

      // Update the new user to inactive (should remove from active collection)
      const inactiveUser = { ...newUser, active: false }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(3) // Should exclude the now inactive user
      expect(activeLiveCollection.get(5)).toBeUndefined()

      // Update the user back to active
      const reactivatedUser = {
        ...inactiveUser,
        active: true,
        name: `Eve Reactivated`,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: reactivatedUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(4) // Should include the reactivated user
      expect(activeLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve Reactivated`,
        active: true,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: reactivatedUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(3)
      expect(activeLiveCollection.get(5)).toBeUndefined()
    })

    test(`should create a live query collection with SELECT projection`, () => {
      const projectedLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              isAdult: user.age,
            })),
      })

      const results = projectedLiveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // Check that results only have the projected fields
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`isAdult`)
        expect(result).not.toHaveProperty(`email`)
        expect(result).not.toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )

      // Insert a new user over 20 (should be included)
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(4) // Should include the new user (age > 20)
      expect(projectedLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve`,
        isAdult: 28,
      })

      // Update the new user to be under 20 (should remove from collection)
      const youngUser = { ...newUser, age: 18 }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: youngUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(3) // Should exclude the now young user
      expect(projectedLiveCollection.get(5)).toBeUndefined()

      // Update the user back to over 20
      const adultUser = { ...youngUser, age: 35, name: `Eve Adult` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: adultUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(4) // Should include the user again
      expect(projectedLiveCollection.get(5)).toMatchObject({
        id: 5,
        name: `Eve Adult`,
        isAdult: 35,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: adultUser,
      })
      usersCollection.utils.commit()

      expect(projectedLiveCollection.size).toBe(3)
      expect(projectedLiveCollection.get(5)).toBeUndefined()
    })

    test(`should use custom getKey when provided`, () => {
      const customKeyCollection = createLiveQueryCollection({
        id: `custom-key-users`,
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            userId: user.id,
            userName: user.name,
          })),
        getKey: (item) => item.userId, // Custom key extraction
      })

      const results = customKeyCollection.toArray

      expect(results).toHaveLength(4)

      // Verify we can get items by their custom key
      expect(customKeyCollection.get(1)).toMatchObject({
        userId: 1,
        userName: `Alice`,
      })
      expect(customKeyCollection.get(2)).toMatchObject({
        userId: 2,
        userName: `Bob`,
      })

      // Insert a new user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(customKeyCollection.size).toBe(5)
      expect(customKeyCollection.get(5)).toMatchObject({
        userId: 5,
        userName: `Eve`,
      })

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(customKeyCollection.size).toBe(5)
      expect(customKeyCollection.get(5)).toMatchObject({
        userId: 5,
        userName: `Eve Updated`,
      })

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(customKeyCollection.size).toBe(4)
      expect(customKeyCollection.get(5)).toBeUndefined()
    })

    test(`should auto-generate unique IDs when not provided`, () => {
      const collection1 = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
          })),
      })

      const collection2 = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
            })),
      })

      // Verify that auto-generated IDs are unique and follow the expected pattern
      expect(collection1.id).toMatch(/^live-query-\d+$/)
      expect(collection2.id).toMatch(/^live-query-\d+$/)
      expect(collection1.id).not.toBe(collection2.id)

      // Verify collections work correctly
      const results1 = collection1.toArray

      const results2 = collection2.toArray

      expect(results1).toHaveLength(4) // All users
      expect(results2).toHaveLength(3) // Only active users
    })

    test(`should return original collection type when no select is provided`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) => q.from({ user: usersCollection }),
      })

      const results = liveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(4)
      expect(results[0]).toHaveProperty(`id`)
      expect(results[0]).toHaveProperty(`name`)
      expect(results[0]).toHaveProperty(`age`)
      expect(results[0]).toHaveProperty(`email`)
      expect(results[0]).toHaveProperty(`active`)

      // Verify the data matches exactly
      expect(results).toEqual(expect.arrayContaining(sampleUsers))

      // Insert a new user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toEqual(newUser)

      // Update the new user
      const updatedUser = { ...newUser, name: `Eve Updated` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(5)
      expect(liveCollection.get(5)).toEqual(updatedUser)

      // Delete the new user
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should return original collection type when no select is provided with WHERE clause`, () => {
      const activeLiveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.active, true)),
      })

      const results = activeLiveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(3)
      expect(results.every((u) => u.active)).toBe(true)

      // All properties should be present
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Bob`, `Dave`])
      )

      // Insert a new active user
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(4) // Should include the new active user
      expect(activeLiveCollection.get(5)).toEqual(newUser)

      // Update the new user to inactive (should remove from active collection)
      const inactiveUser = { ...newUser, active: false }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()

      expect(activeLiveCollection.size).toBe(3) // Should exclude the now inactive user
      expect(activeLiveCollection.get(5)).toBeUndefined()

      // Delete from original collection to clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: inactiveUser,
      })
      usersCollection.utils.commit()
    })

    test(`should return original collection type with query function syntax and no select`, async () => {
      const liveCollection = createLiveQueryCollection((q) =>
        q.from({ user: usersCollection }).where(({ user }) => gt(user.age, 20))
      )

      await liveCollection.preload()

      const results = liveCollection.toArray
      // Should return the original User type, not namespaced

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // All properties should be present
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
      })

      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )
    })

    test(`should support spread operator with computed fields in select`, () => {
      const liveCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.age, 20))
            .select(({ user }) => ({
              ...user,
              name_upper: upper(user.name),
            })),
      })

      const results = liveCollection.toArray

      expect(results).toHaveLength(3) // Alice (25), Charlie (30), Dave (22)

      // Check that all original properties are present
      results.forEach((result) => {
        expect(result).toHaveProperty(`id`)
        expect(result).toHaveProperty(`name`)
        expect(result).toHaveProperty(`age`)
        expect(result).toHaveProperty(`email`)
        expect(result).toHaveProperty(`active`)
        expect(result).toHaveProperty(`name_upper`)
      })

      // Verify that the computed field is correctly applied
      expect(results.map((u) => u.name_upper)).toEqual(
        expect.arrayContaining([`ALICE`, `CHARLIE`, `DAVE`])
      )

      // Verify original names are preserved
      expect(results.map((u) => u.name)).toEqual(
        expect.arrayContaining([`Alice`, `Charlie`, `Dave`])
      )

      // Test specific user data
      const alice = results.find((u) => u.name === `Alice`)
      expect(alice).toMatchObject({
        id: 1,
        name: `Alice`,
        age: 25,
        email: `alice@example.com`,
        active: true,
        name_upper: `ALICE`,
      })

      // Insert a new user and verify spread + computed field
      const newUser = {
        id: 5,
        name: `Eve`,
        age: 28,
        email: `eve@example.com`,
        active: true,
      }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `insert`,
        value: newUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(4)
      const eve = liveCollection.get(5)
      expect(eve).toMatchObject({
        ...newUser,
        name_upper: `EVE`,
      })

      // Update the user and verify the computed field is updated
      const updatedUser = { ...newUser, name: `Evelyn` }
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      const evelyn = liveCollection.get(5)
      expect(evelyn).toMatchObject({
        ...updatedUser,
        name_upper: `EVELYN`,
      })

      // Clean up
      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `delete`,
        value: updatedUser,
      })
      usersCollection.utils.commit()

      expect(liveCollection.size).toBe(3)
      expect(liveCollection.get(5)).toBeUndefined()
    })

    test(`should query nested object properties`, () => {
      const usersWithProfiles = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) =>
              eq(user.profile?.bio, `Software engineer with 5 years experience`)
            )
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              bio: user.profile?.bio,
            })),
      })

      expect(usersWithProfiles.size).toBe(1)
      expect(usersWithProfiles.get(1)).toMatchObject({
        id: 1,
        name: `Alice`,
        bio: `Software engineer with 5 years experience`,
      })

      // Query deeply nested properties
      const darkThemeUsers = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.profile?.preferences.theme, `dark`))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              theme: user.profile?.preferences.theme,
            })),
      })

      expect(darkThemeUsers.size).toBe(1)
      expect(darkThemeUsers.get(1)).toMatchObject({
        id: 1,
        name: `Alice`,
        theme: `dark`,
      })
    })

    test(`should select nested object properties`, () => {
      const nestedSelectCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            preferences: user.profile?.preferences,
            city: user.address?.city,
            coordinates: user.address?.coordinates,
          })),
      })

      const results = nestedSelectCollection.toArray
      expect(results).toHaveLength(4)

      // Check Alice has all nested properties
      const alice = results.find((u) => u.id === 1)
      expect(alice).toMatchObject({
        id: 1,
        name: `Alice`,
        preferences: {
          notifications: true,
          theme: `dark`,
        },
        city: `New York`,
        coordinates: {
          lat: 40.7128,
          lng: -74.006,
        },
      })

      // Check Bob has profile but no address
      const bob = results.find((u) => u.id === 2)
      expect(bob).toMatchObject({
        id: 2,
        name: `Bob`,
        preferences: {
          notifications: false,
          theme: `light`,
        },
      })
      expect(bob?.city).toBeUndefined()
      expect(bob?.coordinates).toBeUndefined()

      // Check Charlie has address but no profile
      const charlie = results.find((u) => u.id === 3)
      expect(charlie).toMatchObject({
        id: 3,
        name: `Charlie`,
        city: `San Francisco`,
        coordinates: {
          lat: 37.7749,
          lng: -122.4194,
        },
      })
      expect(charlie?.preferences).toBeUndefined()

      // Check Dave has neither
      const dave = results.find((u) => u.id === 4)
      expect(dave).toMatchObject({
        id: 4,
        name: `Dave`,
      })
      expect(dave?.preferences).toBeUndefined()
      expect(dave?.city).toBeUndefined()
    })

    test(`should handle updates to nested object properties`, () => {
      const profileCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            theme: user.profile?.preferences.theme,
            notifications: user.profile?.preferences.notifications,
          })),
      })

      expect(profileCollection.size).toBe(4) // All users, but some will have undefined values

      // Update Bob's theme
      const bob = sampleUsers.find((u) => u.id === 2)!
      const updatedBob = {
        ...bob,
        profile: {
          ...bob.profile!,
          preferences: {
            ...bob.profile!.preferences,
            theme: `dark` as const,
          },
        },
      }

      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: updatedBob,
      })
      usersCollection.utils.commit()

      expect(profileCollection.get(2)).toMatchObject({
        id: 2,
        name: `Bob`,
        theme: `dark`,
        notifications: false,
      })

      // Add profile to Dave
      const dave = sampleUsers.find((u) => u.id === 4)!
      const daveWithProfile = {
        ...dave,
        profile: {
          bio: `Full stack developer`,
          avatar: `https://example.com/dave.jpg`,
          preferences: {
            notifications: true,
            theme: `light` as const,
          },
        },
      }

      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: daveWithProfile,
      })
      usersCollection.utils.commit()

      expect(profileCollection.size).toBe(4) // All users
      expect(profileCollection.get(4)).toMatchObject({
        id: 4,
        name: `Dave`,
        theme: `light`,
        notifications: true,
      })

      // Remove profile from Bob
      const bobWithoutProfile = {
        ...updatedBob,
        profile: undefined,
      }

      usersCollection.utils.begin()
      usersCollection.utils.write({
        type: `update`,
        value: bobWithoutProfile,
      })
      usersCollection.utils.commit()

      expect(profileCollection.size).toBe(4) // All users still there, Bob will have undefined values
      expect(profileCollection.get(2)).toMatchObject({
        id: 2,
        name: `Bob`,
        theme: undefined,
        notifications: undefined,
      })
    })

    test(`should filter based on deeply nested properties`, () => {
      const nyUsers = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => eq(user.address?.city, `New York`))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              lat: user.address?.coordinates.lat,
              lng: user.address?.coordinates.lng,
            })),
      })

      expect(nyUsers.size).toBe(1)
      expect(nyUsers.get(1)).toMatchObject({
        id: 1,
        name: `Alice`,
        lat: 40.7128,
        lng: -74.006,
      })

      // Test with numeric comparison on nested property
      const northernUsers = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ user: usersCollection })
            .where(({ user }) => gt(user.address?.coordinates.lat, 38))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
              city: user.address?.city,
            })),
      })

      expect(northernUsers.size).toBe(1) // Only Alice (NY)
      expect(northernUsers.get(1)).toMatchObject({
        id: 1,
        name: `Alice`,
        city: `New York`,
      })
    })

    test(`should handle computed fields with nested properties`, () => {
      const computedCollection = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ user: usersCollection }).select(({ user }) => ({
            id: user.id,
            name: user.name,
            city: user.address?.city,
            country: user.address?.country,
            hasNotifications: user.profile?.preferences.notifications,
            profileSummary: concat(upper(user.name), ` - `, user.profile?.bio),
          })),
      })

      const results = computedCollection.toArray
      expect(results).toHaveLength(4)

      const alice = results.find((u) => u.id === 1)
      expect(alice).toMatchObject({
        id: 1,
        name: `Alice`,
        city: `New York`,
        country: `USA`,
        hasNotifications: true,
        profileSummary: `ALICE - Software engineer with 5 years experience`,
      })

      const dave = results.find((u) => u.id === 4)
      expect(dave).toMatchObject({
        id: 4,
        name: `Dave`,
      })
      expect(dave?.city).toBeUndefined()
      expect(dave?.country).toBeUndefined()
      expect(dave?.hasNotifications).toBeUndefined()
    })
  })
}

describe(`Query`, () => {
  describe(`basic`, () => {
    createBasicTests(`off`)
    createBasicTests(`eager`)
  })
})
