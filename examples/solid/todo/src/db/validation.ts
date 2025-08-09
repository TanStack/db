import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { z } from "zod"
import { config, todos } from "./schema"

// Date transformation schema - handles Date objects, ISO strings, and parseable date strings
const dateStringToDate = z
  .union([
    z.date(), // Already a Date object
    z
      .string()
      .datetime()
      .transform((str) => new Date(str)), // ISO datetime string
    z.string().transform((str) => new Date(str)), // Any parseable date string
  ])
  .optional()

// Auto-generated schemas from Drizzle schema with date transformation
export const insertTodoSchema = createInsertSchema(todos, {
  created_at: dateStringToDate,
  updated_at: dateStringToDate,
})
export const selectTodoSchema = createSelectSchema(todos)

// Partial schema for updates
export const updateTodoSchema = insertTodoSchema.partial().strict()

// Config schemas with date transformation
export const insertConfigSchema = createInsertSchema(config, {
  created_at: dateStringToDate,
  updated_at: dateStringToDate,
}).strict()
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
  const parsed = insertTodoSchema.parse(data)
  if (parsed.text === `really hard todo`) {
    throw new Error(`we don't want to do really hard todos`)
  }
  return parsed
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
