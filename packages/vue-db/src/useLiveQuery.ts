import { computed, toValue, watch } from "vue"
import { useStore } from "@tanstack/vue-store"
import { compileQuery, queryBuilder } from "@tanstack/db"
import type {
  Collection,
  Context,
  InitialQueryBuilder,
  QueryBuilder,
  ResultsFromContext,
  Schema,
} from "@tanstack/db"
import type { ComputedRef, MaybeRefOrGetter } from "vue"

export interface UseLiveQueryReturn<T extends object> {
  state: ComputedRef<Map<string, T>>
  data: ComputedRef<Array<T>>
  collection: ComputedRef<Collection<T>>
}

export function useLiveQuery<
  TResultContext extends Context<Schema> = Context<Schema>,
>(
  queryFn: (
    q: InitialQueryBuilder<Context<Schema>>
  ) => QueryBuilder<TResultContext>,
  deps: Array<MaybeRefOrGetter<unknown>> = []
): UseLiveQueryReturn<ResultsFromContext<TResultContext>> {
  const compiledQuery = computed(() => {
    // Just reference deps to make computed reactive to them
    deps.forEach((dep) => toValue(dep))

    const query = queryFn(queryBuilder())
    const compiled = compileQuery(query)
    compiled.start()
    return compiled
  })

  const state = computed(() => {
    return useStore(compiledQuery.value.results.derivedState).value
  })
  const data = computed(() => {
    return useStore(compiledQuery.value.results.derivedArray).value
  })

  watch(compiledQuery, (newQuery, oldQuery, onInvalidate) => {
    if (newQuery.state === `stopped`) {
      newQuery.start()
    }

    onInvalidate(() => {
      oldQuery.stop()
    })
  })

  return {
    state,
    data,
    collection: computed(() => compiledQuery.value.results),
  }
}
