import { pgTable, text, timestamp, uuid, pgEnum } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'

// Enums
export const priorityEnum = pgEnum('priority', [
  'none',
  'urgent',
  'high',
  'medium',
  'low',
])
export const statusEnum = pgEnum('status', [
  'backlog',
  'todo',
  'in_progress',
  'done',
  'canceled',
])

// Users table
export const usersTable = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  username: text().notNull().unique(),
  email: text().notNull().unique(),
  name: text(),
  avatar_url: text(),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Issues table
export const issuesTable = pgTable('issues', {
  id: uuid().primaryKey().defaultRandom(),
  title: text().notNull(),
  description: text().default(''),
  priority: priorityEnum().notNull().default('none'),
  status: statusEnum().notNull().default('backlog'),
  kanbanorder: text().notNull(),
  user_id: uuid()
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  modified: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Comments table
export const commentsTable = pgTable('comments', {
  id: uuid().primaryKey().defaultRandom(),
  body: text().notNull(),
  user_id: uuid()
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
  issue_id: uuid()
    .notNull()
    .references(() => issuesTable.id, { onDelete: 'cascade' }),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  modified: timestamp({ withTimezone: true }).notNull().defaultNow(),
})

// Zod schemas for validation
export const selectUserSchema = createSelectSchema(usersTable)
export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
})

export const selectIssueSchema = createSelectSchema(issuesTable)
export const insertIssueSchema = createInsertSchema(issuesTable).omit({
  id: true,
  created_at: true,
  modified: true,
})

export const selectCommentSchema = createSelectSchema(commentsTable)
export const insertCommentSchema = createInsertSchema(commentsTable).omit({
  id: true,
  created_at: true,
  modified: true,
})

// TypeScript types
export type User = typeof usersTable.$inferSelect
export type InsertUser = typeof usersTable.$inferInsert
export type Issue = typeof issuesTable.$inferSelect
export type InsertIssue = typeof issuesTable.$inferInsert
export type Comment = typeof commentsTable.$inferSelect
export type InsertComment = typeof commentsTable.$inferInsert

export type Priority = 'none' | 'urgent' | 'high' | 'medium' | 'low'
export type Status = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
