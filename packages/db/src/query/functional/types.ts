import type { BasicExpression, QueryIR } from "../ir.js"
import type {
  SchemaFromSource,
  Source,
} from "../builder/types.js"

/**
 * Functional query API types
 *
 * These types enable tree-shakable query building through function composition
 * instead of method chaining.
 */

/**
 * Context - Carries type information through the functional query pipeline
 *
 * Similar to the builder Context, but adapted for functional composition.
 * Each clause function transforms the context to flow types through.
 */
export interface Context {
  baseSchema: ContextSchema
  schema: ContextSchema
  fromSourceName: string
  hasJoins?: boolean
  result?: any
}

export type ContextSchema = Record<string, unknown>

/**
 * Clause - Base type for all query clauses
 *
 * Each clause is a tagged object that carries:
 * - clauseType: Identifies what kind of clause this is
 * - compile: Function to convert this clause to IR
 * - context: Type-level only - carries Context through the type system
 */
export interface Clause<
  TClauseType extends string = string,
  TContext extends Context = Context,
> {
  readonly clauseType: TClauseType
  readonly _context?: TContext // Type-level only, used for inference
}

/**
 * FromClause - Represents a FROM clause
 */
export interface FromClause<TSource extends Source>
  extends Clause<"from", FromContext<TSource>> {
  readonly source: TSource
}

/**
 * FromContext - Context after a FROM clause
 */
export type FromContext<TSource extends Source> = {
  baseSchema: SchemaFromSource<TSource>
  schema: SchemaFromSource<TSource>
  fromSourceName: keyof TSource & string
  hasJoins: false
}

/**
 * WhereClause - Represents a WHERE clause
 */
export interface WhereClause<TContext extends Context>
  extends Clause<"where", TContext> {
  readonly callback: (refs: any) => BasicExpression<boolean>
}

/**
 * SelectClause - Represents a SELECT clause
 */
export interface SelectClause<TContext extends Context, TResult>
  extends Clause<"select", WithResult<TContext, TResult>> {
  readonly callback: (refs: any) => any
}

/**
 * WithResult - Helper to add result type to context
 */
export type WithResult<TContext extends Context, TResult> = Omit<
  TContext,
  "result"
> & {
  result: TResult
}

/**
 * AnyClause - Union of all possible clause types
 */
export type AnyClause = FromClause<any> | WhereClause<any> | SelectClause<any, any>

/**
 * ExtractContext - Extracts the Context type from a Clause
 */
export type ExtractContext<T> = T extends Clause<any, infer TContext>
  ? TContext
  : never

/**
 * Query - Represents a complete query built from clauses
 */
export interface Query<TContext extends Context = Context> {
  readonly clauses: ReadonlyArray<AnyClause>
  readonly _context?: TContext // Type-level only
}

/**
 * ClauseCompiler - Function that compiles a clause to IR
 */
export type ClauseCompiler<TClauseType extends string = string> = (
  clause: Clause<TClauseType>,
  query: Partial<QueryIR>,
  context: any
) => Partial<QueryIR>

/**
 * ClauseRegistry - Registry of clause compilers
 */
export interface ClauseRegistry {
  register(clauseType: string, compiler: ClauseCompiler): void
  compile(clauses: ReadonlyArray<AnyClause>): QueryIR
}

/**
 * InferQueryContext - Infers the final context from a list of clauses
 *
 * This walks through clauses in reverse order and accumulates the context type.
 * The last clause's context is the final context (since each clause sees the previous context).
 */
export type InferQueryContext<TClauses extends ReadonlyArray<AnyClause>> =
  TClauses extends readonly [...any, infer Last]
    ? Last extends AnyClause
      ? ExtractContext<Last>
      : Context
    : Context

/**
 * GetResult - Gets the result type from a context
 */
export type GetResult<TContext extends Context> = TContext["result"] extends object
  ? TContext["result"]
  : TContext["schema"][TContext["fromSourceName"]]
