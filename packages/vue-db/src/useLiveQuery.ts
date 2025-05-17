import { onWatcherCleanup, shallowRef, watchEffect } from "vue"
import { compileQuery, queryBuilder } from "@tanstack/db"
import { shallow } from "./useStore"
import type {
  Collection,
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/db"

export interface UseLiveQueryReturn<T extends object> {
  state: () => Readonly<Map<string, T>>
  data: () => Readonly<Array<T>>
  collection: () => Collection<T>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const results = shallowRef()
  const state = shallowRef()
  const data = shallowRef()

  watchEffect(() => {
    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()

    const resultsRef = compiled.results
    results.value = resultsRef

    const derivedState = resultsRef.derivedState
    const derivedArray = resultsRef.derivedArray
    let stateRef = derivedState.state
    let dataRef = derivedArray.state
    state.value = stateRef
    data.value = dataRef

    const unsubDerivedState = derivedState.subscribe(() => {
      const newValue = derivedState.state
      if (shallow(stateRef, newValue)) return

      stateRef = newValue
      state.value = newValue
    })

    const unsubDerivedArray = derivedArray.subscribe(() => {
      const newValue = derivedArray.state
      if (shallow(dataRef, newValue)) return

      dataRef = newValue
      data.value = newValue
    })

    onWatcherCleanup(() => {
      compiled.stop()
      unsubDerivedState()
      unsubDerivedArray()
    })
  })

  return {
    state: () => state.value,
    data: () => data.value,
    collection: () => results.value,
  }
}
