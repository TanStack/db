const DB_PATH = new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href
const { createCollection, localOnlyCollectionOptions, createLiveQueryCollection, eq, BTreeIndex } = await import(DB_PATH)
const issuesData = Array.from({ length: 10000 }, (_, i) => ({
  id: i, title: `Issue ${i}`, open: i % 3 !== 0, created: 10000 - i, creatorID: i % 1000,
}))
const issues = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: issuesData }))
issues.createIndex((r) => r.created, { indexType: BTreeIndex })
const build = (qb) => qb.from({ issue: issues }).where(({ issue }) => eq(issue.open, true)).orderBy(({ issue }) => issue.created, `desc`).limit(50)
for (let i = 0; i < 300; i++) {
  const lq = createLiveQueryCollection({ startSync: true, query: build })
  void lq.toArray
  await lq.cleanup()
}
process.exit(0)
