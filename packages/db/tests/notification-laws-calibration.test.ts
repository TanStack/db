// Ordinary tests moved out of notification-laws-oracle.test.ts. Each one feeds
// the shared notification-history checker a hand-built publication mutant and
// requires it to reject the mutant; none runs production.
import { expect, it } from 'vitest'
import { expectNotificationHistory } from '../../db-collection-e2e/src/utils/notification-laws-oracle'
import type { Notification } from '../../db-collection-e2e/src/utils/notification-laws-oracle'

type Row = { id: string; count: number }

it.each([
  'duplicate',
  'spurious-delete',
  'wrong-key',
  'wrong-payload',
  'missing-event',
  'absent-update',
  'absent-delete',
  'unknown-type',
])(`rejects the %s publication mutant`, (fault) => {
  const peer = { id: 'peer', count: 2 }
  const row = { id: 'owned', count: 1 }
  const insert = { type: 'insert', key: row.id, value: row }
  const healthy: Array<Notification<Row>> = [
    { events: [], rows: [peer] },
    { events: [insert], rows: [peer, row] },
  ]
  expectNotificationHistory([peer], healthy, [peer, row])
  const callbacks = structuredClone(healthy)
  const batch = callbacks[1]!
  if (fault === 'duplicate') callbacks.push(structuredClone(batch))
  if (fault === 'spurious-delete')
    batch.events.push({ ...insert, type: 'delete' })
  if (fault === 'wrong-key') batch.events[0]!.key = 'wrong'
  if (fault === 'wrong-payload') batch.events[0]!.value.count++
  if (fault === 'missing-event') batch.events = []
  if (fault === 'absent-update') batch.events[0]!.type = 'update'
  if (fault === 'absent-delete') batch.events[0]!.type = 'delete'
  if (fault === 'unknown-type') batch.events[0]!.type = 'upsert'
  expect(() =>
    expectNotificationHistory([peer], callbacks, [peer, row]),
  ).toThrow()
})
