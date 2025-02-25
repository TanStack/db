import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { todos } from "./schema"
import { z } from "zod"

// Auto-generated schemas from Drizzle schema
export const insertTodoSchema = createInsertSchema(todos)
export const selectTodoSchema = createSelectSchema(todos)

// Partial schema for updates
export const updateTodoSchema = insertTodoSchema.partial()

// Type inference
export type InsertTodo = z.infer<typeof insertTodoSchema>
export type SelectTodo = z.infer<typeof selectTodoSchema>
export type UpdateTodo = z.infer<typeof updateTodoSchema>

// Validation functions
export const validateInsertTodo = (data: unknown): InsertTodo => {
  return insertTodoSchema.parse(data)
}

export const validateSelectTodo = (data: unknown): SelectTodo => {
  return selectTodoSchema.parse(data)
}

export const validateUpdateTodo = (data: unknown): UpdateTodo => {
  return updateTodoSchema.parse(data)
}

// Safe parsing functions that return Result type instead of throwing
export const safeParseInsertTodo = (data: unknown) => {
  return insertTodoSchema.safeParse(data)
}

export const safeParseSelectTodo = (data: unknown) => {
  return selectTodoSchema.safeParse(data)
}

export const safeParseUpdateTodo = (data: unknown) => {
  return updateTodoSchema.safeParse(data)
}
