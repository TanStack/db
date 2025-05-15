import { useStore } from "@tanstack/svelte-store"
import { compileQuery, queryBuilder } from "@tanstack/db"
import type {
  Collection,
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/db"

type ComputedRef<T> = {
  get current(): T
}

type Getter<T> = () => T

function toValue<T>() {}

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
  deps: Array<Getter<unknown>> = []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = $derived.by(() => {
    // Just reference deps to make derived reactive to them
    // deps.forEach((dep) => toValue(dep))

    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()
    return compiled
  })

  const state = $derived(useStore(compiledQuery.results.derivedState).current)
  const data = $derived(useStore(compiledQuery.results.derivedArray).current)
  const collection = $derived(compiledQuery.results)

  $effect(() => {
    if (compiledQuery.state === `stopped`) {
      compiledQuery.start()
    }

    return () => {
      compiledQuery.stop()
    }
  })

  return {
    get state() {
      return state
    },
    get data() {
      return data
    },
    get collection() {
      return collection as any
    },
  }
}
