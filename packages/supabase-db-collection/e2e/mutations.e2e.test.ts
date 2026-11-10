import { expect, vi } from 'vitest'
import { keyColumnsToSearch } from '../src/postgrest-filters'
import { postgrestRequest } from '../src/postgrest-request'
import { WAIT, test } from './e2e.utils'

test('update and delete filters preserve timestamp key milliseconds', async ({
  other,
}) => {
  const timestamp = new Date('2024-01-01T12:30:00.123Z')
  const neighbor = '2024-01-01T12:30:00.456Z'
  const { error: insertError } = await other.from('timestamp_keys').insert([
    { recorded_at: timestamp.toISOString(), label: 'target' },
    { recorded_at: neighbor, label: 'neighbor' },
  ])
  expect(insertError).toBeNull()

  await postgrestRequest(other, 'timestamp_keys', {
    method: 'PATCH',
    search: keyColumnsToSearch(['recorded_at'], { recorded_at: timestamp }),
    body: { label: 'updated' },
  })
  const { data: updated, error: updateError } = await other
    .from('timestamp_keys')
    .select('label')
    .order('recorded_at')
  expect(updateError).toBeNull()
  expect(updated).toEqual([{ label: 'updated' }, { label: 'neighbor' }])

  await postgrestRequest(other, 'timestamp_keys', {
    method: 'DELETE',
    search: keyColumnsToSearch(['recorded_at'], { recorded_at: timestamp }),
  })
  const { data: remaining, error: deleteError } = await other
    .from('timestamp_keys')
    .select('label')
  expect(deleteError).toBeNull()
  expect(remaining).toEqual([{ label: 'neighbor' }])
})

test('inserts a row through PostgREST and reflects the server row', async ({
  users,
  usersLive,
}) => {
  const tx = users.collection.insert({
    id: 100,
    name: 'Carol',
    email: 'carol@test.com',
    active: true,
  })
  await tx.when('settled')

  await vi.waitFor(
    () =>
      expect(usersLive.toArray.some((user) => user.name === 'Carol')).toBe(
        true,
      ),
    WAIT,
  )
  expect(usersLive.toArray.find((user) => user.name === 'Carol')?.id).toBe(100)

  // The row really exists in the database.
  const { data, error } = await users.supabase
    .from('users')
    .select('*')
    .eq('email', 'carol@test.com')
    .single()
  expect(error).toBeNull()
  expect(data?.name).toBe('Carol')
})

test('updates a row through PostgREST and reflects the server row', async ({
  users,
  usersLive,
}) => {
  const alice = usersLive.toArray.find((user) => user.name === 'Alice')

  const tx = users.collection.update(String(alice?.id), (draft) => {
    draft.name = 'Alice Updated'
  })
  await tx.when('settled')

  await vi.waitFor(
    () =>
      expect(
        usersLive.toArray.find((user) => user.id === alice?.id)?.name,
      ).toBe('Alice Updated'),
    WAIT,
  )

  const { data, error } = await users.supabase
    .from('users')
    .select('*')
    .eq('id', alice?.id)
    .single()
  expect(error).toBeNull()
  expect(data?.name).toBe('Alice Updated')
})

test('deletes a row through PostgREST', async ({ users, usersLive }) => {
  const bob = usersLive.toArray.find((user) => user.name === 'Bob')

  const tx = users.collection.delete(String(bob?.id))
  await tx.when('settled')

  await vi.waitFor(
    () =>
      expect(usersLive.toArray.some((user) => user.id === bob?.id)).toBe(false),
    WAIT,
  )

  const { data } = await users.supabase
    .from('users')
    .select('*')
    .eq('id', bob?.id)
  expect(data).toEqual([])
})
