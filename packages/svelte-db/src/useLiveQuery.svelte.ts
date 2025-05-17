import { compileQuery, queryBuilder } from "@tanstack/db"
import type {
  Collection,
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/db"

export interface UseLiveQueryReturn<T extends object> {
  state: Map<string, T>
  data: Array<T>
  collection: Collection<T>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>,
  deps: Array<() => unknown> = []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = $derived.by(() => {
    // Just reference deps to make derived reactive to them
    deps.forEach((dep) => dep())

    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()
    return compiled
  })

  // TODO: Svelte useStore needs to be updated to optionally
  // receive a getter to receive updates from compiledQuery.
  // For now, doing this should work and be reactive with updates.
  const state = () => compiledQuery.results.derivedState.state
  const data = () => compiledQuery.results.derivedArray.state

  $effect(() => {
    return () => {
      compiledQuery.stop()
    }
  })

  return {
    get state() {
      return state()
    },
    get data() {
      return data()
    },
    get collection() {
      return compiledQuery.results as unknown as Collection<
        ResultsFromContext<TResultContext>
      >
    },
  }
}
