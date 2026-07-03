const DB_PATH = new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href
const { createCollection, localOnlyCollectionOptions, createLiveQueryCollection, eq, BTreeIndex } = await import(DB_PATH)
const issuesData = Array.from({ length: 10000 }, (_, i) => ({
  id: i, title: `Issue ${i}`, open: i % 3 !== 0, created: 10000 - i, creatorID: i % 1000,
}))
const issues = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: issuesData }))
issues.createIndex((r) => r.created, { indexType: BTreeIndex })
const build = (qb) => qb.from({ issue: issues }).where(({ issue }) => eq(issue.open, true)).orderBy(({ issue }) => issue.created, `desc`).limit(50)
const gc = globalThis.gc
// mimic their harness: warmup once, then rounds with forced GC between
{ const lq = createLiveQueryCollection({ startSync: true, query: build }); void lq.toArray; await lq.cleanup(); gc?.() }
const times = []
for (let r = 0; r < 30; r++) {
  const t0 = performance.now()
  const lq = createLiveQueryCollection({ startSync: true, query: build })
  void lq.toArray
  times.push(performance.now() - t0)
  await lq.cleanup()
  gc?.()
}
console.log(times.map((t) => t.toFixed(2)).join(` `))
process.exit(0)
