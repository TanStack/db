import { computed, onScopeDispose, shallowRef } from "vue"
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
  const NOOP = () => {}
  let unsubCompiled = NOOP
  let unsubDerivedState = NOOP
  let unsubDerivedArray = NOOP

  const compiled = computed<ReturnType<typeof compileQuery<TResultContext>>>(
    () => {
      unsubCompiled()
      const compiledRef = compileQuery(queryFn(queryBuilder()))
      unsubCompiled = compiledRef.start()
      return compiledRef
    }
  )

  const state = computed(() => {
    const derivedState = compiled.value.results.derivedState
    let stateRef = derivedState.state
    const ret = shallowRef(stateRef)

    unsubDerivedState()
    unsubDerivedState = derivedState.subscribe(() => {
      const newValue = derivedState.state
      if (shallow(stateRef, newValue)) return

      stateRef = newValue
      ret.value = newValue
    })
    return ret
  })

  const data = computed(() => {
    const derivedArray = compiled.value.results.derivedArray
    let stateRef = derivedArray.state
    const ret = shallowRef(stateRef)

    unsubDerivedArray()
    unsubDerivedArray = derivedArray.subscribe(() => {
      const newValue = derivedArray.state
      if (shallow(stateRef, newValue)) return

      stateRef = newValue
      ret.value = newValue
    })
    return ret
  })

  onScopeDispose(() => {
    unsubCompiled()
    unsubDerivedState()
    unsubDerivedArray()
  })

  return {
    state: () => state.value.value,
    data: () => data.value.value,
    collection: () => compiled.value.results,
  }
}
