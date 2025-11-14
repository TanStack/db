import { createHasuraDialect } from "./hasura"
import { createPostGraphileDialect } from "./postgraphile"
import { createPrismaDialect } from "./prisma"
import type { DialectAdapter } from "./base"
import type { GraphQLDialect } from "../../types"

export * from "./base"
export * from "./hasura"
export * from "./postgraphile"
export * from "./prisma"

/**
 * Create a dialect adapter based on the dialect name
 */
export function createDialectAdapter(dialect: GraphQLDialect): DialectAdapter {
  switch (dialect) {
    case `hasura`:
      return createHasuraDialect()
    case `postgraphile`:
      return createPostGraphileDialect()
    case `prisma`:
      return createPrismaDialect()
    case `generic`:
      // Generic dialect - use Hasura-style as default
      return createHasuraDialect()
    default:
      throw new Error(`Unknown dialect: ${dialect}`)
  }
}
