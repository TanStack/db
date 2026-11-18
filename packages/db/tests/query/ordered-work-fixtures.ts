// Fixture helpers shared by ordered-work-oracle.property.test.ts and
// ordered-work-examples.test.ts. They drive no comparison.
import type { Row } from './ordered-work-support.js'

export function copiedRow(row: Row): Row {
  const copy: Record<string, unknown> = { ...row }
  for (const field of [`$key`, `$collectionId`, `$origin`, `$hasPendingWrites`])
    delete copy[field]
  return copy as Row
}
