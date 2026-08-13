/** React driver for the shared infinite-query conformance suite. */
import { act, renderHook } from '@testing-library/react'
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  gt,
} from '@tanstack/db'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { runInfiniteQuerySuite } from '../../db/tests/conformance/infinite-suite'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery'
import type { RenderHookResult } from '@testing-library/react'
import type {
  InfiniteQueryConfig,
  InfiniteQueryDriver,
  InfiniteQueryHandle,
} from '../../db/tests/conformance/infinite-contract'
import type {
  QueryBuild,
  SourceHandle,
} from '../../db/tests/conformance/contract'

let sourceSequence = 0

function makeSource<T extends { id: string }>(
  initialData: ReadonlyArray<T>,
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      autoIndex: `eager`,
      id: `infinite-conformance-react-${sourceSequence++}`,
      getKey: (row) => row.id,
      initialData: [...initialData],
    }),
  )
  const write = (type: `insert` | `update` | `delete`, value: T) => {
    collection.utils.begin()
    collection.utils.write({ type, value })
    collection.utils.commit()
  }
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
  }
}

function makePrecreated(build: QueryBuild) {
  return {
    collection: createLiveQueryCollection({ query: build as any }),
  }
}

function makeHandle(hook: RenderHookResult<any, any>): InfiniteQueryHandle {
  return {
    current() {
      const result = hook.result.current
      return {
        data: result.data,
        pages: result.pages,
        pageParams: result.pageParams,
        hasNextPage: result.hasNextPage,
        isFetchingNextPage: result.isFetchingNextPage,
        error: result.error,
        status: result.status,
        collection: result.collection,
      }
    },
    fetchNextPage() {
      let request!: Promise<void>
      act(() => {
        request = hook.result.current.fetchNextPage()
      })
      return request
    },
    async flush() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    },
    async apply(fn) {
      await act(async () => {
        fn()
        await Promise.resolve()
      })
    },
    unmount() {
      hook.unmount()
    },
  }
}

function mount(build: QueryBuild, config: InfiniteQueryConfig = {}) {
  return makeHandle(
    renderHook(() => useLiveInfiniteQuery(build as any, config as any)),
  )
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  config: InfiniteQueryConfig = {},
) {
  const hook = renderHook(
    ({ param }: { param: P }) =>
      useLiveInfiniteQuery((q: any) => build(q, param), config as any, [param]),
    { initialProps: { param: initial } },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    setParamSync(param: P) {
      act(() => hook.rerender({ param }))
    },
  }
}

function mountCollection(collection: any, config: InfiniteQueryConfig = {}) {
  return makeHandle(
    renderHook(() => useLiveInfiniteQuery(collection, config as any)),
  )
}

function mountCollectionControllable(
  initial: any,
  config: InfiniteQueryConfig = {},
) {
  const hook = renderHook(
    ({ collection }) => useLiveInfiniteQuery(collection, config as any),
    { initialProps: { collection: initial } },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    replaceCollectionSync(collection: any) {
      act(() => hook.rerender({ collection }))
    },
  }
}

function mountConfigControllable(
  build: QueryBuild,
  initial: InfiniteQueryConfig,
) {
  const hook = renderHook(
    ({ config }: { config: InfiniteQueryConfig }) =>
      useLiveInfiniteQuery(build as any, config as any),
    { initialProps: { config: initial } },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    setConfigSync(config: InfiniteQueryConfig) {
      act(() => hook.rerender({ config }))
    },
  }
}

function mountInputControllable(
  collection: any,
  build: QueryBuild,
  config: InfiniteQueryConfig = {},
) {
  const hook = renderHook(
    ({ kind }: { kind: `collection` | `query` }) =>
      useLiveInfiniteQuery(
        kind === `collection` ? collection : build,
        config as any,
        [kind],
      ),
    {
      initialProps: {
        kind: `collection` as `collection` | `query`,
      },
    },
  )
  const handle = makeHandle(hook)
  return {
    ...handle,
    setInputKindSync(kind: `collection` | `query`) {
      act(() => hook.rerender({ kind }))
    },
  }
}

const reactInfiniteDriver: InfiniteQueryDriver = {
  name: `react`,
  gt,
  makeSource,
  makeOnDemandSource: (data, delay) =>
    makeInfiniteOnDemandSource({ createCollection, BTreeIndex }, data, delay),
  makePrecreated,
  mount,
  mountControllable,
  mountCollection,
  mountCollectionControllable,
  mountConfigControllable,
  mountInputControllable,
  knownGaps: [],
}

runInfiniteQuerySuite(reactInfiniteDriver)
