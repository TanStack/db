// Profile a single query hydrate repeatedly. Usage:
//   node --cpu-prof --cpu-prof-dir=.tmp/bench/profiles .tmp/bench/profile-one.mjs <queryName> [reps]
import { Session } from 'node:inspector'

const DB_PATH =
  process.env.DB_PATH ??
  new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href

const db = await import(DB_PATH)
const {
  createCollection,
  createLiveQueryCollection,
  localOnlyCollectionOptions,
  eq,
  count,
  toArray,
  BasicIndex,
  BTreeIndex,
} = db

const q = process.argv[2] ?? `nested`
const reps = Number(process.argv[3] ?? 5)

// same dataset as bench (large)
const scale = { users: 1000, issues: 10000, comments: 50000 }
const users = Array.from({ length: scale.users }, (_, i) => ({
  id: i, name: `User ${i}`, role: i % 10 === 0 ? `admin` : `member`,
}))
const issuesData = Array.from({ length: scale.issues }, (_, i) => ({
  id: i, title: `Issue ${i}: a bug or a feature request`, open: i % 3 !== 0,
  created: scale.issues - i, creatorID: i % scale.users,
}))
const commentsData = Array.from({ length: scale.comments }, (_, i) => ({
  id: i, issueID: i % scale.issues, body: `Comment ${i} body text`, creatorID: i % scale.users,
}))

const issues = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: issuesData }))
const comments = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: commentsData }))
const usersColl = createCollection(localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: users }))

comments.createIndex((r) => r.issueID, { indexType: BasicIndex })
comments.createIndex((r) => r.creatorID, { indexType: BasicIndex })
issues.createIndex((r) => r.creatorID, { indexType: BasicIndex })
issues.createIndex((r) => r.created, { indexType: BTreeIndex })

const c = { issues, comments, users: usersColl }

const builders = {
  scan: (qb) => qb.from({ issue: c.issues }),
  filter: (qb) => qb.from({ issue: c.issues }).where(({ issue }) => eq(issue.open, true)),
  one_to_many: (qb) =>
    qb.from({ issue: c.issues }).select(({ issue }) => ({
      id: issue.id,
      comments: toArray(
        qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
          id: cm.id, body: cm.body,
        })),
      ),
    })),
  many_to_one: (qb) =>
    qb.from({ issue: c.issues }).select(({ issue }) => ({
      id: issue.id,
      creator: toArray(
        qb.from({ u: c.users }).where(({ u }) => eq(u.id, issue.creatorID)).select(({ u }) => ({
          id: u.id, name: u.name,
        })),
      ),
    })),
  nested: (qb) =>
    qb.from({ issue: c.issues }).select(({ issue }) => ({
      id: issue.id,
      comments: toArray(
        qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
          id: cm.id,
          creator: toArray(
            qb.from({ u: c.users }).where(({ u }) => eq(u.id, cm.creatorID)).select(({ u }) => ({ id: u.id })),
          ),
        })),
      ),
    })),
  aggregate_count: (qb) =>
    qb
      .from({ issue: c.issues })
      .join({ cm: c.comments }, ({ issue, cm }) => eq(issue.id, cm.issueID), `left`)
      .groupBy(({ issue }) => issue.id)
      .select(({ issue, cm }) => ({ id: issue.id, commentCount: count(cm.id) })),
}

const VIEW_LIMIT = 50
const PREVIEW_LIMIT = 3
builders.filter_order_limit = (qb) =>
  qb
    .from({ issue: c.issues })
    .where(({ issue }) => eq(issue.open, true))
    .orderBy(({ issue }) => issue.created, `desc`)
    .limit(50)
const list = (qb) =>
  qb
    .from({ issue: c.issues })
    .where(({ issue }) => eq(issue.open, true))
    .orderBy(({ issue }) => issue.created, `desc`)
    .limit(VIEW_LIMIT)
builders.view_list = list
builders.view_list_creator = (qb) =>
  list(qb).select(({ issue }) => ({
    id: issue.id,
    creator: toArray(
      qb.from({ u: c.users }).where(({ u }) => eq(u.id, issue.creatorID)).select(({ u }) => ({
        id: u.id, name: u.name,
      })),
    ),
  }))
builders.view_list_count = (qb) => {
  const top = list(qb)
  return qb
    .from({ issue: top })
    .join({ cm: c.comments }, ({ issue, cm }) => eq(issue.id, cm.issueID), `left`)
    .groupBy(({ issue }) => issue.id)
    .select(({ issue, cm }) => ({ id: issue.id, commentCount: count(cm.id) }))
}
builders.view_list_comments = (qb) =>
  list(qb).select(({ issue }) => ({
    id: issue.id,
    comments: toArray(
      qb
        .from({ cm: c.comments })
        .where(({ cm }) => eq(cm.issueID, issue.id))
        .orderBy(({ cm }) => cm.id, `desc`)
        .limit(PREVIEW_LIMIT)
        .select(({ cm }) => ({ id: cm.id, body: cm.body })),
    ),
  }))
builders.view_detail = (qb) =>
  qb.from({ issue: c.issues }).where(({ issue }) => eq(issue.id, 4)).select(({ issue }) => ({
    id: issue.id,
    comments: toArray(
      qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
        id: cm.id, body: cm.body,
      })),
    ),
  }))

const build = builders[q]
if (!build) throw new Error(`unknown query ${q}`)

// warmup
{
  const lq = createLiveQueryCollection({ startSync: true, query: build })
  void lq.toArray
  await lq.cleanup()
}

// Incremental mode: profile add+remove pairs against a persistent view
if (process.env.INCR) {
  const lq = createLiveQueryCollection({ startSync: true, query: build })
  void lq.toArray
  const newTopIssue = {
    id: scale.issues + 11,
    title: `incremental probe — new top issue`,
    open: true,
    created: scale.issues + 5000,
    creatorID: 0,
  }
  const pairs = Number(process.env.INCR)
  // warm
  for (let i = 0; i < 20; i++) {
    issues.insert(newTopIssue)
    issues.delete(newTopIssue.id)
  }
  const session2 = new Session()
  session2.connect()
  await new Promise((res) => session2.post(`Profiler.enable`, res))
  await new Promise((res) => session2.post(`Profiler.start`, res))
  const t0i = performance.now()
  for (let i = 0; i < pairs; i++) {
    issues.insert(newTopIssue)
    issues.delete(newTopIssue.id)
  }
  const dti = performance.now() - t0i
  const profile2 = await new Promise((res, rej) =>
    session2.post(`Profiler.stop`, (err, { profile: p }) => (err ? rej(err) : res(p))),
  )
  session2.disconnect()
  const { writeFileSync: wf, mkdirSync: mk } = await import(`node:fs`)
  mk(new URL(`./profiles/`, import.meta.url), { recursive: true })
  const out2 = new URL(`./profiles/${q}-incr.cpuprofile`, import.meta.url)
  wf(out2, JSON.stringify(profile2))
  console.log(`${q} incr: ${pairs} pairs in ${dti.toFixed(1)}ms (${((dti / pairs) * 1000).toFixed(1)}µs/pair) → ${out2.pathname}`)
  await lq.cleanup()
  process.exit(0)
}

const session = new Session()
session.connect()
await new Promise((res) => session.post(`Profiler.enable`, res))
await new Promise((res) => session.post(`Profiler.start`, res))

const t0 = performance.now()
for (let i = 0; i < reps; i++) {
  const lq = createLiveQueryCollection({ startSync: true, query: build })
  void lq.toArray
  await lq.cleanup()
}
const dt = performance.now() - t0

const profile = await new Promise((res, rej) =>
  session.post(`Profiler.stop`, (err, { profile: p }) => (err ? rej(err) : res(p))),
)
session.disconnect()

const { writeFileSync, mkdirSync } = await import(`node:fs`)
mkdirSync(new URL(`./profiles/`, import.meta.url), { recursive: true })
const out = new URL(`./profiles/${q}.cpuprofile`, import.meta.url)
writeFileSync(out, JSON.stringify(profile))
console.log(`${q}: ${reps} reps in ${dt.toFixed(1)}ms (${(dt / reps).toFixed(1)}ms each) → ${out.pathname}`)

// Summarize the profile: aggregate self time per function
const nodes = profile.nodes
const byId = new Map(nodes.map((n) => [n.id, n]))
const selfTime = new Map()
const deltas = profile.timeDeltas
const samples = profile.samples
for (let i = 0; i < samples.length; i++) {
  const node = byId.get(samples[i])
  if (!node) continue
  const key = `${node.callFrame.functionName || `(anonymous)`} @ ${node.callFrame.url.split(`/`).slice(-2).join(`/`)}:${node.callFrame.lineNumber}`
  selfTime.set(key, (selfTime.get(key) || 0) + (deltas[i] || 0))
}
const sorted = [...selfTime.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
console.log(`\nTop 30 self-time:`)
for (const [key, us] of sorted) {
  console.log(`${(us / 1000).toFixed(1).padStart(9)}ms  ${key}`)
}
