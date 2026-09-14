import { drizzle } from 'drizzle-orm/postgres-js'
import { postgresAdapter } from '../integrated-todo/src/postgres-adapter.server.ts'
import { and, asc, desc, eq, gte, isNull, or, sql } from 'drizzle-orm'
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

const item = pgTable('item', {
  id: text().primaryKey(),
  parent_id: integer(),
  body: text().notNull(),
  completed: boolean().notNull(),
  score: integer(),
  amount: numeric({ precision: 30, scale: 8 }),
  created_at: timestamp({ withTimezone: true, mode: 'date' }).notNull(),
  info: jsonb().notNull(),
})
const parent = pgTable('parent', {
  id: integer().primaryKey(),
  label: text().notNull(),
})

export function readDatabase(client, prepared = true) {
  return drizzle(prepared ? postgresAdapter(client) : client)
}

export function drizzleReads(db, config) {
  const candidates = [
    [
      'all',
      () =>
        db
          .select()
          .from(item)
          .orderBy(sql`${item.score} DESC NULLS LAST`, asc(item.id)),
    ],
    [
      'filtered',
      () =>
        db
          .select()
          .from(item)
          .where(
            and(
              eq(item.completed, config.completed),
              or(gte(item.score, config.threshold), isNull(item.score)),
            ),
          )
          .orderBy(desc(item.id)),
    ],
    [
      'top',
      () =>
        db
          .select()
          .from(item)
          .orderBy(sql`${item.score} DESC NULLS LAST`, asc(item.id))
          .limit(config.limit)
          .offset(config.offset),
    ],
    [
      'join',
      () =>
        db
          .select({ id: item.id, body: item.body, label: parent.label })
          .from(item)
          .leftJoin(parent, eq(item.parent_id, parent.id))
          .where(eq(item.completed, config.completed))
          .orderBy(asc(item.id)),
    ],
    [
      'group',
      () =>
        db
          .select({
            id: sql`${item.completed}::text`,
            count: sql`count(*)::integer`,
            total: sql`sum(${item.score})::text`,
          })
          .from(item)
          .groupBy(item.completed)
          .orderBy(item.completed),
    ],
    ['empty', () => db.select().from(item).where(eq(item.id, 'absent'))],
    [
      'bound-text',
      () =>
        db
          .select()
          .from(item)
          .where(eq(item.body, config.body))
          .orderBy(asc(item.id)),
    ],
  ]
  return Object.fromEntries(
    config.kinds.map((index) => {
      const [id, create] = candidates[index]
      return [id, async () => await create()]
    }),
  )
}
