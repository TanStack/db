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

  test(`select preserves union when nested under another field`, () => {
    type Payload =
      | { kind: 'text'; body: string }
      | { kind: 'binary'; bytes: number; mime: string }

    type Envelope = { id: number; payload: { inner: Payload } }

    const envelopes = createCollection(
      mockSyncCollectionOptions<Envelope>({
        id: `nested-union-envelopes`,
        getKey: (e) => e.id,
        initialData: [],
      }),
    )

    // Selecting a nested object whose field is a discriminated union
    // must preserve the union (not collapse to the intersection of keys).
    const col = createLiveQueryCollection((q) =>
      q.from({ e: envelopes }).select(({ e }) => ({
        id: e.id,
        payload: e.payload,
      })),
    )
    const r = col.toArray[0]!
    expectTypeOf(r.payload).toEqualTypeOf<{ inner: Payload }>()
    expectTypeOf(r.payload.inner).toEqualTypeOf<Payload>()
  })

  test(`spread with a same-key narrower override projects the override type`, () => {
    type SpreadUser = {
      id: number
      code: string | number
      slug: string
      nickname?: string
    }

    const spreadUsers = createCollection(
      mockSyncCollectionOptions<SpreadUser>({
        id: `spread-override-users`,
        getKey: (u) => u.id,
        initialData: [],
      }),
    )

    const col = createLiveQueryCollection((q) =>
      q.from({ u: spreadUsers }).select(({ u }) => ({
        narrowed: { ...u, code: u.slug },
      })),
    )

    const result = col.toArray[0]!
    // `code` was overridden with `u.slug` (string), so the projected
    // field must be `string`, not the original `string | number`.
    expectTypeOf(result.narrowed.code).toEqualTypeOf<string>()
  })

  test(`spread that omits an optional property drops the key`, () => {
    type SpreadUser = {
      id: number
      code: string | number
      slug: string
      nickname?: string
    }

    const spreadUsers = createCollection(
      mockSyncCollectionOptions<SpreadUser>({
        id: `spread-omit-users`,
        getKey: (u) => u.id,
        initialData: [],
      }),
    )

    const col = createLiveQueryCollection((q) =>
      q.from({ u: spreadUsers }).select(({ u }) => {
        const { nickname: _nickname, ...withoutNickname } = u
        return { trimmed: withoutNickname }
      }),
    )

    const _result = col.toArray[0]!
    // `nickname` was destructured out, so the projected object must
    // not reintroduce the key.
    type HasNickname = `nickname` extends keyof typeof _result.trimmed
      ? true
      : false
    expectTypeOf<HasNickname>().toEqualTypeOf<false>()
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
