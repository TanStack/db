import { useEffect, useMemo } from "react"
import { useStore } from "@tanstack/react-store"
import { compileQuery, queryBuilder } from "@tanstack/optimistic"
import type {
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/optimistic"

export interface UseLiveQueryReturn<T extends object> {
  state: Map<string, T>
  data: Array<T>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>,
  deps: Array<unknown> = []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = useMemo(() => {
    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()
    return compiled
  }, deps)

  useEffect(() => {
    return () => {
      compiledQuery.stop()
    }
  }, [compiledQuery])

  const state = useStore(compiledQuery.results.derivedState)
  let data: Array<ResultsFromContext<TResultContext>> | undefined

  return {
    state,
    get data() {
      if (!data) {
        data = Array.from(state.values())
      }
      return data
    },
  }
}
