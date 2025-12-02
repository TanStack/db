import type { QueryIR, CollectionRef } from "../ir.js"
import { CollectionRef as CollectionRefClass } from "../ir.js"
import { CollectionImpl } from "../../collection/index.js"
import { QueryMustHaveFromClauseError } from "../../errors.js"
import { createRefProxy } from "../builder/ref-proxy.js"
import {
  isClauseResult,
  type Sources,
  type RefsFor,
  type QueryShape,
  type Query,
  type InferResult,
  type ShapeProcessor,
  type ShapeRegistry,
  type ProcessorContext,
} from "./types.js"

// =============================================================================
// Shape Processor Registry
// =============================================================================

/**
 * Registry for shape processors
 *
 * Core clauses (where, select, orderBy, limit, offset, distinct) use the registry.
 * Tree-shakable clauses (join, groupBy, having) use ClauseResult objects with
 * embedded processing logic - no registry lookup needed.
 */
class ShapeRegistryImpl implements ShapeRegistry {
  private processors = new Map<string, ShapeProcessor>()

  register(key: string, processor: ShapeProcessor): void {
    this.processors.set(key, processor)
  }

  /**
   * Explicit processing order for clauses.
   * This ensures deterministic behavior regardless of object key order.
   * Order matters: joins must be processed before where/select can reference joined columns.
   */
  private static readonly CLAUSE_ORDER = [
    "join", // First: establish all sources
    "where", // Then: filter conditions
    "groupBy", // Group results
    "having", // Filter groups
    "select", // Project columns
    "orderBy", // Sort results
    "distinct", // Remove duplicates
    "limit", // Pagination
    "offset",
  ]

  process(
    shape: QueryShape,
    ir: Partial<QueryIR>,
    context: ProcessorContext
  ): QueryIR {
    let result = { ...ir }

    // Process clauses in explicit order for deterministic behavior
    for (const key of ShapeRegistryImpl.CLAUSE_ORDER) {
      const value = (shape as Record<string, unknown>)[key]
      if (value === undefined) continue

      // Check if it's a ClauseResult (tree-shakable clause function)
      if (isClauseResult(value)) {
        // ClauseResult has its own process method - call it directly
        result = value.process(result, context) as Partial<QueryIR>
        continue
      }

      // Otherwise, use the registry for core processors
      const processor = this.processors.get(key)
      if (processor) {
        result = processor(key, value, result, context)
      } else {
        console.warn(`No processor registered for shape key: ${key}`)
      }
    }

    // Fail fast on unknown keys (catches typos and unsupported clauses)
    for (const key of Object.keys(shape)) {
      if (
        !ShapeRegistryImpl.CLAUSE_ORDER.includes(key) &&
        (shape as Record<string, unknown>)[key] !== undefined
      ) {
        throw new Error(
          `Unknown clause key: "${key}". ` +
            `Supported clauses: ${ShapeRegistryImpl.CLAUSE_ORDER.join(", ")}`
        )
      }
    }

    return result as QueryIR
  }
}

export const shapeRegistry: ShapeRegistry = new ShapeRegistryImpl()

// =============================================================================
// Core Shape Processors (always bundled)
// =============================================================================

// Where processor (WHERE clause)
shapeRegistry.register("where", (_key, value, ir, _context) => {
  const existingWhere = ir.where || []
  return {
    ...ir,
    where: [...existingWhere, value],
  }
})

// Select processor
shapeRegistry.register("select", (_key, value, ir, _context) => {
  // Convert select shape to IR format
  // For now, just pass through - the compiler will handle it
  return {
    ...ir,
    select: value,
  }
})

// OrderBy processor
shapeRegistry.register("orderBy", (_key, value, ir, _context) => {
  const orderByArray = Array.isArray(value) ? value : [value]
  const orderByClauses = orderByArray.map((item) => {
    if (item && typeof item === "object" && "expr" in item) {
      return {
        expression: item.expr,
        compareOptions: {
          direction: item.direction || "asc",
          nulls: item.nulls || "first",
        },
      }
    }
    return {
      expression: item,
      compareOptions: { direction: "asc" as const, nulls: "first" as const },
    }
  })

  const existingOrderBy = ir.orderBy || []
  return {
    ...ir,
    orderBy: [...existingOrderBy, ...orderByClauses],
  }
})

// Limit processor
shapeRegistry.register("limit", (_key, value, ir, _context) => ({
  ...ir,
  limit: value,
}))

// Offset processor
shapeRegistry.register("offset", (_key, value, ir, _context) => ({
  ...ir,
  offset: value,
}))

// Distinct processor
shapeRegistry.register("distinct", (_key, value, ir, _context) => ({
  ...ir,
  distinct: value,
}))

// =============================================================================
// Query Function - The Main API
// =============================================================================

/**
 * query - EdgeDB-style query builder
 *
 * First argument establishes type context (sources).
 * Second argument is a shape callback that receives typed refs.
 *
 * @example Basic query
 * ```ts
 * import { query } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * const q = query(
 *   { users: usersCollection },
 *   ({ users }) => ({
 *     where: eq(users.active, true),
 *     select: { name: users.name },
 *     orderBy: users.createdAt,
 *     limit: 10
 *   })
 * )
 * ```
 *
 * @example With tree-shakable clauses (join, groupBy, having)
 * ```ts
 * import { query, join } from '@tanstack/db/query/functional'
 * import { eq } from '@tanstack/db'
 *
 * // All sources (including joined tables) go in first argument
 * const q = query(
 *   { users: usersCollection, posts: postsCollection },
 *   ({ users, posts }) => ({
 *     join: join({
 *       posts: { on: eq(posts.authorId, users.id), type: 'left' }
 *     }),
 *     where: eq(users.active, true),
 *     select: { name: users.name, title: posts.title }
 *   })
 * )
 * ```
 *
 * Type inference works because:
 * 1. First arg `{ users: usersCollection }` has type `{ users: Collection<User> }`
 * 2. TypeScript infers callback parameter as `{ users: RefProxy<User> }`
 * 3. Callback return type is inferred from the shape
 */
export function query<
  TSources extends Sources,
  TShape extends QueryShape<any>
>(
  sources: TSources,
  shapeCallback: (refs: RefsFor<TSources>) => TShape
): Query<InferResult<TSources, TShape>> {
  // Create ref proxies for each source
  const aliases = Object.keys(sources)
  const refs = createRefProxy(aliases) as RefsFor<TSources>

  // Execute the callback to get the shape
  const shape = shapeCallback(refs)

  return {
    _sources: sources,
    _shape: shape,
    _result: undefined as any, // Phantom type
  }
}

/**
 * compileQuery - Compiles a functional query to IR
 *
 * This bridges the functional API to the existing query compiler.
 */
export function compileQuery<TResult>(q: Query<TResult>): QueryIR {
  const { _sources: sources, _shape: shape } = q

  // Build FROM clause from sources
  const sourceEntries = Object.entries(sources)
  if (sourceEntries.length === 0) {
    throw new QueryMustHaveFromClauseError()
  }

  // For now, support single source (first one is the FROM)
  const [mainAlias, mainCollection] = sourceEntries[0]!

  // Check if it's a collection-like object (has the required properties)
  if (!mainCollection || typeof mainCollection !== "object") {
    throw new Error(`Invalid source: ${mainAlias} is not a Collection`)
  }

  const fromRef: CollectionRef = new CollectionRefClass(
    mainCollection as CollectionImpl,
    mainAlias
  )

  // Start with FROM in IR
  let ir: Partial<QueryIR> = {
    from: fromRef,
  }

  // Process the shape through the registry
  const context: ProcessorContext = {
    sources,
    aliases: Object.keys(sources),
  }

  return shapeRegistry.process(shape, ir, context)
}

/**
 * getQueryIR - Alias for compileQuery for compatibility
 */
export function getQueryIR<TResult>(q: Query<TResult>): QueryIR {
  return compileQuery(q)
}
