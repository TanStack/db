import { expect, vi } from 'vitest'
import { WAIT, test } from './e2e.utils'

// The rtUsersLive fixture guarantees the realtime channel is joined before the
// test body runs, so writes from the `other` client always arrive as events.

test('receives realtime inserts made by another client', async ({
  rtUsersLive,
  other,
}) => {
  const draft = { id: 200, name: 'Zoe', email: 'zoe@test.com', active: true }
  const { error } = await other.from('users').insert(draft as unknown as never)
  expect(error).toBeNull()

  await vi.waitFor(
    () =>
      expect(rtUsersLive.toArray.some((user) => user.name === 'Zoe')).toBe(
        true,
      ),
    WAIT,
  )
})

test('receives realtime updates made by another client', async ({
  rtUsersLive,
  other,
}) => {
  const alice = rtUsersLive.toArray.find((user) => user.name === 'Alice')

  const { error } = await other
    .from('users')
    .update({ name: 'Alice Realtime' })
    .eq('id', alice?.id)
  expect(error).toBeNull()

  await vi.waitFor(
    () =>
      expect(
        rtUsersLive.toArray.find((user) => user.id === alice?.id)?.name,
      ).toBe('Alice Realtime'),
    WAIT,
  )
})

// Exercises the delete path, where the adapter derives the collection key from
// the realtime payload's `old`. That works here because the collection key is
// the primary key, which the default replica identity always includes.
test('receives realtime deletes made by another client', async ({
  rtUsersLive,
  other,
}) => {
  const bob = rtUsersLive.toArray.find((user) => user.name === 'Bob')

  const { error } = await other.from('users').delete().eq('id', bob?.id)
  expect(error).toBeNull()

  await vi.waitFor(
    () =>
      expect(rtUsersLive.toArray.some((user) => user.id === bob?.id)).toBe(
        false,
      ),
    WAIT,
  )
})
