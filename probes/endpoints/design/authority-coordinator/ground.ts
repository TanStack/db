import assert from 'node:assert/strict'
import { DbClient, collectionOptions } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { QueryClient } from '@tanstack/query-core'

const events: unknown[] = []
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
const db = new DbClient()
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
let held: ReturnType<typeof deferred<{ id: string; value: number }[]>> | undefined
const make = (id: string) => db.collection(collectionOptions(queryCollectionOptions({
  id, queryKey: [id], queryClient,
  queryFn: async () => held ? held.promise : [{ id: 'row', value: 0 }],
  getKey: (row: { id: string; value: number }) => row.id,
  staleTime: Infinity,
})))
const a = make('a'), b = make('b')
await Promise.all([a.preload(), b.preload()])
const pair = () => [a.get('row')!.value, b.get('row')!.value]
let observations: number[][] = []
const subscriptions = [a,b].map(c => c.subscribeChanges(() => observations.push(pair()), { includeInitialState: false }))
a.utils.writeUpsert({ id: 'row', value: 1 })
b.utils.writeUpsert({ id: 'row', value: 1 })
assert.deepEqual(observations, [[1,0], [1,1]])
events.push({ boundary: 'separate writes', observations })
observations = []
const publications = [a,b].map(c => c._deferPublication())
a.utils.writeUpsert({ id: 'row', value: 2 })
b.utils.writeUpsert({ id: 'row', value: 2 })
publications.forEach(p => p.publish())
assert.deepEqual(observations, [[2,2], [2,2]])
events.push({ boundary: 'deferred subscriber delivery', observations: [...observations] })
observations = []

held = deferred()
const fetching = a.utils.refetch({ throwOnError: true })
await Promise.resolve()
a.utils.writeUpsert({ id: 'row', value: 3 })
held.resolve([{ id: 'row', value: 0 }])
await fetching
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(a.get('row')!.value, 0)
events.push({ boundary: 'held read after manual authority', visible: a.get('row')!.value,
  cache: queryClient.getQueryData(['a']) })
held = undefined
await a.cleanup()
assert.equal(make('a'), a)
await a.preload()
events.push({ boundary: 'cleanup and rebind', sameObject: true, status: a.status })
subscriptions.forEach(s => s.unsubscribe())
await db.cleanup()
queryClient.clear()
console.log(JSON.stringify({ evidence: 'actual DB and Query adapter', events }, null, 2))
