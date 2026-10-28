// Fixed examples of the persisted-readiness contract: an adapter-contract
// violation, markReady() after fail(), a Collection without initialRender, the
// default deadline, and option validation, asserted against literal values. The
// readiness law, its model, and its generated histories are owned by
// persisted-readiness-oracle.test.ts.
import { createCollection } from '@tanstack/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { persistedCollectionOptions } from '../src/index.js'
import {
  DISK_ROW,
  REMOTE_FAILURE,
  TIMEOUT,
  controlledAdapter,
  networkFirst,
} from './persisted-readiness-support.js'
import type { Row } from './persisted-readiness-support.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe(`persisted readiness examples`, () => {
  // The wrapper delivers the adapter's calls after startup, so a contract
  // violation cannot throw back at the adapter. It crashes the Collection
  // with the violation as its cause, as a throwing sync function does.
  it.each([
    {
      violation: `reportError() before markReady()`,
      calls: [`report`] as const,
      cause: /reportError/,
    },
  ])(`crashes on $violation`, async ({ violation, calls, cause }) => {
    const source = networkFirst(`contract-violation ${violation}`, false)
    const consoleError = vi.spyOn(console, `error`).mockImplementation(() => {})
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`empty`)
      await vi.advanceTimersByTimeAsync(0)
      calls.forEach(source.call)
      await vi.advanceTimersByTimeAsync(0)
      expect(source.collection.status).toBe(`crashed`)
      expect(source.collection.health.error?.message).toMatch(cause)
    } finally {
      consoleError.mockRestore()
      await source.collection.cleanup({ dependents: true })
    }
  })

  // A run's markReady() after its fail() does nothing (core API decision
  // F18/F6): the stopped Collection stays ready with its error.
  it(`ignores markReady() after fail() on a ready Collection`, async () => {
    const source = networkFirst(`mark-ready-after-fail`, false)
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`empty`)
      await vi.advanceTimersByTimeAsync(0)
      for (const call of [`ready`, `fail`, `ready`] as const) source.call(call)
      await vi.advanceTimersByTimeAsync(0)
      expect({
        status: source.collection.status,
        error: source.collection.health.error?.message,
      }).toEqual({ status: `ready`, error: REMOTE_FAILURE })
    } finally {
      await source.collection.cleanup({ dependents: true })
    }
  })

  it(`keeps a Collection without initialRender on the network boundary`, async () => {
    const source = networkFirst(`no-initial-render`, false)
    try {
      void source.collection.preload().catch(() => undefined)
      source.restore(`rows`)
      await vi.advanceTimersByTimeAsync(TIMEOUT * 10)
      expect(source.collection.status).toBe(`loading`)
      source.call(`ready`)
      await vi.advanceTimersByTimeAsync(0)
      expect(source.collection.status).toBe(`ready`)
    } finally {
      await source.collection.cleanup({ dependents: true })
    }
  })

  it(`defaults the network-first deadline to three seconds`, async () => {
    const fixture = controlledAdapter()
    const collection = createCollection(
      persistedCollectionOptions<Row, string>({
        id: `default-network-deadline`,
        getKey: (row) => row.id,
        persistence: { adapter: fixture.adapter },
        initialRender: { strategy: `network-first` },
        sync: { sync: () => {} },
      }),
    )
    try {
      void collection.preload().catch(() => undefined)
      fixture.load.resolve([DISK_ROW])
      await vi.advanceTimersByTimeAsync(2_999)
      expect(collection.status).toBe(`loading`)
      await vi.advanceTimersByTimeAsync(1)
      expect(collection.status).toBe(`ready`)
    } finally {
      await collection.cleanup({ dependents: true })
    }
  })

  it(`rejects network-first initial rendering for on-demand persistence`, () => {
    const fixture = controlledAdapter()
    expect(() =>
      persistedCollectionOptions<Row, string>({
        id: `local-on-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        initialRender: { strategy: `network-first`, networkTimeoutMs: 100 },
        persistence: { adapter: fixture.adapter },
      }),
    ).toThrow(/network-first.*eager/i)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    `rejects an invalid network timeout (%s)`,
    (networkTimeoutMs) => {
      const fixture = controlledAdapter()
      expect(() =>
        persistedCollectionOptions<Row, string>({
          id: `invalid-network-deadline`,
          getKey: (row) => row.id,
          persistence: { adapter: fixture.adapter },
          initialRender: { strategy: `network-first`, networkTimeoutMs },
        }),
      ).toThrow(/networkTimeoutMs/)
    },
  )
})
