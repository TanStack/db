// Persisted Electric recovery cases whose expectations are written by hand: a
// repaired intermediate publication, a compatible empty resume, a peer
// publication merged with stream deltas, and a valid resume that keeps cached
// fields. The recovery laws they illustrate are owned by
// electric-recovery-oracle.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  change,
  expectPersistedRestartLaw,
  expectWholeRecoveryTrace,
  externalPublisher,
  fixture,
  freshRow,
  oldRow,
  otherOldRow,
  upToDate,
  withFixtureCleanup,
} from './electric-recovery-support'
import type { Message } from '@electric-sql/client'
import type {
  Item,
  PersistedRestartObservation,
} from './electric-recovery-support'

type Subscriber = (messages: Array<Message<Item>>) => void

const subscribers: Array<Subscriber> = []
const mockSubscribe = vi.fn((callback: Subscriber) => {
  subscribers.push(callback)
  return vi.fn()
})

vi.mock(`@electric-sql/client`, async () => ({
  ...(await vi.importActual(`@electric-sql/client`)),
  ShapeStream: vi.fn(function () {
    return {
      subscribe: mockSubscribe,
      unsubscribeAll: vi.fn(),
      requestSnapshot: vi.fn().mockResolvedValue(undefined),
      fetchSnapshot: vi.fn().mockResolvedValue({ metadata: {}, data: [] }),
      forceDisconnectAndRefresh: vi.fn().mockResolvedValue(undefined),
      isUpToDate: false,
      shapeHandle: `shape-current`,
      lastOffset: `20_0`,
    }
  }),
}))

describe(`persisted Electric recovery laws`, () => {
  beforeEach(() => {
    subscribers.length = 0
    vi.clearAllMocks()
  })

  it(`accepts a compatible empty resume and rejects a stale reset request or missing canonical row`, () => {
    const compatibleEmpty: PersistedRestartObservation = {
      checkpoint: `post-restart-up-to-date`,
      requestedOffset: `10_0`,
      requestedHandle: `shape-old`,
      visibleRows: [],
      durableRows: [],
      durableResumeKind: `resume`,
      status: `ready`,
    }
    expect(() =>
      expectPersistedRestartLaw(
        { ...compatibleEmpty, visibleRows: [], durableRows: [] },
        compatibleEmpty,
      ),
    ).not.toThrow()

    const freshNonempty: PersistedRestartObservation = {
      ...compatibleEmpty,
      requestedOffset: undefined,
      requestedHandle: undefined,
      visibleRows: [{ ...oldRow }, { ...otherOldRow }],
      durableRows: [{ ...oldRow }, { ...otherOldRow }],
    }
    expect(() =>
      expectPersistedRestartLaw(
        {
          ...freshNonempty,
          requestedOffset: `10_0`,
          requestedHandle: `shape-old`,
          visibleRows: [{ ...oldRow }],
          durableRows: [{ ...oldRow }],
        },
        freshNonempty,
      ),
    ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
  })

  it(`keeps repaired intermediate publications in the persisted recovery record`, async () => {
    const f = fixture(`eager`)
    await withFixtureCleanup(f, async () => {
      f.start()
      await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
      await vi.waitFor(() => expect(subscribers).toHaveLength(1))
      const cut = f.exposures.length
      f.record(`before`)
      subscribers[0]!([change(`update`, { id: 1, name: `wrong` }), upToDate])
      subscribers[0]!([change(`update`, { id: 1, name: `correct` }), upToDate])
      const correct = [{ ...oldRow, name: `correct` }]
      await vi.waitFor(() => expect(f.publicRows()).toEqual(correct))
      f.record(`repaired`)
      const entries = f.exposures.slice(cut)
      expect(entries[0]!.rows).toEqual([oldRow])
      expect(
        entries.some(
          ({ cut: kind, rows }) =>
            kind === `event` && rows[0]?.name === `wrong`,
        ),
      ).toBe(true)
      expect(() =>
        expectWholeRecoveryTrace(entries, [[oldRow], correct]),
      ).toThrow()
      expectWholeRecoveryTrace(entries, [
        [oldRow],
        [{ ...oldRow, name: `wrong` }],
        correct,
      ])
    })
  })

  it.each(
    ([`eager`, `progressive`, `on-demand`] as const).flatMap((syncMode) =>
      [false, true].map((fullReload) => ({ syncMode, fullReload })),
    ),
  )(
    `$syncMode merges stream deltas into independently published rows, fullReload=$fullReload`,
    async ({ syncMode, fullReload }) => {
      const peer = externalPublisher()
      const f = fixture(syncMode, peer.coordinator)
      await withFixtureCleanup(f, async () => {
        f.start()
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        if (syncMode === `on-demand`) await f.collection._sync.loadSubset({})
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        subscribers[0]!([upToDate])
        const cut = f.exposures.length
        f.record(`before peer`)
        await peer.publish(f, freshRow, false, fullReload)
        f.record(`after peer delivery`)
        await vi.waitFor(() =>
          expect(f.publicRows()).toEqual([oldRow, freshRow]),
        )
        f.record(`peer settled`)
        expectWholeRecoveryTrace(f.exposures.slice(cut), [
          [oldRow],
          [oldRow, freshRow],
        ])
        const streamCut = f.exposures.length
        f.record(`before stream delta`)
        subscribers[0]!([
          change(`update`, { id: freshRow.id, name: `changed` }),
          upToDate,
        ])
        const expected = [oldRow, { ...freshRow, name: `changed` }]
        f.record(`after stream delta`)
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expectWholeRecoveryTrace(f.exposures.slice(streamCut), [
          [oldRow, freshRow],
          expected,
        ])
      })
    },
  )

  it.each([`eager`, `progressive`] as const)(
    `%s valid resume retains cached rows and their unchanged fields`,
    async (syncMode) => {
      const f = fixture(syncMode)
      await withFixtureCleanup(f, async () => {
        f.start()
        await vi.waitFor(() => expect(f.publicRows()).toEqual([oldRow]))
        await vi.waitFor(() => expect(subscribers).toHaveLength(1))
        subscribers[0]!([
          change(`update`, { id: 1, name: `changed` }),
          upToDate,
        ])
        await vi.waitFor(() => expect(f.collection.status).toBe(`ready`))
        const expected = [{ ...oldRow, name: `changed` }]
        expect(f.publicRows()).toEqual(expected)
        await vi.waitFor(() => expect(f.durableRows()).toEqual(expected))
        expect(f.commits.every((tx) => !tx.truncate)).toBe(true)
      })
    },
  )
})
