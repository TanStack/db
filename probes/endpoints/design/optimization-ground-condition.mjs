// Controlled information-boundary witnesses, not an Endpoints implementation test.
// Run: node probes/endpoints/design/optimization-ground-condition.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../integrated-todo/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const db = new PGlite()
const evidence = []
const rows = async (sql) => (await db.query(sql)).rows

async function reset(values) {
  await db.exec('TRUNCATE items, labels;')
  if (values) await db.exec(`INSERT INTO items VALUES ${values};`)
}
async function worlds(name, setups, observe, change, read) {
  const observations = []
  for (const setup of setups) {
    await reset()
    await db.exec(setup)
    observations.push({ before: await rows(observe), supplied: await rows(change), after: await rows(read) })
  }
  assert.deepEqual(observations[0].before, observations[1].before)
  assert.deepEqual(observations[0].supplied, observations[1].supplied)
  assert.notDeepEqual(observations[0].after, observations[1].after)
  evidence.push({ name, kind: 'executed SQL indistinguishable-input pair', observations })
}

try {
  const version = await rows('SELECT version() AS version')
  await db.exec(`
    CREATE TABLE items (id text PRIMARY KEY, category text, value integer);
    CREATE TABLE labels (id text PRIMARY KEY, enabled boolean);
  `)
  await worlds('B2-distinct-support', [
    "INSERT INTO items VALUES ('a','x',1)",
    "INSERT INTO items VALUES ('a','x',1),('b','x',1)",
  ], 'SELECT DISTINCT category FROM items',
  "DELETE FROM items WHERE id='a' RETURNING category",
  'SELECT DISTINCT category FROM items')

  await worlds('B3-missing-old-value', [
    "INSERT INTO items VALUES ('a','x',3),('b','x',7)",
    "INSERT INTO items VALUES ('a','x',5),('b','x',5)",
  ], 'SELECT sum(value)::integer AS total FROM items',
  "UPDATE items SET value=8 WHERE id='a' RETURNING id,value",
  'SELECT sum(value)::integer AS total FROM items')

  const join = 'SELECT i.id FROM items i JOIN labels l ON i.category=l.id WHERE l.enabled ORDER BY i.id'
  await worlds('B4-hidden-join-partner', [
    "INSERT INTO labels VALUES ('p',false); INSERT INTO items VALUES ('a','p',1)",
    "INSERT INTO labels VALUES ('p',false)",
  ], join, "UPDATE labels SET enabled=true WHERE id='p' RETURNING id,enabled", join)

  await worlds('B5-top-k-refill', [
    "INSERT INTO items VALUES ('a','x',1),('b','x',2)",
    "INSERT INTO items VALUES ('a','x',1),('c','x',2)",
  ], 'SELECT id FROM items ORDER BY value,id LIMIT 1',
  "DELETE FROM items WHERE id='a' RETURNING id,value",
  'SELECT id FROM items ORDER BY value,id LIMIT 1')

  await reset("('a','x',0),('b','x',0)")
  const baseline = await rows('SELECT id,value FROM items ORDER BY id')
  await db.exec("UPDATE items SET value=9 WHERE id='b'")
  const supplied = await rows("UPDATE items SET value=1 WHERE id='a' RETURNING id,value")
  const fresh = await rows('SELECT id,value FROM items ORDER BY id')
  const inferred = baseline.map((row) => supplied.find((change) => change.id === row.id) ?? row)
  assert.notDeepEqual(inferred, fresh)
  evidence.push({ name: 'B1-baseline-gap', kind: 'executed SQL controlled prior write', baseline, supplied, inferred, fresh })

  await reset("('a','A',1)")
  const groups = "SELECT category, count(*)::integer AS count FROM items GROUP BY category ORDER BY category"
  const groupsBefore = await rows(groups)
  const moved = await rows("UPDATE items SET category='B' WHERE id='a' RETURNING id,category")
  const groupsAfter = await rows(groups)
  const newKeysOnly = [...groupsBefore.filter((group) => group.category !== moved[0].category), ...groupsAfter]
  assert.notDeepEqual(newKeysOnly, groupsAfter)
  evidence.push({ name: 'B6-old-and-new-regions', kind: 'executed SQL region move', groupsBefore, moved, groupsAfter, newKeysOnly })

  const diff = (before, after) => ({
    remove: before.filter((row) => !after.some((next) => next.id === row.id)).map((row) => row.id),
    upsert: after.filter((row) => JSON.stringify(before.find((old) => old.id === row.id)) !== JSON.stringify(row)),
  })
  const apply = (before, patch) => {
    const result = new Map(before.map((row) => [row.id, row]))
    for (const id of patch.remove) result.delete(id)
    for (const row of patch.upsert) result.set(row.id, row)
    return [...result.values()].sort((a, b) => a.id.localeCompare(b.id))
  }
  const old = [{ id: 'a', value: 0 }], next = [{ id: 'a', value: 1 }]
  const patch = diff(old, next)
  const wrongBase = [...old, { id: 'b', value: 9 }]
  assert.deepEqual(apply(old, patch), next)
  assert.notDeepEqual(apply(wrongBase, patch), next)
  // Correct reconstruction of an old target still does not prove recency.
  const newer = [{ id: 'a', value: 2 }]
  assert.notDeepEqual(apply(old, patch), newer)
  // Complete fresh output can reconcile the earlier unobserved write.
  assert.deepEqual(apply(baseline, diff(baseline, fresh)), fresh)
  evidence.push({ name: 'B7-exact-base-and-recency', kind: 'executed finite-map model, not production patch code', old, next, patch, wrongBase, wrongResult: apply(wrongBase, patch), newer, recoveredExternalWrite: apply(baseline, diff(baseline, fresh)) })

  await reset("('a','x',0),('b','x',0)")
  const first = await rows("SELECT value FROM items WHERE id='a'")
  await db.exec('UPDATE items SET value=1')
  const second = await rows("SELECT value FROM items WHERE id='b'")
  assert.deepEqual([first[0].value, second[0].value], [0, 1])
  evidence.push({ name: 'B8-statement-snapshots', kind: 'executed SQL controlled commit between reads, not multiconnection race', before: [0, 0], after: [1, 1], assembled: [first[0].value, second[0].value] })

  await reset("('a','x',0)")
  const sibling = await rows("WITH changed AS (UPDATE items SET value=1 RETURNING *) SELECT value FROM items")
  const later = await rows('SELECT value FROM items')
  assert.deepEqual(sibling, [{ value: 0 }])
  assert.deepEqual(later, [{ value: 1 }])
  evidence.push({ name: 'B9-dml-cte-snapshot', kind: 'executed SQL', sibling, later })
  console.log(JSON.stringify({ version: version[0].version, cases: evidence.length, evidence }, null, 2))
} finally {
  await db.close()
}
