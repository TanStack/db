import { describe, expect, it, vi } from 'vitest'

import { renderHook } from '@testing-library/react'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type * as ReactNS from 'react'

// Intercept React.useSyncExternalStore so we can capture the `subscribe`
// callback that `useLiveQuery` registers and assert that it does not invoke
// `onStoreChange` synchronously when the collection is already ready.
let capturedSubscribe: ((cb: () => void) => () => void) | null = null

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactNS>('react')
  return {
    ...actual,
    default: (actual as any).default ?? actual,
    useSyncExternalStore: (subscribe: any, getSnapshot: any) => {
      capturedSubscribe = subscribe
      return getSnapshot()
    },
  }
})

type Person = { id: string; name: string; age: number }

const initialPersons: Array<Person> = [
  { id: `1`, name: `A`, age: 10 },
  { id: `2`, name: `B`, age: 20 },
]

describe(`useLiveQuery: eager onStoreChange must not fire synchronously during subscribe`, () => {
  it(`defers the initial ready-state onStoreChange to a microtask`, async () => {
    const base = createCollection(
      mockSyncCollectionOptions<Person>({
        id: `eager-onstorechange-persons`,
        getKey: (p) => p.id,
        initialData: initialPersons,
      }),
    )

    const lqc = createLiveQueryCollection({
      startSync: true,
      query: (q) => q.from({ persons: base }),
    })
    await lqc.preload()
    expect(lqc.status).toBe(`ready`)

    capturedSubscribe = null
    renderHook(() => useLiveQuery(lqc))
    expect(capturedSubscribe).toBeTypeOf(`function`)

    const onStoreChange = vi.fn()
    const unsub = capturedSubscribe!(onStoreChange)

    // onStoreChange must not be invoked synchronously inside subscribe —
    // useSyncExternalStore's own post-subscribe getSnapshot re-read covers a
    // ready transition that happened between render and subscribe, so an
    // already-ready unchanged collection needs no wake-up at all.
    expect(onStoreChange).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(onStoreChange).not.toHaveBeenCalled()

    // A real delta does wake the store.
    base.utils.begin()
    base.utils.write({
      type: `insert`,
      value: { id: `3`, name: `C`, age: 30 },
    })
    base.utils.commit()
    await Promise.resolve()
    expect(onStoreChange).toHaveBeenCalled()

    unsub()
  })
})
