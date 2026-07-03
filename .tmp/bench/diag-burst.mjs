// Diagnose state accumulation during a synchronous mutation burst
const DB_PATH = new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href
const { createCollection, localOnlyCollectionOptions, createLiveQueryCollection, eq, BasicIndex, BTreeIndex } = await import(DB_PATH)

const issuesData = Array.from({ length: 10000 }, (_, i) => ({
  id: i, title: `Issue ${i}`, open: i % 3 !== 0, created: 10000 - i, creatorID: i % 1000,
}))
const issues = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: issuesData }))
issues.createIndex((r) => r.created, { indexType: BTreeIndex })

const lq = createLiveQueryCollection({
  startSync: true,
  query: (qb) => qb.from({ issue: issues }).where(({ issue }) => eq(issue.open, true)).orderBy(({ issue }) => issue.created, `desc`).limit(50),
})
void lq.toArray

const state = issues._state ?? issues.state_?? null
const stateMgr = (issues)._state || (issues).stateManager
const row = { id: 10011, title: `probe`, open: true, created: 15000, creatorID: 0 }

const sizes = () => {
  const s = (issues)._state
  return {
    transactions: s?.transactions?.size,
    pendingSynced: s?.pendingSyncedTransactions?.length,
    pendingOptimisticUpserts: s?.pendingOptimisticUpserts?.size,
    recentlySynced: s?.recentlySyncedKeys?.size,
  }
}

for (let i = 0; i < 2000; i++) {
  issues.insert(row)
  issues.delete(row.id)
  if (i === 10 || i === 100 || i === 500 || i === 1999) {
    console.log(`pair ${i}:`, JSON.stringify(sizes()))
  }
}
const t0 = performance.now()
for (let i = 0; i < 200; i++) { issues.insert(row); issues.delete(row.id) }
console.log(`after burst: ${((performance.now() - t0) / 200 * 1000).toFixed(1)}µs/pair`, JSON.stringify(sizes()))
await new Promise((r) => setTimeout(r, 10))
const t1 = performance.now()
for (let i = 0; i < 200; i++) { issues.insert(row); issues.delete(row.id) }
console.log(`fresh burst: ${((performance.now() - t1) / 200 * 1000).toFixed(1)}µs/pair`, JSON.stringify(sizes()))
process.exit(0)
