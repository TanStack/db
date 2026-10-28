// Shared by the local write ordering oracle and its ordinary tests: the durable
// row set before any local handler decides.
import type { Row } from './harness'

export const initial: Array<Row> = [
  { id: 1, name: 'initial' },
  { id: 2, name: 'anchor' },
]
