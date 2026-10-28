import type { CompareOptions } from '../src/query/builder/types'

// Ascending locale and lexical option sets shared by the comparison oracle and
// its ordinary tests.
export const defaultOpts = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `locale`,
} satisfies CompareOptions

export const lexicalOpts = {
  direction: `asc`,
  nulls: `first`,
  stringSort: `lexical`,
} satisfies CompareOptions
