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
  state: Readonly<Ref<Map<string, T>>>
  data: Readonly<Ref<Array<T>>>
  collection: Readonly<Ref<Collection<T>>>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>,
  deps: () => Array<unknown> = () => []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const results = shallowRef() as Ref<
    ReturnType<typeof compileQuery<TResultContext>>[`results`]
  >

  const state = shallowRef() as Ref<
    Map<string, ResultsFromContext<TResultContext>>
  >
  const data = shallowRef() as Ref<Array<ResultsFromContext<TResultContext>>>

  watchEffect(() => {
    toValue(deps)

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
    state,
    data,
    collection: results,
  }
}
