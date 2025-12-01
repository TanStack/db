import {
  integer,
  pgTable,
  timestamp,
  varchar,
  text,
  real,
} from "drizzle-orm/pg-core"
import { createSchemaFactory } from "drizzle-zod"
import { z } from "zod"
export * from "./auth-schema"
import { users } from "./auth-schema"

const { createInsertSchema, createSelectSchema, createUpdateSchema } =
  createSchemaFactory({ zodInstance: z })

// Board table - similar to Trellix's Board model
export const boardsTable = pgTable(`boards`, {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  color: varchar({ length: 20 }).notNull().default("#e0e0e0"),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
})

// Column table - similar to Trellix's Column model
export const columnsTable = pgTable(`columns`, {
  id: text("id").primaryKey(),
  name: varchar({ length: 255 }).notNull(),
  order: real().notNull().default(0),
  boardId: integer("board_id")
    .notNull()
    .references(() => boardsTable.id, { onDelete: "cascade" }),
})

// Item/Card table - similar to Trellix's Item model
export const itemsTable = pgTable(`items`, {
  id: text("id").primaryKey(),
  title: varchar({ length: 255 }).notNull(),
  content: text("content"),
  order: real().notNull(),
  columnId: text("column_id")
    .notNull()
    .references(() => columnsTable.id, { onDelete: "cascade" }),
  boardId: integer("board_id")
    .notNull()
    .references(() => boardsTable.id, { onDelete: "cascade" }),
})

// Board schemas
export const selectBoardSchema = createSelectSchema(boardsTable)
export const createBoardSchema = createInsertSchema(boardsTable).omit({
  createdAt: true,
})
export const updateBoardSchema = createUpdateSchema(boardsTable)

// Column schemas
export const selectColumnSchema = createSelectSchema(columnsTable)
export const createColumnSchema = createInsertSchema(columnsTable)
export const updateColumnSchema = createUpdateSchema(columnsTable)

// Item schemas
export const selectItemSchema = createSelectSchema(itemsTable)
export const createItemSchema = createInsertSchema(itemsTable)
export const updateItemSchema = createUpdateSchema(itemsTable)

// Types
export type Board = z.infer<typeof selectBoardSchema>
export type CreateBoard = z.infer<typeof createBoardSchema>
export type UpdateBoard = z.infer<typeof updateBoardSchema>

export type Column = z.infer<typeof selectColumnSchema>
export type CreateColumn = z.infer<typeof createColumnSchema>
export type UpdateColumn = z.infer<typeof updateColumnSchema>

export type Item = z.infer<typeof selectItemSchema>
export type CreateItem = z.infer<typeof createItemSchema>
export type UpdateItem = z.infer<typeof updateItemSchema>

export const selectUsersSchema = createSelectSchema(users)
