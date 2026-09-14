// Runs the real TransactionScope and refreshAfterMutation implementations.
// The collection notification target is a stub: this is not a UI/runtime test.
import assert from 'node:assert/strict'
import { TransactionScope } from '../../../../../../packages/db/src/transactions.ts'
import { refreshAfterMutation } from '../../../../integrated-todo/src/refresh.server.ts'

const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const events = []
const scope = new TransactionScope()
const firstGate = deferred()
const secondGate = deferred()
const collection = {
  id: 'todos',
  _state: {
    pendingSyncedTransactions: [],
    onTransactionStateChange() {
      events.push({ notification: true, first: first.state,
        manual: manual.state, second: second.state })
    },
  },
}
const first = scope.createTransaction({ autoCommit: false, mutationFn: async () => {
  await firstGate.promise
  events.push({ authority: 'partial commit installed' })
  throw Error('handler failed after commit')
} })
const manual = scope.createTransaction({ autoCommit: false, mutationFn: async () => {} })
const second = scope.createTransaction({ autoCommit: false, mutationFn: () => secondGate.promise })
for (const transaction of [first, manual, second]) {
  transaction.applyMutations([{ globalKey: 'todos/1', key: '1', collection }])
  void transaction.isPersisted.promise.catch(() => {})
}
const firstDone = first.commit().catch(() => {})
const secondDone = second.commit()
events.push({ before: true, first: first.state, manual: manual.state, second: second.state })
firstGate.resolve()
await firstDone
assert.equal(first.state, 'failed')
assert.equal(manual.state, 'failed')
assert.equal(second.state, 'persisting')
events.push({ afterFailure: true, first: first.state, manual: manual.state, second: second.state })
secondGate.resolve()
await secondDone
scope.clear()

const readGate = deferred()
let serverWriteClosed = false
let envelopeDelivered = false
const response = refreshAfterMutation([{ id: 'todos' }], {
  todos: async () => { await readGate.promise; return [{ id: '1' }] },
}, async () => { serverWriteClosed = true; return 'ok' })
response.then(() => { envelopeDelivered = true })
await Promise.resolve()
await Promise.resolve()
assert.equal(serverWriteClosed, true)
assert.equal(envelopeDelivered, false)
events.push({ heldRead: { serverWriteClosed, envelopeDelivered } })
readGate.resolve()
const envelope = await response
assert.equal(envelope.handler.kind, 'success')
events.push({ afterRead: { envelopeDelivered, handler: envelope.handler.kind } })
console.log(JSON.stringify({ evidence: 'actual source, stub collection; no Endpoints/UI protocol implementation', events }, null, 2))
