import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { config, todos } from "./schema"
import type { z } from "zod"

// Auto-generated schemas from Drizzle schema
export const insertTodoSchema = createInsertSchema(todos)
export const selectTodoSchema = createSelectSchema(todos)

// Partial schema for updates
export const updateTodoSchema = insertTodoSchema.partial().strict()

// Config schemas
export const insertConfigSchema = createInsertSchema(config).strict()
export const selectConfigSchema = createSelectSchema(config)
export const updateConfigSchema = insertConfigSchema.partial().strict()

// Type inference
export type InsertTodo = z.infer<typeof insertTodoSchema>
export type SelectTodo = z.infer<typeof selectTodoSchema>
export type UpdateTodo = z.infer<typeof updateTodoSchema>

export type InsertConfig = z.infer<typeof insertConfigSchema>
export type SelectConfig = z.infer<typeof selectConfigSchema>
export type UpdateConfig = z.infer<typeof updateConfigSchema>

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

export const validateInsertConfig = (data: unknown): InsertConfig => {
  return insertConfigSchema.parse(data)
}

export const validateSelectConfig = (data: unknown): SelectConfig => {
  return selectConfigSchema.parse(data)
}

export const validateUpdateConfig = (data: unknown): UpdateConfig => {
  return updateConfigSchema.parse(data)
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

export const safeParseInsertConfig = (data: unknown) => {
  return insertConfigSchema.safeParse(data)
}

export const safeParseSelectConfig = (data: unknown) => {
  return selectConfigSchema.safeParse(data)
}

export const safeParseUpdateConfig = (data: unknown) => {
  return updateConfigSchema.safeParse(data)
}
