import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core"

export const todos = pgTable(`todos`, {
  id: serial(`id`).primaryKey(),
  text: text(`text`).notNull(),
  completed: boolean(`completed`).notNull().default(false),
  createdAt: timestamp(`created_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp(`updated_at`, { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export type Todo = typeof todos.$inferSelect
export type NewTodo = typeof todos.$inferInsert
