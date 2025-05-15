import { onWatcherCleanup, shallowRef, toValue, watchEffect } from "vue"
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
import type { MaybeRefOrGetter, Ref } from "vue"

export interface UseLiveQueryReturn<T extends object> {
  state: Ref<Map<string, T>>
  data: Ref<Array<T>>
  collection: () => Collection<T>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>,
  deps: () => Array<MaybeRefOrGetter<unknown>> = () => []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = shallowRef() as Ref<
    ReturnType<typeof compileQuery<TResultContext>>
  >

  watchEffect(() => {
    toValue(deps)

    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()

    compiledQuery.value = compiled

    onWatcherCleanup(compiled.stop)
  })

  let stateRef: Map<string, ResultsFromContext<TResultContext>>
  let dataRef: Array<ResultsFromContext<TResultContext>>
  const state = shallowRef(stateRef!)
  const data = shallowRef(dataRef!)

  watchEffect(() => {
    const results = compiledQuery.value.results
    const derivedState = results.derivedState
    const derivedArray = results.derivedArray
    stateRef = derivedState.state
    dataRef = derivedArray.state
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
      unsubDerivedState()
      unsubDerivedArray()
    })
  })

  return {
    state,
    data,
    collection: () => compiledQuery.value.results,
  }
}
