import { DiffTriggerOperation } from '@powersync/common'
import { expect, it } from 'vitest'
import { PendingOperationStore } from '../src/PendingOperationStore'

const operation = {
  tableName: `rows`,
  operation: DiffTriggerOperation.INSERT,
  id: `row`,
  timestamp: `one`,
}

it(`confirms a signal-less waiter through a native observing run`, async () => {
  const store = new PendingOperationStore()
  const pending = store.waitFor(operation)
  store.resolvePendingFor([operation], new AbortController().signal)
  await expect(pending).resolves.toBeUndefined()
})

it(`returns a rejected promise for an already stopped run`, async () => {
  const store = new PendingOperationStore()
  const run = new AbortController()
  const failure = new Error(`run stopped`)
  run.abort(failure)
  await expect(store.waitFor(operation, run.signal)).rejects.toBe(failure)
})
