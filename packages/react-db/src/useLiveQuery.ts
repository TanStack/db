import { useEffect, useMemo, useState } from "react"
import { useStore } from "@tanstack/react-store"
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
  deps: Array<unknown> = []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const [restart, forceRestart] = useState(0)

  const compiledQuery = useMemo(() => {
    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()
    return compiled
  }, [...deps, restart])

  const state = useStore(compiledQuery.results.derivedState)
  const data = useStore(compiledQuery.results.derivedArray)

  // Clean up on unmount
  useEffect(() => {
    if (compiledQuery.state === `stopped`) {
      forceRestart((count) => {
        return (count += 1)
      })
    }

    return () => {
      compiledQuery.stop()
    }
  }, [compiledQuery])

  return {
    state,
    data,
    collection: compiledQuery.results,
  }
}
