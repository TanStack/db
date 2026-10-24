import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  tasks: defineTable({
    clientId: v.string(),
    text: v.string(),
    rank: v.number(),
    payload: v.optional(v.any()),
  })
    .index('by_rank', ['rank'])
    .index('by_clientId', ['clientId']),
  applications: defineTable({ count: v.number() }),
  receipts: defineTable({ key: v.string() }).index('by_key', ['key']),
})
