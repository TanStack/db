import type { z } from 'zod'

// Validate before loading the registry or entering application code. Only this
// pre-handler boundary can prove that a validation error caused no writes.
export function validateMutationRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
) {
  const parsed = schema.safeParse(value)
  if (parsed.success) return { success: true as const, data: parsed.data }
  return {
    success: false as const,
    response: {
      kind: 'not-started' as const,
      code: 'INVALID_INPUT' as const,
      message: 'Invalid mutation input',
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map((part) =>
          typeof part === 'symbol' ? String(part) : part,
        ),
        message: issue.message,
      })),
    },
  }
}
