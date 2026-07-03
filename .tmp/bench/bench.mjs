// Faithful port of the TanStack side of samwillis/rindle-db-bench (bench-tanstack),
// pointed at a local build of @tanstack/db. Run:
//   node --expose-gc .tmp/bench/bench.mjs
//   DB_PATH=/abs/path/to/packages/db/dist/esm/index.js SCALE=large node --expose-gc .tmp/bench/bench.mjs

const DB_PATH =
  process.env.DB_PATH ??
  new URL(`../../packages/db/dist/esm/index.js`, import.meta.url).href

const {
  createCollection,
  createLiveQueryCollection,
  localOnlyCollectionOptions,
  eq,
  count,
  toArray,
  BasicIndex,
  BTreeIndex,
} = await import(DB_PATH)

// ------------------------------- data ----------------------------------

const SCALES = {
  small: { name: `small`, users: 100, issues: 1_000, comments: 5_000 },
  medium: { name: `medium`, users: 300, issues: 5_000, comments: 25_000 },
  large: { name: `large`, users: 1_000, issues: 10_000, comments: 50_000 },
  xl: { name: `xl`, users: 2_000, issues: 20_000, comments: 100_000 },
}

function resolveScale() {
  const requested = (process.env.SCALE ?? `large`).toLowerCase()
  const scale = SCALES[requested]
  if (scale) return scale
  const parts = requested.split(`,`).map((n) => Number(n.trim()))
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return { name: requested, users: parts[0], issues: parts[1], comments: parts[2] }
  }
  throw new Error(`unknown SCALE "${requested}"`)
}

function generate(scale) {
  const users = Array.from({ length: scale.users }, (_, i) => ({
    id: i,
    name: `User ${i}`,
    role: i % 10 === 0 ? `admin` : `member`,
  }))
  const issues = Array.from({ length: scale.issues }, (_, i) => ({
    id: i,
    title: `Issue ${i}: a bug or a feature request`,
    open: i % 3 !== 0,
    created: scale.issues - i,
    creatorID: i % scale.users,
  }))
  const comments = Array.from({ length: scale.comments }, (_, i) => ({
    id: i,
    issueID: i % scale.issues,
    body: `Comment ${i} body text`,
    creatorID: i % scale.users,
  }))
  return { users, issues, comments, counts: { users: scale.users, issues: scale.issues, comments: scale.comments } }
}

const probeIds = (scale) => ({
  newIssueId: scale.issues + 7,
  newIssueCreated: scale.issues + 1000,
  newCommentId: scale.comments + 7,
  existingIssueId: 0,
  existingCreatorId: 0,
})

const VIEW_LIMIT = 50
const PREVIEW_LIMIT = 3

function viewSetup(dataset, scale) {
  const openByNewest = dataset.issues.filter((i) => i.open).sort((a, b) => b.created - a.created)
  const page1Last = openByNewest[VIEW_LIMIT - 1]
  const visibleIssueId = openByNewest[1]?.id ?? openByNewest[0].id
  return {
    visibleIssueId,
    page1Cursor: page1Last.created,
    newTopIssue: {
      id: scale.issues + 11,
      title: `incremental probe — new top issue`,
      open: true,
      created: scale.issues + 5000,
      creatorID: 0,
    },
    newPageIssue: {
      id: scale.issues + 12,
      title: `incremental probe — page-2 issue`,
      open: true,
      created: page1Last.created - 0.5,
      creatorID: 0,
    },
    newVisibleComment: {
      id: scale.comments + 11,
      issueID: visibleIssueId,
      body: `incremental probe comment`,
      creatorID: 0,
    },
  }
}

// ------------------------------ harness --------------------------------

const LADDER_FULL = [
  { name: `scan`, label: `scan all issues` },
  { name: `filter`, label: `filter open` },
  { name: `filter_order_limit`, label: `filter+order+limit 50` },
  { name: `one_to_many`, label: `issue → comments[]` },
  { name: `many_to_one`, label: `issue → creator` },
  { name: `nested`, label: `issue → comments → creator` },
  { name: `aggregate_count`, label: `issue → commentCount` },
]

const LADDER_VIEWS = [
  { name: `view_list`, label: `list: newest 50 open` },
  { name: `view_list_creator`, label: `list + author` },
  { name: `view_list_count`, label: `list + comment count` },
  { name: `view_list_comments`, label: `list + 3 recent comments` },
  { name: `view_detail`, label: `issue detail + comments` },
  { name: `view_page`, label: `list: page 2` },
]

function resultShape(q) {
  switch (q) {
    case `one_to_many`:
    case `nested`:
    case `view_list_comments`:
    case `view_detail`:
      return `comments`
    case `many_to_one`:
    case `view_list_creator`:
      return `creator`
    case `aggregate_count`:
    case `view_list_count`:
      return `count`
    default:
      return `plain`
  }
}

const nowMs = () => Number(process.hrtime.bigint()) / 1e6
const gc = globalThis.gc

async function timeHydrate(adapter, q, rounds) {
  await adapter.disposeHydrate(adapter.hydrate(q).handle)
  gc?.()
  let bestMs = Infinity
  let count_ = 0
  let nested = 0
  for (let r = 0; r < rounds; r++) {
    const t0 = nowMs()
    const res = adapter.hydrate(q)
    const dt = nowMs() - t0
    bestMs = Math.min(bestMs, dt)
    count_ = res.count
    nested = res.nested
    await adapter.disposeHydrate(res.handle)
    gc?.()
  }
  return { bestMs, count: count_, nested }
}

async function timeIncremental(inc, pairs, rounds) {
  const warm = Math.min(20, pairs)
  for (let k = 0; k < warm; k++) await inc.pair()
  gc?.()
  let bestMsPerPair = Infinity
  for (let r = 0; r < rounds; r++) {
    const t0 = nowMs()
    for (let k = 0; k < pairs; k++) await inc.pair()
    const perPair = (nowMs() - t0) / pairs
    bestMsPerPair = Math.min(bestMsPerPair, perPair)
    gc?.()
  }
  return { bestMsPerPair, liveCount: inc.liveCount() }
}

// ---------------------------- tanstack adapter -------------------------

let sink = 0

function build(q, c, ctx) {
  const list = (qb) =>
    qb
      .from({ issue: c.issues })
      .where(({ issue }) => eq(issue.open, true))
      .orderBy(({ issue }) => issue.created, `desc`)
      .limit(VIEW_LIMIT)
  switch (q) {
    case `scan`:
      return (qb) => qb.from({ issue: c.issues })
    case `filter`:
      return (qb) => qb.from({ issue: c.issues }).where(({ issue }) => eq(issue.open, true))
    case `filter_order_limit`:
      return (qb) =>
        qb
          .from({ issue: c.issues })
          .where(({ issue }) => eq(issue.open, true))
          .orderBy(({ issue }) => issue.created, `desc`)
          .limit(50)
    case `one_to_many`:
      return (qb) =>
        qb.from({ issue: c.issues }).select(({ issue }) => ({
          id: issue.id,
          comments: toArray(
            qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
              id: cm.id,
              body: cm.body,
            })),
          ),
        }))
    case `many_to_one`:
      return (qb) =>
        qb.from({ issue: c.issues }).select(({ issue }) => ({
          id: issue.id,
          creator: toArray(
            qb.from({ u: c.users }).where(({ u }) => eq(u.id, issue.creatorID)).select(({ u }) => ({
              id: u.id,
              name: u.name,
            })),
          ),
        }))
    case `nested`:
      return (qb) =>
        qb.from({ issue: c.issues }).select(({ issue }) => ({
          id: issue.id,
          comments: toArray(
            qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
              id: cm.id,
              creator: toArray(
                qb.from({ u: c.users }).where(({ u }) => eq(u.id, cm.creatorID)).select(({ u }) => ({
                  id: u.id,
                })),
              ),
            })),
          ),
        }))
    case `aggregate_count`:
      return (qb) =>
        qb
          .from({ issue: c.issues })
          .join({ cm: c.comments }, ({ issue, cm }) => eq(issue.id, cm.issueID), `left`)
          .groupBy(({ issue }) => issue.id)
          .select(({ issue, cm }) => ({ id: issue.id, commentCount: count(cm.id) }))
    case `view_list`:
      return list
    case `view_list_creator`:
      return (qb) =>
        list(qb).select(({ issue }) => ({
          id: issue.id,
          creator: toArray(
            qb.from({ u: c.users }).where(({ u }) => eq(u.id, issue.creatorID)).select(({ u }) => ({
              id: u.id,
              name: u.name,
            })),
          ),
        }))
    case `view_list_count`:
      return (qb) => {
        const top = list(qb)
        return qb
          .from({ issue: top })
          .join({ cm: c.comments }, ({ issue, cm }) => eq(issue.id, cm.issueID), `left`)
          .groupBy(({ issue }) => issue.id)
          .select(({ issue, cm }) => ({ id: issue.id, commentCount: count(cm.id) }))
      }
    case `view_list_comments`:
      return (qb) =>
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
    case `view_detail`:
      return (qb) =>
        qb.from({ issue: c.issues }).where(({ issue }) => eq(issue.id, ctx.detailId)).select(({ issue }) => ({
          id: issue.id,
          comments: toArray(
            qb.from({ cm: c.comments }).where(({ cm }) => eq(cm.issueID, issue.id)).select(({ cm }) => ({
              id: cm.id,
              body: cm.body,
            })),
          ),
        }))
    case `view_page`:
      return (qb) => list(qb).offset(VIEW_LIMIT)
  }
}

function read(q, rows) {
  const shape = resultShape(q)
  let nested = 0
  let acc = 0
  for (const row of rows) {
    acc += row.id | 0
    if (shape === `comments`) {
      const comments = row.comments
      nested += comments.length
      for (const cm of comments) {
        acc += cm.id | 0
        if (q === `nested`) {
          const creator = cm.creator
          if (creator.length > 0) acc += creator[0].id | 0
        }
      }
    } else if (shape === `creator`) {
      const creator = row.creator
      nested += creator.length
      if (creator.length > 0) acc += creator[0].id | 0
    } else if (shape === `count`) {
      nested += row.commentCount | 0
    }
  }
  sink = (sink + acc) | 0
  return { count: rows.length, nested }
}

function makeTanstack(dataset, scale) {
  const issues = createCollection(
    localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: dataset.issues }),
  )
  const comments = createCollection(
    localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: dataset.comments }),
  )
  const users = createCollection(
    localOnlyCollectionOptions({ getKey: (r) => r.id, initialData: dataset.users }),
  )

  comments.createIndex((r) => r.issueID, { indexType: BasicIndex })
  comments.createIndex((r) => r.creatorID, { indexType: BasicIndex })
  issues.createIndex((r) => r.creatorID, { indexType: BasicIndex })
  issues.createIndex((r) => r.created, { indexType: BTreeIndex })

  const colls = { issues, comments, users }
  const ids = probeIds(scale)
  const vs = viewSetup(dataset, scale)
  const ctx = { detailId: vs.visibleIssueId }
  const newIssue = {
    id: ids.newIssueId,
    title: `incremental probe issue`,
    open: true,
    created: ids.newIssueCreated,
    creatorID: ids.existingCreatorId,
  }
  const newComment = {
    id: ids.newCommentId,
    issueID: ids.existingIssueId,
    body: `incremental probe comment`,
    creatorID: ids.existingCreatorId,
  }

  function probeOp(q) {
    if (q === `one_to_many` || q === `nested` || q === `aggregate_count`)
      return { coll: comments, row: newComment }
    if (q === `view_list_count` || q === `view_list_comments` || q === `view_detail`)
      return { coll: comments, row: vs.newVisibleComment }
    if (q === `view_list` || q === `view_list_creator`)
      return { coll: issues, row: vs.newTopIssue }
    if (q === `view_page`) return { coll: issues, row: vs.newPageIssue }
    return { coll: issues, row: newIssue }
  }

  return {
    name: `TanStack DB`,

    hydrate(q) {
      const lq = createLiveQueryCollection({ startSync: true, query: build(q, colls, ctx) })
      const sig = read(q, lq.toArray)
      return { handle: lq, count: sig.count, nested: sig.nested }
    },

    async disposeHydrate(handle) {
      await handle.cleanup()
    },

    incremental(q) {
      const lq = createLiveQueryCollection({ startSync: true, query: build(q, colls, ctx) })
      const { coll, row } = probeOp(q)
      const pair = () => {
        coll.insert(row)
        coll.delete(row.id)
      }
      return {
        liveCount: () => lq.size,
        pair,
        dispose: () => lq.cleanup(),
      }
    },

    async teardown() {
      if (sink === 0x7fffffff) process.stderr.write(``)
      await Promise.all([issues.cleanup(), comments.cleanup(), users.cleanup()])
    },
  }
}

// -------------------------------- main ----------------------------------

const ROUNDS = Number(process.env.ROUNDS ?? 5)
const PAIRS = Number(process.env.PAIRS ?? 25)
const IROUNDS = Number(process.env.IROUNDS ?? 3)
const ONLY = process.env.ONLY ? process.env.ONLY.split(`,`) : null

async function runLadder(banner, ladder, tanstack) {
  process.stdout.write(`\n${banner}\n`)
  const rows = []
  for (const { name, label } of ladder) {
    if (ONLY && !ONLY.includes(name)) continue
    const tH = await timeHydrate(tanstack, name, ROUNDS)

    const tInc = tanstack.incremental(name)
    const tI = await timeIncremental(tInc, PAIRS, IROUNDS)
    await tInc.dispose()

    rows.push({ name, label, hydrateMs: tH.bestMs, incrMs: tI.bestMsPerPair, count: tH.count, nested: tH.nested })
    process.stdout.write(
      `• ${label.padEnd(28)} hydrate ${tH.bestMs.toFixed(3).padStart(9)}ms · incr ${tI.bestMsPerPair.toFixed(4).padStart(9)}ms · rows ${tH.count}${tH.nested ? ` (+${tH.nested})` : ``}\n`,
    )
  }
  return rows
}

async function main() {
  const scale = resolveScale()
  const data = generate(scale)
  process.stdout.write(
    `TanStack DB local bench — db: ${DB_PATH}\n` +
      `scale "${scale.name}": ${data.counts.users} users · ${data.counts.issues} issues · ${data.counts.comments} comments\n` +
      `node ${process.version} · hydrate=min/${ROUNDS} · incremental=min/${IROUNDS}×${PAIRS} pairs\n`,
  )

  const tanstack = makeTanstack(data, scale)

  const views = await runLadder(`── Realistic UI views (bounded result) ──`, LADDER_VIEWS, tanstack)
  const full = await runLadder(`── Full materialization (whole result into JS) ──`, LADDER_FULL, tanstack)

  console.log(`\nJSON:`, JSON.stringify({ views, full }))
  await tanstack.teardown()
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
