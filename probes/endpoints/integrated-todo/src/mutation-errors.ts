import { z } from 'zod'

export const invalidInputResponse = z
  .object({
    kind: z.literal('not-started'),
    code: z.literal('INVALID_INPUT'),
    message: z.string(),
    issues: z
      .array(
        z
          .object({
            code: z.string(),
            // Paths are relative to the request: input fields start with "input".
            path: z.array(z.union([z.string(), z.number()])),
            message: z.string(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type InputValidationIssue = z.infer<
  typeof invalidInputResponse
>['issues'][number]

export class InvalidInputError extends Error {
  readonly code = 'INVALID_INPUT'
  readonly issues: InputValidationIssue[]

  constructor(message: string, issues: InputValidationIssue[]) {
    super(message)
    this.name = 'InvalidInputError'
    this.issues = issues
  }
}
