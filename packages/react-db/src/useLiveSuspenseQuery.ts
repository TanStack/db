import { useRef } from "react"
import { useLiveQuery } from "./useLiveQuery"
import type {
  Collection,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  LiveQueryCollectionConfig,
  NonSingleResult,
  QueryBuilder,
  SingleResult,
} from "@tanstack/db"

/**
 * Create a live query with React Suspense support
 * @param queryFn - Query function that defines what data to fetch
 * @param deps - Array of dependencies that trigger query re-execution when changed
 * @returns Object with reactive data and state - data is guaranteed to be defined
 * @throws Promise when data is loading (caught by Suspense boundary)
 * @throws Error when collection fails (caught by Error boundary)
 * @example
 * // Basic usage with Suspense
 * function TodoList() {
 *   const { data } = useLiveSuspenseQuery((q) =>
 *     q.from({ todos: todosCollection })
 *      .where(({ todos }) => eq(todos.completed, false))
 *      .select(({ todos }) => ({ id: todos.id, text: todos.text }))
 *   )
 *
 *   return (
 *     <ul>
 *       {data.map(todo => <li key={todo.id}>{todo.text}</li>)}
 *     </ul>
 *   )
 * }
 *
 * function App() {
 *   return (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <TodoList />
 *     </Suspense>
 *   )
 * }
 *
 * @example
 * // Single result query
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => eq(todos.id, 1))
 *          .findOne()
 * )
 * // data is guaranteed to be the single item (or undefined if not found)
 *
 * @example
 * // With dependencies that trigger re-suspension
 * const { data } = useLiveSuspenseQuery(
 *   (q) => q.from({ todos: todosCollection })
 *          .where(({ todos }) => gt(todos.priority, minPriority)),
 *   [minPriority] // Re-suspends when minPriority changes
 * )
 *
 * @example
 * // With Error boundary
 * function App() {
 *   return (
 *     <ErrorBoundary fallback={<div>Error loading data</div>}>
 *       <Suspense fallback={<div>Loading...</div>}>
 *         <TodoList />
 *       </Suspense>
 *     </ErrorBoundary>
 *   )
 * }
 */
// Overload 1: Accept query function that always returns QueryBuilder
export function useLiveSuspenseQuery<TContext extends Context>(
  queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 2: Accept config object
export function useLiveSuspenseQuery<TContext extends Context>(
  config: LiveQueryCollectionConfig<TContext>,
  deps?: Array<unknown>
): {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
}

// Overload 3: Accept pre-created live query collection
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & NonSingleResult
): {
  state: Map<TKey, TResult>
  data: Array<TResult>
  collection: Collection<TResult, TKey, TUtils>
}

// Overload 4: Accept pre-created live query collection with singleResult: true
export function useLiveSuspenseQuery<
  TResult extends object,
  TKey extends string | number,
  TUtils extends Record<string, any>,
>(
  liveQueryCollection: Collection<TResult, TKey, TUtils> & SingleResult
): {
  state: Map<TKey, TResult>
  data: TResult | undefined
  collection: Collection<TResult, TKey, TUtils> & SingleResult
}

// Implementation - uses useLiveQuery internally and adds Suspense logic
export function useLiveSuspenseQuery(
  configOrQueryOrCollection: any,
  deps: Array<unknown> = []
) {
  const promiseRef = useRef<Promise<void> | null>(null)

  // Use useLiveQuery to handle collection management and reactivity
  const result = useLiveQuery(configOrQueryOrCollection, deps)

  // SUSPENSE LOGIC: Throw promise or error based on collection status
  if (result.status === `disabled`) {
    // Suspense queries cannot be disabled - throw error
    throw new Error(
      `useLiveSuspenseQuery does not support disabled queries. Use useLiveQuery instead for conditional queries.`
    )
  }

  if (result.status === `error`) {
    // Clear promise and throw error to Error Boundary
    promiseRef.current = null
    throw new Error(`Collection "${result.collection.id}" failed to load`)
  }

  if (result.status === `loading` || result.status === `idle`) {
    // Create or reuse promise
    if (!promiseRef.current) {
      promiseRef.current = result.collection.preload()
    }
    // THROW PROMISE - React Suspense catches this (React 18+ compatible)
    throw promiseRef.current
  }

  // Collection is ready - clear promise
  if (result.status === `ready`) {
    promiseRef.current = null
  }

  // Return data without status/loading flags (handled by Suspense/ErrorBoundary)
  return {
    state: result.state,
    data: result.data,
    collection: result.collection,
  }
}
