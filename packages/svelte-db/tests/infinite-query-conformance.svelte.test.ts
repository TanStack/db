/** Svelte driver for the shared infinite-query conformance suite. */
import {
  BTreeIndex,
  createCollection,
  createLiveQueryCollection,
  gt,
} from '@tanstack/db'
import { flushSync } from 'svelte'
import { mockSyncCollectionOptions } from '../../db/tests/utils'
import { runInfiniteQuerySuite } from '../../db/tests/conformance/infinite-suite'
import { makeInfiniteOnDemandSource } from '../../db/tests/conformance/infinite-on-demand'
import { useLiveInfiniteQuery } from '../src/useLiveInfiniteQuery.svelte.js'
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
      id: `infinite-conformance-svelte-${sourceSequence++}`,
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

async function settle(): Promise<void> {
  flushSync()
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

function makeHandle(
  getResult: () => any,
  dispose: () => void,
): InfiniteQueryHandle {
  return {
    current() {
      const result = getResult()
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
    fetchNextPage: () => getResult().fetchNextPage(),
    flush: settle,
    async apply(fn) {
      fn()
      await settle()
    },
    unmount: dispose,
  }
}

function mount(build: QueryBuild, config: InfiniteQueryConfig = {}) {
  let result: any
  const dispose = $effect.root(() => {
    result = useLiveInfiniteQuery(build as any, config as any)
  })
  flushSync()
  return makeHandle(() => result, dispose)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
  config: InfiniteQueryConfig = {},
) {
  let result: any
  let setParam!: (next: P) => void
  const dispose = $effect.root(() => {
    // The contract treats dependency values as caller-owned identities. Avoid
    // deep proxying, which rewrites circular object identity before it reaches
    // the adapter.
    let param = $state.raw(initial)
    result = useLiveInfiniteQuery((q: any) => build(q, param), config as any, [
      () => param,
    ])
    setParam = (next) => {
      param = next
    }
  })
  flushSync()
  const handle = makeHandle(() => result, dispose)
  return { ...handle, setParamSync: setParam }
}

function mountCollection(collection: any, config: InfiniteQueryConfig = {}) {
  let result: any
  const dispose = $effect.root(() => {
    result = useLiveInfiniteQuery(collection, config as any)
  })
  flushSync()
  return makeHandle(() => result, dispose)
}

function mountCollectionControllable(
  initial: any,
  config: InfiniteQueryConfig = {},
) {
  let result: any
  let replaceCollection!: (next: any) => void
  const dispose = $effect.root(() => {
    let collection = $state(initial)
    result = useLiveInfiniteQuery(() => collection, config as any)
    replaceCollection = (next) => {
      collection = next
    }
  })
  flushSync()
  const handle = makeHandle(() => result, dispose)
  return { ...handle, replaceCollectionSync: replaceCollection }
}

function mountConfigControllable(
  build: QueryBuild,
  initial: InfiniteQueryConfig,
) {
  let result: any
  let setConfig!: (next: InfiniteQueryConfig) => void
  const dispose = $effect.root(() => {
    const config = $state({ ...initial })
    result = useLiveInfiniteQuery(build as any, config as any)
    setConfig = (next) => {
      Object.assign(config, next)
    }
  })
  flushSync()
  const handle = makeHandle(() => result, dispose)
  return { ...handle, setConfigSync: setConfig }
}

function mountInputControllable(
  collection: any,
  build: QueryBuild,
  config: InfiniteQueryConfig = {},
) {
  let result: any
  let setInputKind!: (next: `collection` | `query`) => void
  const dispose = $effect.root(() => {
    let kind = $state<`collection` | `query`>(`collection`)
    result = useLiveInfiniteQuery(
      (q: any) => (kind === `collection` ? collection : build(q)),
      config as any,
      [() => kind],
    )
    setInputKind = (next) => {
      kind = next
    }
  })
  flushSync()
  const handle = makeHandle(() => result, dispose)
  return { ...handle, setInputKindSync: setInputKind }
}

const svelteInfiniteDriver: InfiniteQueryDriver = {
  name: `svelte`,
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

runInfiniteQuerySuite(svelteInfiniteDriver)
