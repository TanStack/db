import { describe, expect, it } from 'vitest'
import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createCollection } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Person = { id: string; name: string }

describe(`useLiveQuery under StrictMode`, () => {
  it(`keeps the subscription alive across StrictMode effect replay`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `strictmode-persons`,
        getKey: (p) => p.id,
        initialData: [{ id: `1`, name: `A` }],
      }),
    )

    // StrictMode double-invokes effects (mount → cleanup → mount). A dispose in
    // the unmount effect would tear the observer down and never recreate it,
    // leaving a dead subscription.
    const { result } = renderHook(
      () =>
        useLiveQuery((q) =>
          q
            .from({ p: collection })
            .select(({ p }) => ({ id: p.id, name: p.name })),
        ),
      { wrapper: StrictMode },
    )

    await waitFor(() => expect(result.current.data).toHaveLength(1))

    // A mutation after the StrictMode replay must still reach the hook.
    act(() => {
      collection.utils.begin()
      collection.utils.write({ type: `insert`, value: { id: `2`, name: `B` } })
      collection.utils.commit()
    })

    await waitFor(() => expect(result.current.data).toHaveLength(2))
  })
})
