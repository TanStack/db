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
export const all = queryGeneric({
  args: {},
  handler: (ctx) => ctx.db.query('tasks').withIndex('by_rank').collect(),
})
export const seed = mutationGeneric({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    for (const row of await ctx.db.query('tasks').collect())
      await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('receipts').collect())
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
    const previous = await ctx.db
      .query('tasks')
      .withIndex('by_clientId', (q) => q.eq('clientId', args.clientId))
      .unique()
    if (args.remove) {
      if (previous) await ctx.db.delete(previous._id)
    } else if (previous)
      await ctx.db.patch(previous._id, { text: args.text, rank: args.rank })
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

// A low read budget forces genuine server page splits during the range tests.
export const split = queryGeneric({
  args: { paginationOpts: paginationOptsValidator },
  handler: (ctx, args) =>
    ctx.db
      .query('tasks')
      .withIndex('by_rank')
      .paginate({ ...args.paginationOpts, maximumRowsRead: 3 }),
})
