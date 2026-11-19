import { expect, test } from 'vitest'
import {
  observeDecodeRefusal,
  rejectionDiagnostic,
} from '../../db-adapter-conformance/tests/decode-refusal-driver'
import { decodeViolations } from '../../db-adapter-conformance/tests/decode-refusal-oracle'
import { receiveIdleDecodeCache } from './decode-refusal-driver'
import type { DecodeAdapter } from '../../db-adapter-conformance/tests/decode-refusal-driver'
import type { DecodeHistory } from '../../db-adapter-conformance/tests/decode-refusal-oracle'

test(`failed retirement input retains its error and releases the source run`, async () => {
  const primary = new Error(`retirement input failed`)
  let requests = 0
  let released = 0
  let unloaded = 0
  const source: DecodeAdapter = {
    open: () => ({
      options: {
        id: `retirement-cleanup`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                requests++
                return new Promise<void>(() => {})
              },
              unloadSubset: () => {
                unloaded++
              },
              cleanup: () => {
                released++
              },
            }
          },
        },
      },
      parsed: [],
      resources: [],
      requiredResourceKinds: [],
      subsetRequests: () => requests,
      providerActive: () => released === 0,
      normalizeError: (value) => value,
      deliver: () => Promise.resolve(),
      propagate: () => Promise.reject(primary),
    }),
  }
  const history: DecodeHistory = {
    mode: `on-demand`,
    retireDemand: true,
    phase: `initial`,
    outcome: `valid`,
    count: 1,
    refusalIndex: 0,
    overlap: false,
    coordinate: 0,
    epoch: 0,
    flag: false,
  }
  const caught = await observeDecodeRefusal(
    source,
    history,
    `failed-retirement`,
  ).catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).cause).toBe(primary)
  expect(requests).toBe(1)
  expect(unloaded).toBe(1)
  expect(released).toBe(1)
})

test(`a failed warm acquisition still releases its earlier listener`, async () => {
  const primary = new Error(`warm acquisition failed`)
  let unlistened = 0
  await expect(
    receiveIdleDecodeCache(
      {
        listen: () => () => {
          unlistened++
        },
        acquireStreams: () => {
          throw primary
        },
      },
      () => Promise.resolve(1),
    ),
  ).rejects.toBe(primary)
  expect(unlistened).toBe(1)
})

test(`warm input keeps the primary error and attempts both failing cleanups`, async () => {
  const primary = new Error(`warm checkpoint failed`)
  const release = new Error(`warm release failed`)
  const listener = new Error(`warm unlisten failed`)
  const attempted: Array<string> = []
  const caught = await receiveIdleDecodeCache(
    {
      listen: () => () => {
        attempted.push(`listener`)
        throw listener
      },
      acquireStreams: () => ({
        waitForSync: () => Promise.resolve(),
        release: () => {
          attempted.push(`stream-lease`)
          throw release
        },
      }),
    },
    () => Promise.reject(primary),
  ).catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(AggregateError)
  expect((caught as AggregateError).cause).toBe(primary)
  expect((caught as AggregateError).errors).toEqual([
    primary,
    release,
    listener,
  ])
  expect(attempted).toEqual([`stream-lease`, `listener`])
})

test(`completed decoder mismatches survive final cleanup failures`, async () => {
  let propagated = 0
  const source: DecodeAdapter = {
    open: () => ({
      options: {
        id: `completed-decode`,
        getKey: (row) => row.id,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return () => {
              throw new Error(`source teardown failed`)
            }
          },
        },
      },
      parsed: [],
      resources: [],
      requiredResourceKinds: [],
      subsetRequests: () => 0,
      providerActive: () => true,
      normalizeError: (message) => message,
      deliver: async () => {},
      propagate: () => {
        return ++propagated === 3
          ? Promise.reject(new Error(`final propagation failed`))
          : Promise.resolve()
      },
    }),
  }
  const history: DecodeHistory = {
    mode: `eager`,
    phase: `initial`,
    outcome: `valid`,
    count: 1,
    refusalIndex: 0,
    overlap: false,
    coordinate: 0,
    epoch: 0,
    flag: false,
  }
  const raw = await observeDecodeRefusal(source, history, `completed-decode`)
  expect(decodeViolations(history, raw)).toContain(`delivery rows differ`)
  expect(raw.cleanupErrors).toHaveLength(2)
  expect(raw.cleanupErrors?.join(` `)).toContain(`source teardown failed`)
  expect(raw.cleanupErrors?.join(` `)).toContain(`final propagation failed`)
  expect(
    decodeViolations(history, raw).filter((failure) =>
      failure.startsWith(`cleanup error:`),
    ),
  ).toHaveLength(2)
})

test(`rejection diagnostics remain serializable for arbitrary thrown values`, () => {
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  const badName = Object.assign(new Error(`message`), { name: cyclic })
  const badMessage = Object.assign(new Error(), { message: cyclic })
  const values: Array<unknown> = [
    badName,
    badMessage,
    Object.create(null),
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error(`prototype failed`)
        },
      },
    ),
    {
      toString: () => {
        throw new Error(`conversion failed`)
      },
    },
  ]
  let nameReads = 0
  let messageReads = 0
  values.push(
    Object.defineProperties(new Error(), {
      name: { get: () => (++nameReads === 1 ? `Error` : cyclic) },
      message: { get: () => (++messageReads === 1 ? `message` : cyclic) },
    }),
  )
  for (const value of values) {
    const diagnostic = rejectionDiagnostic(value, `receiving-id`)
    expect(typeof diagnostic.name).toBe(`string`)
    expect(typeof diagnostic.message).toBe(`string`)
    expect(() => JSON.stringify(diagnostic)).not.toThrow()
  }
  expect(nameReads).toBe(1)
  expect(messageReads).toBe(1)
  expect(
    rejectionDiagnostic(new TypeError(`receiving-id refused`), `receiving-id`),
  ).toEqual({
    name: `TypeError`,
    message: `<receiving-collection> refused`,
  })
})
