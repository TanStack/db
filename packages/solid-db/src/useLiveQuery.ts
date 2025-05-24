import { compileQuery, queryBuilder } from "@tanstack/db"
import { createComputed, createMemo, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Accessor } from "solid-js"
import type {
  Collection,
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/db"

export interface UseLiveQueryReturn<T extends object> {
  state: Accessor<Map<string, T>>
  data: Accessor<Array<T>>
  collection: Accessor<Collection<T>>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = createMemo(
    () => {
      const compiled = compileQuery(queryFn(queryBuilder()))
      const unsubCompiled = compiled.start()

      onCleanup(() => {
        unsubCompiled()
      })

      return compiled
    },
    undefined,
    { name: `TanstackDBCompiledQueryMemo` }
  )

  const [state, setState] = createStore({
    value: compiledQuery().results.derivedState.state,
  })

  createComputed(
    () => {
      setState({ value: compiledQuery().results.derivedState.state })
      const unsub = compiledQuery().results.derivedState.subscribe((v) => {
        setState({ value: reconcile(v.currentVal)(v.prevVal) })
      })

      onCleanup(() => {
        unsub()
      })
    },
    undefined,
    { name: `TanstackDBStateComputed` }
  )

  const [data, setData] = createStore(
    compiledQuery().results.derivedArray.state
  )
  createComputed(
    () => {
      setData(compiledQuery().results.derivedArray.state)
      const unsub = compiledQuery().results.derivedArray.subscribe((v) => {
        setData(reconcile(v.currentVal)(v.prevVal))
      })

      onCleanup(() => {
        unsub()
      })
    },
    undefined,
    { name: `TanstackDBDataComputed` }
  )

  return {
    state: () => state.value,
    data: () => data,
    collection: () => compiledQuery().results,
  }
}
