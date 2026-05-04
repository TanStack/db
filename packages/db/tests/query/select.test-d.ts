import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { upper } from '../../src/query/builder/functions.js'
import type { OutputWithVirtual } from '../utils.js'

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

type OutputWithVirtualKeyed<T extends object> = OutputWithVirtual<
  T,
  string | number
>

function createUsers() {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `nested-select-users-type`,
      getKey: (u) => u.id,
      initialData: [],
    }),
  )
}

describe(`select types`, () => {
  test(`works with functions`, () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        nameUpper: upper(u.name),
      })),
    )

    type Expected = {
      id: number
      nameUpper: string
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toMatchTypeOf<OutputWithVirtualKeyed<Expected>>()
  })

  test(`works with js built-ins objects`, () => {
    const users = createUsers()
    const col = createLiveQueryCollection((q) =>
      q.from({ u: users }).select(({ u }) => ({
        id: u.id,
        joinedDate: u.joinedDate,
        name: u.name,
        something: u.something,
      })),
    )

    type Expected = {
      id: number
      joinedDate: Date
      name: string
      something: string
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toMatchTypeOf<OutputWithVirtualKeyed<Expected>>()
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
      })),
    )

    type Expected = {
      id: number
      meta: {
        city: string | undefined
        coords: { lat: number; lng: number } | undefined
      }
    }

    const results = col.toArray[0]!

    expectTypeOf(results).toMatchTypeOf<OutputWithVirtualKeyed<Expected>>()
  })

  test(`select preserves union types and where works on common keys`, () => {
    type ItemDocument =
      | { type: 'pdf'; url: string; pages: number }
      | { type: 'image'; url: string; width: number; height: number }
      | { type: 'legacy'; path: string }

    type Item = { id: number; name: string; document: ItemDocument }

    const items = createCollection(
      mockSyncCollectionOptions<Item>({
        id: `union-field-items`,
        getKey: (i) => i.id,
        initialData: [],
      }),
    )

    // Filtering by a common key of the union should compile,
    // and the result should preserve the full discriminated union
    const col = createLiveQueryCollection((q) =>
      q
        .from({ i: items })
        .where(({ i }) => eq(i.document.type, `pdf`))
        .select(({ i }) => ({
          id: i.id,
          document: i.document,
        })),
    )

    const result = col.toArray[0]!
    expectTypeOf(result.document).toEqualTypeOf<ItemDocument>()
  })

  test(`select preserves union when collection type is a union`, () => {
    type DocV1 = { version: 1; title: string }
    type DocV2 = { version: 2; title: string; subtitle: string }
    type Doc = DocV1 | DocV2

    const docs = createCollection(
      mockSyncCollectionOptions<Doc>({
        id: `union-collection`,
        getKey: (d) => d.title,
        initialData: [],
      }),
    )

    // Without select — union preserved
    const col1 = createLiveQueryCollection((q) => q.from({ d: docs }))
    const r1 = col1.toArray[0]!
    expectTypeOf(r1).toMatchTypeOf<Doc>()

    // With select on individual fields — per-field unions (not top-level union)
    const col2 = createLiveQueryCollection((q) =>
      q.from({ d: docs }).select(({ d }) => ({
        version: d.version,
        title: d.title,
      })),
    )
    const r2 = col2.toArray[0]!
    expectTypeOf(r2).toMatchTypeOf<{ version: 1 | 2; title: string }>()
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

    expectTypeOf(results).toMatchTypeOf<OutputWithVirtualKeyed<Expected>>()
  })
})
