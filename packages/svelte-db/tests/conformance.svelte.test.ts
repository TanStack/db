/**
 * Svelte driver for the shared live-query conformance suite.
 *
 * Svelte 5 runes: each mount runs inside a persistent `$effect.root` so the
 * internal `$effect` keeps updating rune state after mount; `unmount` disposes
 * the root. Reads happen after `flushSync()`. Realm-sensitive pieces come from
 * Svelte's `@tanstack/db`.
 *
 * All registered laws must pass; the driver has no whole-test waivers.
 */
import {
  coalesce,
  count,
  createCollection,
  createLiveQueryCollection,
  createOptimisticAction,
  eq,
  gt,
  sum,
} from '@tanstack/db'
import { flushSync } from 'svelte'
import { expect, it } from 'vitest'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from '../../db/tests/utils'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'
import { runSuite } from '../../db/tests/conformance/suite'
import { expectResultSurface } from '../../db/tests/conformance/result-laws'
import type {
  ConformanceResult,
  ControllableHandle,
  DeferredSourceHandle,
  LiveQueryDriver,
  LiveQueryHandle,
  QueryBuild,
  SourceHandle,
} from '../../db/tests/conformance/contract'

let sourceSeq = 0

function writer<T extends { id: string }>(collection: any) {
  return (type: `insert` | `update` | `delete`, value: T) => {
    collection.utils.begin()
    collection.utils.write({ type, value })
    collection.utils.commit()
  }
}

function makeSource<T extends { id: string }>(
  initialData: ReadonlyArray<T>,
): SourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptions<T>({
      id: `conformance-svelte-${sourceSeq++}`,
      getKey: (r) => r.id,
      initialData: [...initialData],
    }),
  )
  const write = writer<T>(collection)
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
  }
}

function makeDeferredSource<
  T extends { id: string },
>(): DeferredSourceHandle<T> {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<T>({
      id: `conformance-svelte-${sourceSeq++}`,
      getKey: (r) => r.id,
    }),
  )
  collection.startSyncImmediate()
  const write = writer<T>(collection)
  return {
    collection,
    insert: (row) => write(`insert`, row),
    update: (row) => write(`update`, row),
    remove: (row) => write(`delete`, row),
    emit: (rows) => {
      collection.utils.begin()
      rows.forEach((value) => collection.utils.write({ type: `insert`, value }))
      collection.utils.commit()
    },
    markReady: () => collection.utils.markReady(),
  }
}

function makePrecreated(build: QueryBuild, opts?: { startSync?: boolean }) {
  const collection = createLiveQueryCollection({
    query: build as any,
    startSync: opts?.startSync ?? true,
  })
  return { collection }
}

function makeErrorSource() {
  const expectedError = new Error(`conformance: sync failure`)
  let startup: { returned: true } | { returned: false; error: unknown } = {
    returned: true,
  }
  const collection = createCollection<{ id: string }>({
    id: `conformance-svelte-err-${sourceSeq++}`,
    getKey: (r) => r.id,
    startSync: false,
    sync: {
      sync: () => {
        throw expectedError
      },
    },
  })
  try {
    collection.startSyncImmediate()
  } catch (error) {
    startup = { returned: false, error }
  }
  return { collection, expectedError, startup }
}

async function settle() {
  flushSync()
  await new Promise((resolve) => setTimeout(resolve, 10))
  flushSync()
}

function makeHandle(getQuery: () => any, dispose: () => void): LiveQueryHandle {
  return {
    current(): ConformanceResult {
      const query = getQuery()
      return expectResultSurface({
        data: query?.data,
        state: query?.state,
        status: query?.status,
        isReady: query?.isReady,
        isError: query?.isError,
        // svelte-db exposes no `isEnabled`; derive it from status (status-derived).
        isEnabled: query?.status !== `disabled`,
      })
    },
    flush: settle,
    async apply(fn: () => void) {
      fn()
      await settle()
    },
    unmount() {
      dispose()
    },
  }
}

function mount(build: QueryBuild) {
  let query: any
  const dispose = $effect.root(() => {
    query = useLiveQuery(build as any)
  })
  return makeHandle(() => query, dispose)
}

function mountCollection(collection: any) {
  let query: any
  const dispose = $effect.root(() => {
    query = useLiveQuery(collection)
  })
  return makeHandle(() => query, dispose)
}

function mountConfig(build: QueryBuild) {
  let query: any
  const dispose = $effect.root(() => {
    query = useLiveQuery({ query: build } as any)
  })
  return makeHandle(() => query, dispose)
}

function mountDisabled() {
  // Svelte's disabled convention: the query callback returns null.
  let query: any
  const dispose = $effect.root(() => {
    query = useLiveQuery(() => null as any)
  })
  return makeHandle(() => query, dispose)
}

function mountControllable<P>(
  build: (q: any, param: P) => any,
  initial: P,
): ControllableHandle<P> {
  let param = $state(initial)
  let query: any
  const dispose = $effect.root(() => {
    query = useLiveQuery((q: any) => build(q, param), [() => param])
  })
  const handle = makeHandle(() => query, dispose)
  return {
    ...handle,
    async setParam(next: P) {
      param = next
      await settle()
    },
  }
}

const svelteDriver: LiveQueryDriver = {
  name: `svelte`,
  disabledRepresentation: `empty-reactive`,
  ops: { eq, gt, count, sum, coalesce, createOptimisticAction },
  makeSource,
  makeDeferredSource,
  makePrecreated,
  makeErrorSource,
  mount,
  mountControllable,
  mountCollection,
  mountConfig,
  mountDisabled,
  knownGaps: [],
  features: { serverSnapshot: false, suspense: false },
}

runSuite(svelteDriver)
it(`preserves raw result types through the actual driver reader`, () => {
  const raw: Record<string, unknown> = {
    data: [{ id: `a`, value: undefined }],
    state: new Map(),
    status: `disabled`,
    isReady: false,
    isError: false,
    isEnabled: false,
  }
  const handle = makeHandle(
    () => raw,
    () => {},
  )
  try {
    const healthy = handle.current()
    expect(healthy.data).toBe(raw.data)
    expect(healthy.state).toBe(raw.state)
    expect(healthy.isReady).toBe(false)
    expect(healthy.isError).toBe(false)
    expect(healthy.isEnabled).toBe(false)
    for (const key of [`status`, `isReady`, `isError`]) {
      const original = raw[key]
      delete raw[key]
      expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      for (const invalid of key === `status`
        ? [undefined, 0]
        : [undefined, 0, ``]) {
        raw[key] = invalid
        expect(() => handle.current()).toThrowError(new RegExp(`raw ${key}`))
      }
      raw[key] = original
      expect(handle.current()[key as keyof ConformanceResult]).toBe(original)
    }
  } finally {
    handle.unmount()
  }
})
