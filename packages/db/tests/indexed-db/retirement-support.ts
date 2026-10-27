// Shared by retirement-oracle.test.ts and retirement.test.ts: the authored
// initial rows, the operation and reason grammar, and the observers that record
// admitted and closed Collections. The model that folds these operations is
// apply in retirement-oracle.test.ts.
import { expect } from 'vitest'
import { deleteDatabase } from '../../src'
import { deferred, request } from './harness'
import type { Row, withHarness } from './harness'

export type Harness = Parameters<Parameters<typeof withHarness>[0]>[0]
export type Subject = ReturnType<Harness['make']>
export type Kind = 'insert' | 'update' | 'delete' | 'clear' | 'import'
export type Reason = 'explicit' | 'upgrade' | 'delete'
export const kinds: Array<Kind> = [
  'insert',
  'update',
  'delete',
  'clear',
  'import',
]
export const reasons: Array<Reason> = ['explicit', 'upgrade', 'delete']
export const initial: Array<Row> = [
  { id: 1, name: 'one' },
  { id: 2, name: 'two' },
  { id: 'anchor', name: 'anchor' },
]

export function observe(
  promise: Promise<unknown>,
  capture: () => Array<Row> = () => [],
) {
  let atSettlement: Array<Row> | undefined
  const result: {
    state: 'pending' | 'fulfilled' | 'rejected'
    reason?: unknown
  } = { state: 'pending' }
  const done = promise.then(
    () => {
      atSettlement = capture()
      result.state = 'fulfilled'
    },
    (reason: unknown) => {
      atSettlement = capture()
      result.state = 'rejected'
      result.reason = reason
    },
  )
  return { result, done, snapshot: () => atSettlement }
}
export function start(c: Subject, kind: Kind, owner: number): Promise<unknown> {
  if (kind === 'clear') return c.utils.clearObjectStore()
  if (kind === 'import')
    return c.utils.importData([{ id: owner, name: `after-${owner}` }])
  if (kind === 'insert')
    return c.insert({ id: `new-${owner}`, name: `after-${owner}` }).isPersisted
      .promise
  if (kind === 'delete') return c.delete(owner).isPersisted.promise
  return c.update(owner, (row) => {
    row.name = `after-${owner}`
  }).isPersisted.promise
}
export function recordStatus(c: Subject) {
  const statuses: Array<string> = []
  c.on('status:change', ({ status }) => {
    statuses.push(status)
  })
  return statuses
}
export function closed(c: Subject, statuses: Array<string>) {
  expect.soft(c.status, 'closed connection status').toBe('error')
  const firstError = statuses.indexOf('error')
  expect.soft(firstError, 'retirement is observable').toBeGreaterThanOrEqual(0)
  expect
    .soft(
      statuses.slice(firstError).every((status) => status === 'error'),
      'retired status stays error',
    )
    .toBe(true)
}

// An unmanaged connection permits independent durable reads while a native
// upgrade/delete is blocked. Administrative success owns no Collection writes.
export async function close(h: Harness, reason: Reason) {
  const inspector = await request(indexedDB.open(h.db.name, 1))
  let administrative: Promise<unknown> = Promise.resolve()
  h.disposers.push(async () => {
    inspector.close()
    await administrative
  })
  if (reason === 'explicit') h.db.close()
  else {
    const announced = deferred()
    h.db.db.addEventListener('versionchange', () => announced.resolve(), {
      once: true,
    })
    administrative =
      reason === 'delete'
        ? deleteDatabase(h.db.name)
        : request(indexedDB.open(h.db.name, 2)).then((db) => db.close())
    await announced.promise
  }
  return { ...h.db, db: inspector }
}
