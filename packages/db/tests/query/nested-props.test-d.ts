import { describe, expectTypeOf, test } from 'vitest'
import {
  and,
  createLiveQueryCollection,
  eq,
  gt,
  or,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { OutputWithVirtual } from '../utils.js'

// Complex nested type for testing with optional properties
type Person = {
  id: string
  name: string
  age: number
  email: string
  isActive: boolean
  team: string
  profile?: {
    bio: string
    score: number
    stats: {
      tasksCompleted: number
      rating: number
    }
  }
  address?: {
    city: string
    country: string
    coordinates: {
      lat: number
      lng: number
    }
  }
}

// Sample data
const samplePersons: Array<Person> = [
  {
    id: `1`,
    name: `John Doe`,
    age: 30,
    email: `john.doe@example.com`,
    isActive: true,
    team: `team1`,
    profile: {
      bio: `Senior developer`,
      score: 85,
      stats: {
        tasksCompleted: 120,
        rating: 4.5,
      },
    },
    address: {
      city: `New York`,
      country: `USA`,
      coordinates: {
        lat: 40.7128,
        lng: -74.006,
      },
    },
  },
]

function createPersonsCollection() {
  return createCollection(
    mockSyncCollectionOptions<Person>({
      id: `test-persons`,
      getKey: (person) => person.id,
      initialData: samplePersons,
    }),
  )
}

describe(`Nested Properties Types`, () => {
  const personsCollection = createPersonsCollection()

  test(`select with nested properties returns correct types`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q.from({ persons: personsCollection }).select(({ persons }) => ({
          id: persons.id,
          name: persons.name,
          // Level 1 nesting
          bio: persons.profile?.bio,
          score: persons.profile?.score,
          // Level 2 nesting
          tasksCompleted: persons.profile?.stats.tasksCompleted,
          rating: persons.profile?.stats.rating,
          // Address nesting
          city: persons.address?.city,
          country: persons.address?.country,
          // Coordinates (level 2 nesting under address)
          lat: persons.address?.coordinates.lat,
          lng: persons.address?.coordinates.lng,
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
          bio: string | undefined // Now optional because profile is optional
          score: number | undefined // Now optional because profile is optional
          tasksCompleted: number | undefined // Now optional because profile?.stats is optional
          rating: number | undefined // Now optional because profile?.stats is optional
          city: string | undefined // Now optional because address is optional
          country: string | undefined // Now optional because address is optional
          lat: number | undefined // Now optional because address?.coordinates is optional
          lng: number | undefined // Now optional because address?.coordinates is optional
        }>
      >
    >()
  })

  test(`where clause with nested properties`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: personsCollection })
          // Test various nested property comparisons
          .where(({ persons }) => gt(persons.profile?.score, 80))
          .where(({ persons }) => eq(persons.address?.country, `USA`))
          .where(({ persons }) => gt(persons.address?.coordinates.lat, 35))
          .where(({ persons }) => gt(persons.profile?.stats.rating, 4.0))
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
        }>
      >
    >()
  })

  test(`where clause with complex nested expressions`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: personsCollection })
          .where(({ persons }) =>
            or(
              gt(persons.profile?.score, 90),
              and(
                gt(persons.profile?.stats.tasksCompleted, 100),
                gt(persons.profile?.stats.rating, 4.5),
              ),
            ),
          )
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            score: persons.profile?.score,
          })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
          score: number | undefined // Optional because profile is optional
        }>
      >
    >()
  })

  test(`orderBy with nested properties`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: personsCollection })
          .orderBy(({ persons }) => persons.profile?.score, `desc`)
          .orderBy(({ persons }) => persons.address?.coordinates.lat, `asc`)
          .orderBy(({ persons }) => persons.profile?.stats.rating, `desc`)
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            score: persons.profile?.score,
            lat: persons.address?.coordinates.lat,
            rating: persons.profile?.stats.rating,
          })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
          score: number | undefined // Optional because profile is optional
          lat: number | undefined // Optional because address?.coordinates is optional
          rating: number | undefined // Optional because profile?.stats is optional
        }>
      >
    >()
  })

  test(`orderBy with multiple nested properties and options`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: personsCollection })
          .orderBy(({ persons }) => persons.profile?.score, {
            direction: `desc`,
            nulls: `last`,
          })
          .orderBy(({ persons }) => persons.address?.city, {
            direction: `asc`,
            nulls: `first`,
            stringSort: `locale`,
          })
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
          })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
        }>
      >
    >()
  })

  test(`deeply nested property access in all methods`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ persons: personsCollection })
          // WHERE with deeply nested
          .where(({ persons }) => gt(persons.profile?.stats.tasksCompleted, 50))
          // ORDER BY with deeply nested
          .orderBy(({ persons }) => persons.profile?.stats.rating, `desc`)
          .orderBy(({ persons }) => persons.address?.coordinates.lng, `asc`)
          // SELECT with deeply nested
          .select(({ persons }) => ({
            id: persons.id,
            name: persons.name,
            // Level 1
            team: persons.team,
            // Level 2 under profile
            bio: persons.profile?.bio,
            score: persons.profile?.score,
            // Level 3 under profile?.stats
            tasksCompleted: persons.profile?.stats.tasksCompleted,
            rating: persons.profile?.stats.rating,
            // Level 2 under address
            city: persons.address?.city,
            country: persons.address?.country,
            // Level 3 under address?.coordinates
            lat: persons.address?.coordinates.lat,
            lng: persons.address?.coordinates.lng,
          })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          name: string
          team: string
          bio: string | undefined
          score: number | undefined
          tasksCompleted: number | undefined
          rating: number | undefined
          city: string | undefined
          country: string | undefined
          lat: number | undefined
          lng: number | undefined
        }>
      >
    >()
  })

  test(`direct nested object access`, () => {
    const collection = createLiveQueryCollection({
      query: (q) =>
        q.from({ persons: personsCollection }).select(({ persons }) => ({
          // These should be properly typed without optionality issues
          profileExists: persons.profile,
          addressExists: persons.address,
          // Direct access works fine with required properties
          score: persons.profile?.score,
          coordinates: persons.address?.coordinates,
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          profileExists:
            | {
                bio: string
                score: number
                stats: {
                  tasksCompleted: number
                  rating: number
                }
              }
            | undefined
          addressExists:
            | {
                city: string
                country: string
                coordinates: {
                  lat: number
                  lng: number
                }
              }
            | undefined
          score: number | undefined
          coordinates:
            | {
                lat: number
                lng: number
              }
            | undefined
        }>
      >
    >()
  })

  test(`nested properties work at runtime with correct types`, () => {
    // Test that nested properties work correctly at runtime
    const collection = createLiveQueryCollection({
      query: (q) =>
        q.from({ persons: personsCollection }).select(({ persons }) => ({
          id: persons.id,
          profileScore: persons.profile?.score,
          coordinatesLat: persons.address?.coordinates.lat,
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toMatchTypeOf<
      Array<
        OutputWithVirtual<{
          id: string
          profileScore: number | undefined
          coordinatesLat: number | undefined
        }>
      >
    >()
  })
})
