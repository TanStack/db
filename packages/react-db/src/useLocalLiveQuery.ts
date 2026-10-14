'use client'

import { useLiveQuery } from './useLiveQuery'
import type {
  ConditionalUseLiveQueryConfig,
  UseLiveQueryConfig,
} from './useLiveQuery'
import type {
  Collection,
  CollectionStatus,
  Context,
  GetResult,
  InferResultType,
  InitialQueryBuilder,
  QueryBuilder,
} from '@tanstack/db'

type LocalQueryResult<TContext extends Context> = Omit<
  ReturnType<typeof useLiveQuery<TContext>>,
  `state` | `data` | `collection` | `status` | `isEnabled`
> & {
  state: Map<string | number, GetResult<TContext>>
  data: InferResultType<TContext>
  collection: Collection<GetResult<TContext>, string | number, {}>
  status: CollectionStatus
  isEnabled: true
}

/** Reactively query available local rows without starting source loading. */
export function useLocalLiveQuery<TContext extends Context>(
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | Omit<UseLiveQueryConfig<TContext>, `localOnly`>,
): LocalQueryResult<TContext>
export function useLocalLiveQuery<TContext extends Context>(
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext> | null | undefined)
    | Omit<ConditionalUseLiveQueryConfig<TContext>, `localOnly`>,
): ReturnType<typeof useLiveQuery<TContext>>
export function useLocalLiveQuery<TContext extends Context>(
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext> | null | undefined)
    | Omit<ConditionalUseLiveQueryConfig<TContext>, `localOnly`>,
) {
  const config = typeof query === `function` ? { query } : query
  return useLiveQuery({ ...config, localOnly: true })
}
