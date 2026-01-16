/**
 * Multi-Shape Electric Collection
 *
 * This module provides an architecture where a single Electric collection
 * manages multiple ShapeStreams internally. Instead of loading subsets
 * within a single shape (which still receives all updates), this approach
 * creates separate shapes per query filter - each receiving only relevant updates.
 *
 * Key benefits:
 * - Large tables with high update volume only send relevant updates per shape
 * - Shapes are automatically created/deduped/GC'd based on query lifecycle
 * - Security boundary enforced: child shapes must be subsets of parent shape definition
 *
 * Constraints:
 * - Electric shapes only support WHERE clauses (not LIMIT/ORDER BY)
 * - LIMIT/ORDER BY remain client-side operations
 */

import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client'
import { Store } from '@tanstack/store'
import DebugModule from 'debug'
import type {
  Message,
  Row,
  ShapeStreamOptions,
} from '@electric-sql/client'
import type {
  LoadSubsetOptions,
  SyncConfig,
} from '@tanstack/db'
import type { IR } from '@tanstack/db'

const debug = DebugModule.debug(`ts/db:electric:multi-shape`)

/**
 * Represents a managed shape with reference counting and lifecycle
 */
interface ManagedShape<T extends Row<unknown>> {
  /** The ShapeStream instance */
  stream: ShapeStream<T>
  /** Number of active references (queries using this shape) */
  refCount: number
  /** The normalized where clause that defines this shape */
  whereClause: string
  /** Unsubscribe function for the stream */
  unsubscribe?: () => void
  /** GC timeout ID if shape is pending cleanup */
  gcTimeoutId?: ReturnType<typeof setTimeout>
  /** Keys that have been synced from this shape */
  syncedKeys: Set<string | number>
}

/**
 * Configuration for the ShapeManager
 */
export interface ShapeManagerConfig<T extends Row<unknown>> {
  /** Base shape options - defines the security boundary */
  baseShapeOptions: ShapeStreamOptions<T>
  /** Collection ID for debugging */
  collectionId?: string
  /** GC time in ms before unused shapes are cleaned up */
  gcTime?: number
  /** Function to get the primary key from a row */
  getKey: (row: T) => string | number
}

/**
 * Callbacks for handling shape data
 */
export interface ShapeCallbacks<T extends Row<unknown>> {
  begin: () => void
  write: (message: { type: 'insert' | 'update' | 'delete'; value: T; metadata?: Record<string, unknown> }) => void
  commit: () => void
  markReady: () => void
  truncate: () => void
}

/**
 * Manages multiple ShapeStreams for a single collection.
 *
 * Shapes are created lazily when queries request them and cleaned up
 * after a GC period when no queries reference them.
 */
export class ShapeManager<T extends Row<unknown>> {
  private shapes = new Map<string, ManagedShape<T>>()
  private config: Required<ShapeManagerConfig<T>>
  private callbacks: ShapeCallbacks<T> | null = null
  private abortController: AbortController | null = null

  // Track all synced keys across all shapes to handle overlapping data
  private globalSyncedKeys = new Set<string | number>()

  // Store for tracking ready state per shape
  private readyShapes = new Store<Set<string>>(new Set())

  constructor(config: ShapeManagerConfig<T>) {
    this.config = {
      gcTime: 5000,
      collectionId: undefined,
      ...config,
    }
  }

  /**
   * Initialize the manager with sync callbacks
   */
  initialize(callbacks: ShapeCallbacks<T>): () => void {
    this.callbacks = callbacks
    this.abortController = new AbortController()

    return () => {
      // Cleanup all shapes
      this.abortController?.abort()
      this.shapes.forEach((shape) => {
        if (shape.gcTimeoutId) {
          clearTimeout(shape.gcTimeoutId)
        }
        shape.unsubscribe?.()
      })
      this.shapes.clear()
      this.globalSyncedKeys.clear()
      this.readyShapes.setState(() => new Set())
      this.callbacks = null
    }
  }

  /**
   * Acquire a shape for the given where clause.
   * Creates a new shape if one doesn't exist, otherwise increments refCount.
   *
   * @param whereClause - SQL WHERE clause (must be subset of base shape's where)
   * @returns Promise that resolves when initial data is loaded
   */
  async acquireShape(whereClause: string): Promise<void> {
    const key = this.normalizeWhereClause(whereClause)

    const existing = this.shapes.get(key)
    if (existing) {
      existing.refCount++
      if (existing.gcTimeoutId) {
        clearTimeout(existing.gcTimeoutId)
        existing.gcTimeoutId = undefined
      }
      debug(
        `${this.logPrefix}Reusing shape for where="${key}", refCount=${existing.refCount}`
      )

      // Wait for shape to be ready if not already
      if (!this.readyShapes.state.has(key)) {
        await this.waitForShapeReady(key)
      }
      return
    }

    // Create new shape
    debug(`${this.logPrefix}Creating new shape for where="${key}"`)

    const combinedWhere = this.combineWhereClauses(
      this.config.baseShapeOptions.params?.where,
      whereClause
    )

    const stream = new ShapeStream<T>({
      ...this.config.baseShapeOptions,
      params: {
        ...this.config.baseShapeOptions.params,
        where: combinedWhere,
      },
      signal: this.abortController?.signal,
    })

    const managedShape: ManagedShape<T> = {
      stream,
      refCount: 1,
      whereClause: key,
      syncedKeys: new Set(),
    }

    this.shapes.set(key, managedShape)

    // Subscribe to shape updates
    managedShape.unsubscribe = this.subscribeToShape(managedShape, key)

    // Wait for initial data
    await this.waitForShapeReady(key)
  }

  /**
   * Release a shape reference.
   * Schedules GC if refCount reaches 0.
   */
  releaseShape(whereClause: string): void {
    const key = this.normalizeWhereClause(whereClause)
    const shape = this.shapes.get(key)

    if (!shape) {
      debug(`${this.logPrefix}Attempted to release unknown shape: ${key}`)
      return
    }

    shape.refCount--
    debug(
      `${this.logPrefix}Released shape for where="${key}", refCount=${shape.refCount}`
    )

    if (shape.refCount === 0) {
      // Schedule GC
      shape.gcTimeoutId = setTimeout(() => {
        debug(`${this.logPrefix}GC'ing shape for where="${key}"`)
        shape.unsubscribe?.()
        this.shapes.delete(key)
        this.readyShapes.setState((ready) => {
          const newReady = new Set(ready)
          newReady.delete(key)
          return newReady
        })
      }, this.config.gcTime)
    }
  }

  /**
   * Subscribe to a shape's message stream
   */
  private subscribeToShape(shape: ManagedShape<T>, key: string): () => void {
    if (!this.callbacks) {
      throw new Error('ShapeManager not initialized')
    }

    const { begin, write, commit, markReady } = this.callbacks
    let transactionStarted = false

    return shape.stream.subscribe((messages: Array<Message<T>>) => {
      let shouldCommit = false

      for (const message of messages) {
        if (isChangeMessage(message)) {
          const rowKey = this.config.getKey(message.value)
          const operation = message.headers.operation

          // Handle overlapping shapes: convert insert to update if key exists
          const isDuplicateInsert =
            operation === 'insert' && this.globalSyncedKeys.has(rowKey)

          if (!transactionStarted) {
            begin()
            transactionStarted = true
          }

          if (operation === 'delete') {
            // Only delete if no other shape has this key
            // For now, simple approach: always delete, let collection handle
            shape.syncedKeys.delete(rowKey)
            this.updateGlobalSyncedKeys()
            write({
              type: 'delete',
              value: message.value,
              metadata: message.headers as Record<string, unknown>,
            })
          } else {
            shape.syncedKeys.add(rowKey)
            this.globalSyncedKeys.add(rowKey)
            write({
              type: isDuplicateInsert ? 'update' : operation,
              value: message.value,
              metadata: message.headers as Record<string, unknown>,
            })
          }
        } else if (isControlMessage(message)) {
          if (message.headers.control === 'up-to-date') {
            shouldCommit = true

            // Mark this shape as ready
            this.readyShapes.setState((ready) => {
              const newReady = new Set(ready)
              newReady.add(key)
              return newReady
            })
          } else if (message.headers.control === 'must-refetch') {
            debug(`${this.logPrefix}Shape "${key}" received must-refetch`)
            // Clear this shape's synced keys
            shape.syncedKeys.clear()
            this.updateGlobalSyncedKeys()
          }
        }
      }

      if (shouldCommit && transactionStarted) {
        commit()
        transactionStarted = false

        // Check if all shapes are ready
        if (this.allShapesReady()) {
          markReady()
        }
      }
    })
  }

  /**
   * Update global synced keys from all shapes
   */
  private updateGlobalSyncedKeys(): void {
    this.globalSyncedKeys.clear()
    this.shapes.forEach((shape) => {
      shape.syncedKeys.forEach((key) => this.globalSyncedKeys.add(key))
    })
  }

  /**
   * Check if all active shapes are ready
   */
  private allShapesReady(): boolean {
    for (const [key] of this.shapes) {
      if (!this.readyShapes.state.has(key)) {
        return false
      }
    }
    return true
  }

  /**
   * Wait for a specific shape to become ready
   */
  private waitForShapeReady(key: string): Promise<void> {
    if (this.readyShapes.state.has(key)) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const unsubscribe = this.readyShapes.subscribe(() => {
        if (this.readyShapes.state.has(key)) {
          unsubscribe()
          resolve()
        }
      })
    })
  }

  /**
   * Combine parent and child WHERE clauses
   */
  private combineWhereClauses(
    parent: string | undefined,
    child: string
  ): string {
    if (!parent || parent.trim() === '' || parent.trim() === 'true = true') {
      return child
    }
    if (!child || child.trim() === '' || child.trim() === 'true = true') {
      return parent
    }
    return `(${parent}) AND (${child})`
  }

  /**
   * Normalize a WHERE clause for use as a map key
   */
  private normalizeWhereClause(whereClause: string): string {
    // Simple normalization: trim and lowercase
    // In production, would want more sophisticated normalization
    return whereClause.trim()
  }

  private get logPrefix(): string {
    return this.config.collectionId ? `[${this.config.collectionId}] ` : ''
  }

  /**
   * Get current shape count (for debugging/metrics)
   */
  get shapeCount(): number {
    return this.shapes.size
  }

  /**
   * Get active shape count (refCount > 0)
   */
  get activeShapeCount(): number {
    let count = 0
    this.shapes.forEach((shape) => {
      if (shape.refCount > 0) count++
    })
    return count
  }
}

/**
 * Extract a pushable WHERE clause from a query IR expression.
 *
 * Only simple predicates that Electric supports can be pushed:
 * - Column = value
 * - Column IN (values)
 * - Column > / < / >= / <= value
 * - AND of pushable predicates
 *
 * Complex expressions (joins, subqueries, functions) remain client-side.
 */
export function extractPushableWhere(
  expression: IR.BasicExpression<boolean> | undefined
): { pushable: string | null; remaining: IR.BasicExpression<boolean> | null } {
  if (!expression) {
    return { pushable: null, remaining: null }
  }

  // For now, return simple implementation
  // Full implementation would analyze the IR and split predicates
  if (expression.type === 'func' && canPushFunction(expression)) {
    return {
      pushable: compileExpressionToSQL(expression),
      remaining: null,
    }
  }

  // If AND, try to extract pushable parts
  if (expression.type === 'func' && expression.name === 'and') {
    const pushableParts: string[] = []
    const remainingParts: IR.BasicExpression<boolean>[] = []

    for (const arg of expression.args as IR.BasicExpression<boolean>[]) {
      const { pushable, remaining } = extractPushableWhere(arg)
      if (pushable) {
        pushableParts.push(pushable)
      }
      if (remaining) {
        remainingParts.push(remaining)
      }
    }

    return {
      pushable: pushableParts.length > 0 ? pushableParts.join(' AND ') : null,
      remaining:
        remainingParts.length > 0
          ? remainingParts.length === 1
            ? remainingParts[0]!
            : { type: 'func', name: 'and', args: remainingParts }
          : null,
    }
  }

  // Can't push - return as remaining
  return { pushable: null, remaining: expression }
}

/**
 * Check if a function expression can be pushed to Electric shape
 */
function canPushFunction(expr: IR.Func<unknown>): boolean {
  const pushableOps = ['eq', 'gt', 'gte', 'lt', 'lte', 'in', 'and', 'or']

  if (!pushableOps.includes(expr.name)) {
    return false
  }

  // Check that all arguments are either values or simple column refs
  for (const arg of expr.args) {
    if (arg.type === 'func') {
      // Nested function - only allow if it's also pushable
      if (!canPushFunction(arg as IR.Func<unknown>)) {
        return false
      }
    } else if (arg.type === 'ref') {
      // Column reference - must be simple (single level, no alias traversal)
      if (arg.path.length !== 1) {
        return false
      }
    }
    // 'val' type is always pushable
  }

  return true
}

/**
 * Compile a pushable IR expression to SQL
 */
function compileExpressionToSQL(expr: IR.BasicExpression<unknown>): string {
  switch (expr.type) {
    case 'val':
      return formatSQLValue(expr.value)
    case 'ref':
      return `"${expr.path[0]}"`
    case 'func':
      return compileFunctionToSQL(expr as IR.Func<unknown>)
    default:
      throw new Error(`Unknown expression type: ${(expr as any).type}`)
  }
}

function compileFunctionToSQL(expr: IR.Func<unknown>): string {
  const opMap: Record<string, string> = {
    eq: '=',
    gt: '>',
    gte: '>=',
    lt: '<',
    lte: '<=',
    and: 'AND',
    or: 'OR',
    in: '= ANY',
  }

  const op = opMap[expr.name]
  if (!op) {
    throw new Error(`Unsupported operator: ${expr.name}`)
  }

  const compiledArgs = expr.args.map((arg) =>
    compileExpressionToSQL(arg as IR.BasicExpression<unknown>)
  )

  if (expr.name === 'and' || expr.name === 'or') {
    return compiledArgs.map((a) => `(${a})`).join(` ${op} `)
  }

  if (expr.name === 'in') {
    return `${compiledArgs[0]} ${op}(${compiledArgs[1]})`
  }

  return `${compiledArgs[0]} ${op} ${compiledArgs[1]}`
}

function formatSQLValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'string') {
    // Escape single quotes
    return `'${value.replace(/'/g, "''")}'`
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (Array.isArray(value)) {
    return `ARRAY[${value.map(formatSQLValue).join(',')}]`
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`
  }
  return String(value)
}

/**
 * Configuration for multi-shape electric collection
 */
export interface MultiShapeElectricConfig<T extends Row<unknown>> {
  /** Base shape options - defines the security boundary (max allowed shape) */
  shapeOptions: ShapeStreamOptions<T>
  /** Collection ID */
  id?: string
  /** GC time for unused shapes */
  shapeGcTime?: number
  /** Function to get primary key from row */
  getKey: (row: T) => string | number
}

/**
 * Create a sync config that uses multi-shape management.
 *
 * Instead of a single shape with subset loading, this creates
 * separate shapes per unique WHERE clause derived from queries.
 */
export function createMultiShapeSync<T extends Row<unknown>>(
  config: MultiShapeElectricConfig<T>
): SyncConfig<T> {
  const shapeManager = new ShapeManager<T>({
    baseShapeOptions: config.shapeOptions,
    collectionId: config.id,
    gcTime: config.shapeGcTime ?? 5000,
    getKey: config.getKey,
  })

  return {
    sync: (params) => {
      const cleanup = shapeManager.initialize({
        begin: params.begin,
        write: (msg) => params.write(msg),
        commit: params.commit,
        markReady: params.markReady,
        truncate: params.truncate,
      })

      return {
        cleanup,
        /**
         * Load a subset by creating/acquiring a shape for the where clause.
         * The where clause is compiled from the LoadSubsetOptions.
         */
        loadSubset: async (options: LoadSubsetOptions) => {
          // Compile the where clause from LoadSubsetOptions
          // Note: limit/orderBy cannot be pushed to shapes
          const whereSQL = options.where
            ? compileExpressionToSQL(options.where)
            : 'true = true'

          await shapeManager.acquireShape(whereSQL)
        },
        /**
         * Unload a subset by releasing the shape reference.
         */
        unloadSubset: (options: LoadSubsetOptions) => {
          const whereSQL = options.where
            ? compileExpressionToSQL(options.where)
            : 'true = true'

          shapeManager.releaseShape(whereSQL)
        },
      }
    },
  }
}
