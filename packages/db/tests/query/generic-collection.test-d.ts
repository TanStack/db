import { describe, test } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import type { Collection } from '../../src/collection/index.js'

// Regression tests for https://github.com/TanStack/db/issues/1677
// Queries over a Collection<T> where T is an unresolved generic type parameter
// must still expose the properties guaranteed by T's constraint inside
// where/join/select callbacks. This worked in 0.6.5 and broke in 0.6.6.

describe(`queries over generic collection row types`, () => {
  test(`where callback can access properties guaranteed by the type constraint`, () => {
    function findById<T extends { id: string }>(
      items: Collection<T, string>,
      id: string,
    ) {
      return createLiveQueryCollection((q) =>
        q.from({ items }).where(({ items: itemsRef }) => eq(itemsRef.id, id)),
      )
    }

    void findById
  })

  test(`select callback can access properties guaranteed by the type constraint`, () => {
    function selectIds<T extends { id: string }>(items: Collection<T, string>) {
      return createLiveQueryCollection((q) =>
        q.from({ items }).select(({ items: itemsRef }) => ({
          id: itemsRef.id,
        })),
      )
    }

    void selectIds
  })

  test(`subquery over a generic collection can be used as a join source`, () => {
    function withDiff<T extends { id: string }>(
      a: Collection<T, string>,
      b: Collection<{ id: string }, string>,
    ) {
      return createLiveQueryCollection((q) => {
        const sub = q.from({ a })
        return q
          .from({ b })
          .leftJoin({ sub }, ({ b: bRef, sub: subRef }) =>
            eq(bRef.id, subRef.id),
          )
      })
    }

    void withDiff
  })
})
