import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { ElectronCollectionCoordinator } from '../src/electron-coordinator'
import type { PersistenceAdapter } from '../../db-sqlite-persistence-core/src'

/**
 * Protected-work failure law.
 *
 * Source: a writer lock may retry admission, but work invoked after admission
 * has exactly one durable attempt and a failure consumes no stream position.
 * Generated histories cross synchronous and asynchronous callback rejection with
 * one to three mutations. The real Electron coordinator is observed at adapter
 * calls, error identity, and the next successful public response. The hostile
 * trace rejects both replay and a consumed sequence; browser parity is owned by
 * the corresponding BrowserCollectionCoordinator law.
 */

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null

  postMessage(): void {}
  close(): void {}
}

const locks = {
  request: <T>(
    name: string,
    optionsOrCallback:
      | { signal?: AbortSignal }
      | ((lock: { name: string }) => Promise<T> | T),
    maybeCallback?: (lock: { name: string }) => Promise<T> | T,
  ): Promise<T> => {
    const options =
      typeof optionsOrCallback === `function` ? undefined : optionsOrCallback
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    if (options?.signal?.aborted) {
      return Promise.reject(
        new DOMException(`Lock request aborted`, `AbortError`),
      )
    }
    return Promise.resolve(callback({ name }))
  },
}

function createAdapter(): PersistenceAdapter {
  return {
    loadSubset: async () => [],
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
    getStreamPosition: async () => ({
      latestTerm: 0,
      latestSeq: 0,
      latestRowVersion: 0,
    }),
  }
}

describe(`ElectronCollectionCoordinator`, () => {
  beforeEach(() => {
    vi.stubGlobal(`BroadcastChannel`, MockBroadcastChannel)
    vi.stubGlobal(`navigator`, { locks })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`does not retry an adapter application failure under the writer lock`, async () => {
    const failure = new Error(`durable application failed after entry`)
    const adapter = createAdapter()
    let applyCalls = 0
    adapter.applyCommittedTx = async () => {
      applyCalls++
      if (applyCalls === 1) throw failure
    }
    const coordinator = new ElectronCollectionCoordinator({
      dbName: `writer-failure-law`,
      adapter,
    })
    coordinator.subscribe(`todos`, () => {})
    await vi.waitFor(() => expect(coordinator.isLeader(`todos`)).toBe(true))

    const outcome = await coordinator
      .requestApplyLocalMutations(`todos`, [
        {
          mutationId: `one-logical-attempt`,
          type: `insert`,
          key: `1`,
          value: { id: `1`, title: `Apply once` },
        },
      ])
      .then(
        (response) => response,
        (error: unknown) => error,
      )

    expect(applyCalls).toBe(1)
    expect(outcome).toBe(failure)

    const recovery = await coordinator.requestApplyLocalMutations(`todos`, [
      {
        mutationId: `later-success`,
        type: `insert`,
        key: `2`,
        value: { id: `2`, title: `Later success` },
      },
    ])
    expect(recovery).toMatchObject({ ok: true, seq: 1, latestRowVersion: 1 })
    expect(applyCalls).toBe(2)
    coordinator.dispose()
  })

  it(`obeys protected-work failure across generated callback boundaries`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          boundary: fc.constantFrom<`sync` | `async`>(`sync`, `async`),
          mutationCount: fc.integer({ min: 1, max: 3 }),
          salt: fc.integer({ min: 0, max: 10_000 }),
        }),
        async ({ boundary, mutationCount, salt }) => {
          const failure = new Error(`generated durable failure ${salt}`)
          const adapter = createAdapter()
          let applyCalls = 0
          adapter.applyCommittedTx = () => {
            applyCalls++
            if (applyCalls !== 1) return Promise.resolve()
            if (boundary === `sync`) throw failure
            return Promise.resolve().then(() => {
              throw failure
            })
          }
          const coordinator = new ElectronCollectionCoordinator({
            dbName: `generated-writer-failure-${salt}`,
            adapter,
          })
          coordinator.subscribe(`todos`, () => {})

          try {
            await vi.waitFor(() =>
              expect(coordinator.isLeader(`todos`)).toBe(true),
            )
            const mutations = Array.from(
              { length: mutationCount },
              (_, index) => ({
                mutationId: `failed-${salt}-${index}`,
                type: `insert` as const,
                key: `${index}`,
                value: { id: `${index}`, title: `Generated ${index}` },
              }),
            )
            const outcome = await coordinator
              .requestApplyLocalMutations(`todos`, mutations)
              .then(
                (response) => response,
                (error: unknown) => error,
              )

            expect(outcome).toBe(failure)
            expect(applyCalls).toBe(1)
            await expect(
              coordinator.requestApplyLocalMutations(`todos`, [
                {
                  mutationId: `recovery-${salt}`,
                  type: `insert`,
                  key: `recovery`,
                  value: { id: `recovery`, title: `Recovery` },
                },
              ]),
            ).resolves.toMatchObject({
              ok: true,
              seq: 1,
              latestRowVersion: 1,
            })
            expect(applyCalls).toBe(2)
          } finally {
            coordinator.dispose()
          }
        },
      ),
      { numRuns: 6, seed: 18_690_313 },
    )
  })

  it(`rejects a hostile protected-work trace that retries or consumes a position`, () => {
    expect(() =>
      expect({ calls: 2, recoverySeq: 2 }).toEqual({
        calls: 1,
        recoverySeq: 1,
      }),
    ).toThrow()
  })
})
