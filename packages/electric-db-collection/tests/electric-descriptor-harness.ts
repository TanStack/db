/**
 * Shared Electric descriptor harness for the descriptor-isolation oracle and its
 * ordinary unit tests. The mocked ShapeStream is controlled through
 * `streams` and `harnessState`; each test file reaches the mock through its
 * own hoisted vi.mock and calls resetElectricDescriptorHarness before each test.
 * The law and its driver live in electric-descriptor-isolation-oracle.test.ts.
 */
import { isDeepStrictEqual } from 'node:util'
import { expect, vi } from 'vitest'
import type { TestRow } from './electric-persistence-fixture'
import type { Message } from '@electric-sql/client'

export type TagExposure = { cut: string; rows: Array<TestRow> }

export function expectWholeTagRecovery(
  entries: Array<TagExposure>,
  allowed: Array<Array<TestRow>>,
) {
  let position = 0
  for (const entry of entries) {
    while (
      position < allowed.length &&
      !isDeepStrictEqual(entry.rows, allowed[position])
    )
      position++
    expect(position, JSON.stringify({ entry, entries, allowed })).toBeLessThan(
      allowed.length,
    )
  }
}

export type StreamHarness = {
  send: (messages: Array<Message<TestRow>>) => void
  unsubscribe: ReturnType<typeof vi.fn>
  holdSnapshots: boolean
  ignoreAbort: boolean
  pendingSnapshotCount: () => number
  snapshotRequested: () => Promise<void>
  completeSnapshot: (messages?: Array<Message<TestRow>>) => void
}

export const streams: Array<StreamHarness> = []
export const harnessState: {
  holdNewSnapshots: boolean
  onStreamSubscribed: (() => void) | undefined
} = { holdNewSnapshots: false, onStreamSubscribed: undefined }

export async function createMockedElectricClient() {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn((options: { log?: string; signal?: AbortSignal }) => {
      const pendingSnapshots: Array<{
        resolve: () => void
        reject: (error: Error) => void
      }> = []
      const requestObservers: Array<() => void> = []
      let snapshotRequests = 0
      const unsubscribe = vi.fn()
      // As in the SDK, abort owns snapshot cancellation. Callback release
      // alone does not reject an in-flight HTTP request.
      options.signal?.addEventListener(
        `abort`,
        () => {
          if (harness?.ignoreAbort) return
          for (const pending of pendingSnapshots.splice(0)) {
            pending.reject(new Error(`snapshot aborted`))
          }
        },
        { once: true },
      )
      let harness: StreamHarness | undefined
      return {
        subscribe: (send: StreamHarness[`send`]) => {
          harness = {
            // Deliberately retain the raw callback for late-delivery tests.
            // Release calls are observed separately from these injections.
            send,
            unsubscribe,
            holdSnapshots: harnessState.holdNewSnapshots,
            ignoreAbort: false,
            pendingSnapshotCount: () => pendingSnapshots.length,
            snapshotRequested: () =>
              snapshotRequests > 0
                ? Promise.resolve()
                : new Promise<void>((resolve) =>
                    requestObservers.push(resolve),
                  ),
            completeSnapshot: (messages) => {
              const pending = pendingSnapshots.shift()
              if (!pending) throw new Error(`no pending snapshot request`)
              if (messages) send(messages)
              pending.resolve()
            },
          }
          streams.push(harness)
          harnessState.onStreamSubscribed?.()
          return unsubscribe
        },
        unsubscribeAll: unsubscribe,
        // ShapeStream.requestSnapshot is legal only in changes_only mode.
        // The installed-SDK delivery oracle is the receiving witness.
        requestSnapshot: vi.fn(() => {
          if (options.log !== `changes_only`) {
            return Promise.reject(
              new Error(`Snapshot requests are not supported in full mode`),
            )
          }
          snapshotRequests++
          for (const observe of requestObservers.splice(0)) observe()
          if (harness?.holdSnapshots) {
            return new Promise<void>((resolve, reject) => {
              pendingSnapshots.push({ resolve, reject })
            })
          }
          return Promise.resolve()
        }),
        fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
        isUpToDate: false,
        shapeHandle: `shape-current`,
        lastOffset: `20_0`,
      }
    }),
  }
}

export const upToDate: Message<TestRow> = { headers: { control: `up-to-date` } }
export const mustRefetch: Message<TestRow> = {
  headers: { control: `must-refetch` },
}

export function insert(id: number, tag: string): Message<TestRow> {
  return {
    key: String(id),
    value: { id, name: tag, stable: `stable-${id}` },
    headers: {
      operation: `insert`,
      tags: [tag],
    },
  }
}

export function moveOut(tag: string): Message<TestRow> {
  return { headers: { event: `move-out`, patterns: [{ pos: 0, value: tag }] } }
}

export function resetElectricDescriptorHarness(): void {
  streams.length = 0
  harnessState.holdNewSnapshots = false
  harnessState.onStreamSubscribed = undefined
  vi.clearAllMocks()
}
