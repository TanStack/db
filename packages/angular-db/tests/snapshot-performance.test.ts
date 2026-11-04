/**
 * Diagnostic measurements, not a runtime speed benchmark or an oracle.
 *
 * Count real Angular computed executions and observer snapshot/container
 * materializations. Adapter Map copies follow directly from the implementation:
 * one per state computation in the snapshot bridge; one per snapshot read in
 * the earlier eager-copy bridge. These are allocation counts, not heap bytes.
 * Each measurement starts after initial attachment, with 1000 installed rows.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentInjector,
  computed,
  createEnvironmentInjector,
  effect,
  runInInjectionContext,
} from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { createCollection, createLiveQueryObserver } from '@tanstack/db'
import { injectLiveQuery } from '../src/index'
import type { CreateComputedOptions, Signal } from '@angular/core'
import type * as AngularCore from '@angular/core'
import type * as DbCore from '@tanstack/db'

const metrics = vi.hoisted(() => ({
  nodes: new WeakMap<object, { executions: number }>(),
  snapshotReads: 0,
  snapshots: new Set<object>(),
  arrays: new Set<object>(),
  maps: new Set<object>(),
  knownSnapshots: new WeakSet<object>(),
  knownArrays: new WeakSet<object>(),
  knownMaps: new WeakSet<object>(),
}))

vi.mock(`@angular/core`, async (importOriginal) => {
  const angular = await importOriginal<typeof AngularCore>()
  return {
    ...angular,
    computed: <T>(
      read: () => T,
      options?: CreateComputedOptions<T>,
    ): Signal<T> => {
      const node = { executions: 0 }
      const result = angular.computed(() => {
        node.executions++
        return read()
      }, options)
      metrics.nodes.set(result, node)
      return result
    },
  }
})

vi.mock(`@tanstack/db`, async (importOriginal) => {
  const db = await importOriginal<typeof DbCore>()
  return {
    ...db,
    createLiveQueryObserver: (
      ...args: Parameters<typeof db.createLiveQueryObserver>
    ) => {
      const observer = db.createLiveQueryObserver(...args)
      const getSnapshot = observer.getSnapshot.bind(observer)
      const instrumented = new WeakSet<object>()
      observer.getSnapshot = () => {
        metrics.snapshotReads++
        const snapshot = getSnapshot()
        if (!metrics.knownSnapshots.has(snapshot)) {
          metrics.knownSnapshots.add(snapshot)
          metrics.snapshots.add(snapshot)
        }
        if (
          Array.isArray(snapshot.data) &&
          !metrics.knownArrays.has(snapshot.data)
        ) {
          metrics.knownArrays.add(snapshot.data)
          metrics.arrays.add(snapshot.data)
        }
        // Observe the lazy state getter without forcing it to materialize.
        const descriptor = Object.getOwnPropertyDescriptor(snapshot, `state`)
        const getState = descriptor?.get
        if (getState && !instrumented.has(snapshot)) {
          instrumented.add(snapshot)
          Object.defineProperty(snapshot, `state`, {
            ...descriptor,
            get() {
              const map: unknown = getState.call(snapshot)
              if (
                map &&
                typeof map === `object` &&
                !metrics.knownMaps.has(map)
              ) {
                metrics.knownMaps.add(map)
                metrics.maps.add(map)
              }
              return map
            },
          })
        }
        return snapshot
      }
      return observer
    },
  }
})

type Row = { id: number; value: number }

async function profile(
  kind:
    | `unchanged reads`
    | `row burst`
    | `row updates with reads`
    | `health change`
    | `unread rows`,
) {
  let update: ((value: number) => void) | undefined
  let reportError: ((error: Error) => void) | undefined
  const source = createCollection<Row>({
    getKey: (row) => row.id,
    gcTime: 0,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady, reportError: report }) => {
        begin()
        for (let id = 0; id < 1000; id++)
          write({ type: `insert`, value: { id, value: 0 } })
        commit()
        markReady()
        update = (value) => {
          begin()
          write({ type: `update`, value: { id: 0, value } })
          commit()
        }
        reportError = report
      },
    },
  })
  const owner = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  )
  const result = runInInjectionContext(owner, () => injectLiveQuery(source))
  const runs = { data: 0, state: 0, ready: 0, collection: 0 }
  const consumers = {
    data: computed(() => {
      runs.data++
      return result.data()
    }),
    state: computed(() => {
      runs.state++
      return result.state()
    }),
    ready: computed(() => {
      runs.ready++
      return result.isReady()
    }),
    collection: computed(() => {
      runs.collection++
      return result.collection()
    }),
  }
  const read = () => {
    consumers.ready()
    consumers.collection()
    if (kind !== `unread rows`) {
      consumers.data()
      consumers.state()
    }
  }
  const effectRuns = { count: 0 }
  runInInjectionContext(owner, () =>
    effect(() => {
      effectRuns.count++
      consumers.ready()
    }),
  )
  try {
    TestBed.tick()
    read()
    const initialData = kind !== `unread rows` ? result.data() : undefined
    const initialState = kind !== `unread rows` ? result.state() : undefined
    const initialCollection = result.collection()
    const beforeRuns = { ...runs }
    const beforeEffect = effectRuns.count
    const fields = {
      data: result.data,
      state: result.state,
      ready: result.isReady,
      collection: result.collection,
    }
    const beforeFields = Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        metrics.nodes.get(field)?.executions ?? 0,
      ]),
    )
    metrics.snapshotReads = 0
    metrics.snapshots.clear()
    metrics.arrays.clear()
    metrics.maps.clear()

    if (
      kind === `row burst` ||
      kind === `unread rows` ||
      kind === `row updates with reads`
    ) {
      for (let value = 1; value <= 10; value++) {
        update!(value)
        if (kind === `row updates with reads`) read()
      }
    } else if (kind === `health change`) reportError!(new Error(`offline`))
    for (let count = 0; count < 100; count++) read()
    TestBed.tick()

    // A core metadata snapshot may currently replace its row containers.
    // The separate observer-cache PR owns cross-snapshot container sharing.
    if (kind === `unchanged reads`) {
      expect(result.data()).toBe(initialData)
      expect(result.state()).toBe(initialState)
    }
    expect(result.collection()).toBe(initialCollection)
    expect(consumers.ready()).toBe(true)
    const fieldComputations = Object.fromEntries(
      Object.entries(fields).map(([name, field]) => [
        name,
        (metrics.nodes.get(field)?.executions ?? 0) - beforeFields[name]!,
      ]),
    )
    const report = {
      kind,
      observerSnapshotReads: metrics.snapshotReads,
      newSnapshots: metrics.snapshots.size,
      observedDataArrays: metrics.arrays.size,
      observerMapMaterializations: metrics.maps.size,
      adapterMapMaterializations: metrics.nodes.has(result.state)
        ? fieldComputations.state
        : metrics.snapshotReads,
      adapterDataArrayMaterializations: metrics.nodes.has(result.state)
        ? 0
        : metrics.snapshotReads,
      fieldComputations,
      consumerComputations: Object.fromEntries(
        Object.entries(runs).map(([name, count]) => [
          name,
          count - beforeRuns[name as keyof typeof beforeRuns],
        ]),
      ),
      readyEffectExecutions: effectRuns.count - beforeEffect,
      dataReferenceChanged:
        kind === `unread rows` ? undefined : result.data() !== initialData,
      stateReferenceChanged:
        kind === `unread rows` ? undefined : result.state() !== initialState,
    }
    process.stdout.write(`angular-snapshot-profile ${JSON.stringify(report)}\n`)
  } finally {
    owner.destroy()
    await source.cleanup()
  }
}

describe(`Angular snapshot stability and work`, () => {
  it(`reuses the core snapshot and its row containers on unchanged reads`, async () => {
    const source = createCollection<Row>({
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 0, value: 0 } })
          commit()
          markReady()
        },
      },
    })
    const observer = createLiveQueryObserver(source, { mode: `wholesale` })
    observer.subscribe(() => {})
    try {
      const snapshot = observer.getSnapshot()
      const data = snapshot.data
      const state = snapshot.state
      for (let count = 0; count < 100; count++) {
        const next = observer.getSnapshot()
        expect(next).toBe(snapshot)
        expect(next.data).toBe(data)
        expect(next.state).toBe(state)
      }
    } finally {
      observer.dispose()
      await source.cleanup()
    }
  })
  it.each([
    `unchanged reads`,
    `row burst`,
    `row updates with reads`,
    `health change`,
    `unread rows`,
  ] as const)(`%s`, profile)
})
