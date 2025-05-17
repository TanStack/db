import { compileQuery, queryBuilder } from "@tanstack/db"
import { createMemo, onCleanup } from "solid-js"
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
  const NOOP = () => {}
  let unsubCompiled = NOOP
  let unsubDerivedState = NOOP
  let unsubDerivedArray = NOOP

  const compiledQuery = createMemo(
    () => {
      unsubCompiled()
      const compiled = compileQuery(queryFn(queryBuilder()))
      unsubCompiled = compiled.start()
      return compiled
    },
    undefined,
    { name: `CompiledQueryMemo` }
  )

  const state = createMemo(() => {
    const derivedState = compiledQuery().results.derivedState
    const [slice, setSlice] = createStore({
      value: derivedState.state,
    })

    unsubDerivedState()
    unsubDerivedState = derivedState.subscribe(() => {
      setSlice(`value`, reconcile(derivedState.state))
    })
    return slice
  })

  const data = createMemo(() => {
    const derivedArray = compiledQuery().results.derivedArray
    const [slice, setSlice] = createStore({
      value: derivedArray.state,
    })

    unsubDerivedArray()
    unsubDerivedArray = derivedArray.subscribe(() => {
      setSlice(`value`, reconcile(derivedArray.state))
    })
    return slice
  })

  onCleanup(() => {
    unsubCompiled()
    unsubDerivedState()
    unsubDerivedArray()
  })

  return {
    state: () => state().value,
    data: () => data().value,
    collection: () => compiledQuery().results,
  }
}
