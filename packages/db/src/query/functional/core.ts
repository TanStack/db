import type { QueryIR } from "../ir.js"
import { QueryMustHaveFromClauseError } from "../../errors.js"
import type {
  AnyClause,
  ClauseCompiler,
  ClauseRegistry,
  Query,
  InferQueryContext,
} from "./types.js"

/**
 * Global registry for clause compilers
 *
 * This implements the auto-registration pattern:
 * - Each clause file registers its compiler when imported
 * - The registry maps clause types to their compiler functions
 * - Tree-shaking: unused clauses aren't imported, so unused compilers aren't bundled
 */
class ClauseRegistryImpl implements ClauseRegistry {
  private compilers = new Map<string, ClauseCompiler>()

  register(clauseType: string, compiler: ClauseCompiler): void {
    this.compilers.set(clauseType, compiler)
  }

  compile(clauses: ReadonlyArray<AnyClause>): QueryIR {
    let ir: Partial<QueryIR> = {}
    let runtimeContext: any = {}

    // Process clauses in order, building up the IR
    for (const clause of clauses) {
      const compiler = this.compilers.get(clause.clauseType)
      if (!compiler) {
        throw new Error(`No compiler registered for clause type: ${clause.clauseType}`)
      }

      // Each compiler transforms the IR and can access the runtime context
      ir = compiler(clause as any, ir, runtimeContext)

      // Update runtime context based on clause type
      if (clause.clauseType === "from") {
        runtimeContext = {
          ...runtimeContext,
          from: ir.from,
        }
      }
    }

    // Validate that we have a FROM clause
    if (!ir.from) {
      throw new QueryMustHaveFromClauseError()
    }

    return ir as QueryIR
  }
}

// Global singleton registry
export const registry: ClauseRegistry = new ClauseRegistryImpl()

/**
 * query - Composes multiple clauses into a query
 *
 * This is the main entry point for the functional API.
 * It takes a variable number of clauses and composes them into a query.
 *
 * Type inference works through the clause chain:
 * - FROM clause establishes the base schema
 * - WHERE/SELECT clauses see the schema from FROM
 * - SELECT clause establishes the result type
 *
 * @example
 * ```ts
 * const q = query(
 *   from({ users: usersCollection }),
 *   where(({ users }) => eq(users.active, true)),
 *   select(({ users }) => ({ name: users.name }))
 * )
 * ```
 */
export function query<TClauses extends ReadonlyArray<AnyClause>>(
  ...clauses: TClauses
): Query<InferQueryContext<TClauses>> {
  return {
    clauses,
    _context: undefined as any, // Type-level only
  }
}

/**
 * compileQuery - Compiles a functional query to IR
 *
 * This is the bridge between the functional API and the existing compiler.
 * It uses the clause registry to convert functional clauses to IR.
 *
 * @param query - The functional query to compile
 * @returns QueryIR that can be executed by the existing query engine
 */
export function compileQuery(query: Query<any>): QueryIR {
  return registry.compile(query.clauses)
}

/**
 * getQueryIR - Alias for compileQuery for compatibility
 */
export function getQueryIR(query: Query<any>): QueryIR {
  return compileQuery(query)
}
