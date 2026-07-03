// Count commitPendingTransactions calls and op volume during one view_list hydrate
const DB_PATH = new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href
const { createCollection, localOnlyCollectionOptions, createLiveQueryCollection, eq, BTreeIndex } = await import(DB_PATH)

const issuesData = Array.from({ length: 10000 }, (_, i) => ({
  id: i, title: `Issue ${i}`, open: i % 3 !== 0, created: 10000 - i, creatorID: i % 1000,
}))
const issues = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: issuesData }))
issues.createIndex((r) => r.created, { indexType: BTreeIndex })

const build = (qb) => qb.from({ issue: issues }).where(({ issue }) => eq(issue.open, true)).orderBy(({ issue }) => issue.created, `desc`).limit(50)

// warm
{ const lq = createLiveQueryCollection({ startSync: true, query: build }); void lq.toArray; await lq.cleanup() }

// instrument prototype-level? commitPendingTransactions is an instance arrow fn — patch after creation via subclass not possible; instead patch on the fly:
let stats = { calls: 0, ops: 0, events: 0 }
const origCreate = createCollection
// patch the state manager of the NEXT live collection by wrapping after creation:
const lq = createLiveQueryCollection({ startSync: false, query: build })
const state = lq._state
const orig = state.commitPendingTransactions
state.commitPendingTransactions = () => {
  stats.calls++
  for (const t of state.pendingSyncedTransactions) {
    if (t.committed) stats.ops += t.operations.length
  }
  return orig()
}
const t0 = performance.now()
lq.startSyncImmediate()
void lq.toArray
const dt = performance.now() - t0
console.log(`hydrate ${dt.toFixed(2)}ms · commits: ${stats.calls} · committed ops seen: ${stats.ops} · size ${lq.size}`)
await lq.cleanup()

// Also time 200 fresh hydrates for baseline
let best = Infinity
for (let i = 0; i < 200; i++) {
  const t1 = performance.now()
  const l = createLiveQueryCollection({ startSync: true, query: build })
  void l.toArray
  best = Math.min(best, performance.now() - t1)
  await l.cleanup()
}
console.log(`best hydrate: ${best.toFixed(3)}ms`)
process.exit(0)
