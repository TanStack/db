import assert from 'node:assert/strict'
import { DbClient, collectionOptions } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'
import { withPublicationContext } from '../../../../packages/db/src/scheduler'

const db = new DbClient()
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const make = (id: string) => db.collection(collectionOptions(queryCollectionOptions({
  id, queryKey: [id], queryClient, queryFn: async () => [{ id: 'row', value: 0 }],
  getKey: (row: { id: string; value: number }) => row.id, staleTime: Infinity,
})))
const a = make('hostile-a'), b = make('hostile-b')
await Promise.all([a.preload(), b.preload()])
const pair = () => [a.get('row')!.value, b.get('row')!.value]
const events: unknown[] = []
let reentered = false
const subscriptions = [
  a.subscribeChanges(() => {
    if (reentered) return
    reentered = true
    const handles = [a, b].map(c => c._deferPublication())
    const tx = db.createTransaction({ mutationFn: () => new Promise(() => {}) })
    tx.mutate(() => {
      a.update('row', draft => { draft.value = 2 })
      b.update('row', draft => { draft.value = 2 })
    })
    handles.forEach(h => h.publish())
  }, { includeInitialState: false }),
  ...[a, b].map((c, index) => c.subscribeChanges(changes => {
    const payloads = changes.map(change => change.value.value)
    events.push({ collection: index === 0 ? 'a' : 'b', payloads, direct: pair() })
  }, { includeInitialState: false })),
]
withPublicationContext(() => {
  const handles = [a, b].map(c => c._deferPublication())
  a.utils.writeUpsert({ id: 'row', value: 1 })
  b.utils.writeUpsert({ id: 'row', value: 1 })
  handles.forEach(h => h.publish())
})
assert.ok(events.some(event => {
  const e = event as { payloads: number[]; direct: number[] }
  return e.payloads.includes(1) && e.direct.every(value => value === 2)
}))
subscriptions.forEach(s => s.unsubscribe())
const rollbackEvents: number[][] = []
const rollbackSubscriptions = [a,b].map(c => c.subscribeChanges(() => rollbackEvents.push(pair()), { includeInitialState: false }))
const rollbackTx = db.createTransaction({ mutationFn: () => new Promise(() => {}) })
withPublicationContext(() => {
  const handles = [a,b].map(c => c._deferPublication())
  rollbackTx.mutate(() => {
    a.update('row', draft => { draft.value = 3 })
    b.update('row', draft => { draft.value = 3 })
  })
  handles.forEach(h => h.publish())
})
rollbackEvents.length = 0
rollbackTx.rollback()
assert.ok(rollbackEvents.some(values => values[0] !== values[1]))
rollbackSubscriptions.forEach(s => s.unsubscribe())
let emptyRequests = 0
const emptyTx = db.createTransaction({ mutationFn: async () => { emptyRequests++ } })
emptyTx.mutate(() => {})
await emptyTx.isPersisted.promise
assert.equal(emptyRequests, 0)
console.log(JSON.stringify({ rollbackEvents, emptyTransaction: { state: emptyTx.state, emptyRequests }, evidence: 'actual DB and Query adapter; outer context and nested fanout deferrals', events }, null, 2))
subscriptions.forEach(s => s.unsubscribe())
await db.cleanup()
queryClient.clear()
