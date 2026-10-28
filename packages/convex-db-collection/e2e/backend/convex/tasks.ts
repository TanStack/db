import {
  mutationGeneric,
  paginationOptsValidator,
  queryGeneric,
} from 'convex/server'
import { v } from 'convex/values'

export const list = queryGeneric({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) =>
    ctx.db.query('tasks').withIndex('by_rank').paginate(args.paginationOpts),
})

// Test-server query errors are actual reactive Convex errors. TCP loss alone
// cannot supply that premise to a receiving oracle.
export const guardedList = queryGeneric({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if ((await ctx.db.query('oracleControl').unique())?.failQuery)
      throw new Error('oracle query failure')
    return ctx.db
      .query('tasks')
      .withIndex('by_rank')
      .paginate(args.paginationOpts)
  },
})
export const setQueryFailure = mutationGeneric({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const previous = await ctx.db.query('oracleControl').unique()
    if (previous) await ctx.db.patch(previous._id, { failQuery: enabled })
    else await ctx.db.insert('oracleControl', { failQuery: enabled })
  },
})

// Membership/order edits form one authored server revision, rather than
// multiple independently observable client mutation transactions.
export const reshape = mutationGeneric({
  args: {
    reject: v.optional(v.boolean()),
    changes: v.array(
      v.object({
        clientId: v.string(),
        rank: v.number(),
        text: v.string(),
        remove: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { changes, reject }) => {
    for (const change of changes) {
      const previous = await ctx.db
        .query('tasks')
        .withIndex('by_clientId', (q) => q.eq('clientId', change.clientId))
        .unique()
      if (change.remove) {
        if (previous) await ctx.db.delete(previous._id)
      } else if (previous) {
        await ctx.db.patch(previous._id, {
          rank: change.rank,
          text: change.text,
        })
      } else {
        await ctx.db.insert('tasks', {
          clientId: change.clientId,
          rank: change.rank,
          text: change.text,
        })
      }
    }
    // Throw after the attempted edits: Convex must roll back the entire remote
    // transaction, including inserts and deletes. The app oracle checks both
    // the backend and the disappearance of the local optimistic operation.
    if (reject) throw new Error('oracle rejected app write')
  },
})
export const all = queryGeneric({
  args: {},
  handler: (ctx) => ctx.db.query('tasks').withIndex('by_rank').collect(),
})
// One backend transaction authors a distinguishable complete revision. Several
// client-side mutations would permit intermediate server relations instead.
export const revise = mutationGeneric({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const rows = await ctx.db.query('tasks').collect()
    for (const row of rows) await ctx.db.patch(row._id, { text })
    return rows.length
  },
})
export const seed = mutationGeneric({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    for (const row of await ctx.db.query('oracleControl').collect())
      await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('tasks').collect())
      await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('receipts').collect())
      await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('applications').collect())
      await ctx.db.delete(row._id)
    for (let i = 0; i < count; i++)
      await ctx.db.insert('tasks', {
        clientId: String(i),
        text: `task ${i}`,
        rank: i,
      })
  },
})
export const write = mutationGeneric({
  args: {
    idempotencyKey: v.string(),
    clientId: v.string(),
    text: v.string(),
    rank: v.number(),
    payload: v.optional(v.any()),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const receipt = await ctx.db
      .query('receipts')
      .withIndex('by_key', (q) => q.eq('key', args.idempotencyKey))
      .unique()
    if (receipt) return
    // This observable effect is deliberately non-idempotent. Reapplying an
    // acknowledged write must increment it, even when the final task is equal.
    const applications = await ctx.db.query('applications').unique()
    if (applications)
      await ctx.db.patch(applications._id, { count: applications.count + 1 })
    else await ctx.db.insert('applications', { count: 1 })
    const previous = await ctx.db
      .query('tasks')
      .withIndex('by_clientId', (q) => q.eq('clientId', args.clientId))
      .unique()
    if (args.remove) {
      if (previous) await ctx.db.delete(previous._id)
    } else if (previous)
      await ctx.db.patch(previous._id, {
        text: args.text,
        rank: args.rank,
        payload: args.payload,
      })
    else
      await ctx.db.insert('tasks', {
        clientId: args.clientId,
        text: args.text,
        rank: args.rank,
        ...(args.payload === undefined ? {} : { payload: args.payload }),
      })
    await ctx.db.insert('receipts', { key: args.idempotencyKey })
  },
})
export const receipts = queryGeneric({
  args: {},
  handler: (ctx) => ctx.db.query('receipts').collect(),
})

export const applicationCount = queryGeneric({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('applications').unique())?.count ?? 0,
})

// A low read budget forces genuine server page splits during the range tests.
export const split = queryGeneric({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) =>
    ctx.db
      .query('tasks')
      .withIndex('by_rank')
      .paginate({ ...args.paginationOpts, maximumRowsRead: 3 }),
})
