import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { createCollection, eq } from '@tanstack/db'
import { useLiveQueryEffect } from '../src/useLiveQueryEffect'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import type { DeltaEvent } from '@tanstack/db'

type User = {
  id: number
  name: string
  active: boolean
}

const initialUsers: Array<User> = [
  { id: 1, name: `Alice`, active: true },
  { id: 2, name: `Bob`, active: true },
]

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

function createUsersCollection(initialData = initialUsers) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users-hook`,
      getKey: (user) => user.id,
      initialData,
    }),
  )
}

describe(`useLiveQueryEffect`, () => {
  it(`should create effect on mount and dispose on unmount`, async () => {
    const users = createUsersCollection()
    const events: Array<DeltaEvent<User, number>> = []

    const { unmount } = renderHook(() => {
      useLiveQueryEffect<User, number>(
        {
          query: (q) => q.from({ user: users }),
          on: `enter`,
          handler: (event) => {
            events.push(event)
          },
        },
        [],
      )
    })

    await act(async () => {
      await flushPromises()
    })

    // Should have received enter events for initial data
    expect(events.length).toBe(2)

    const countBefore = events.length

    // Unmount — should dispose the effect
    unmount()

    // Insert after unmount
    users.utils.begin()
    users.utils.write({
      type: `insert`,
      value: { id: 3, name: `Charlie`, active: true },
    })
    users.utils.commit()

    await act(async () => {
      await flushPromises()
    })

    // Should not have received new events after unmount
    expect(events.length).toBe(countBefore)
  })

  it(`should recreate effect when deps change`, async () => {
    const users = createUsersCollection()
    const effectIds: Array<string> = []

    const { rerender } = renderHook(
      ({ dep }: { dep: number }) => {
        useLiveQueryEffect<User, number>(
          {
            query: (q) => q.from({ user: users }),
            on: `enter`,
            handler: (_event, ctx) => {
              if (!effectIds.includes(ctx.effectId)) {
                effectIds.push(ctx.effectId)
              }
            },
          },
          [dep],
        )
      },
      { initialProps: { dep: 1 } },
    )

    await act(async () => {
      await flushPromises()
    })

    expect(effectIds.length).toBe(1)
    const firstId = effectIds[0]

    // Change deps — should dispose old effect and create new one
    rerender({ dep: 2 })

    await act(async () => {
      await flushPromises()
    })

    expect(effectIds.length).toBe(2)
    expect(effectIds[1]).not.toBe(firstId)
  })

  it(`should receive events from source collection changes`, async () => {
    const users = createUsersCollection()
    const events: Array<DeltaEvent<User, number>> = []

    renderHook(() => {
      useLiveQueryEffect<User, number>(
        {
          query: (q) =>
            q.from({ user: users }).where(({ user }) => eq(user.active, true)),
          on: `delta`,
          skipInitial: true,
          handler: (event) => {
            events.push(event)
          },
        },
        [],
      )
    })

    await act(async () => {
      await flushPromises()
    })

    // skipInitial — no initial events
    expect(events.length).toBe(0)

    // Insert a new active user
    await act(async () => {
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 3, name: `Charlie`, active: true },
      })
      users.utils.commit()
      await flushPromises()
    })

    expect(events.length).toBe(1)
    expect(events[0]!.type).toBe(`enter`)
    expect(events[0]!.value.name).toBe(`Charlie`)

    // Delete a user
    await act(async () => {
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 1, name: `Alice`, active: true },
      })
      users.utils.commit()
      await flushPromises()
    })

    expect(events.length).toBe(2)
    expect(events[1]!.type).toBe(`exit`)
    expect(events[1]!.value.name).toBe(`Alice`)
  })
})
