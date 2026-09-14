import { vi } from 'vitest'
import { runInfiniteQuerySuite } from './conformance/infinite-suite'
import type { InfiniteQueryDriver } from './conformance/infinite-contract'
import type * as Vitest from 'vitest'

// Invoke the actual registered scenario with deliberately faulty drivers, not
// a copy of its cleanup logic. Only this file's registration is intercepted.
const scenarios = vi.hoisted(() => new Map<string, () => Promise<void>>())
vi.mock('vitest', async (load) => ({
  ...(await load<typeof Vitest>()),
  describe: (_name: string, body: () => void) => body(),
  it: (name: string, body: () => Promise<void>) => {
    scenarios.set(name, body)
  },
}))
const { it, expect } = await vi.importActual<typeof Vitest>('vitest')

it.each(
  [1, 2, 3].flatMap((fanout) =>
    ([`coalesced`, `simultaneous`, `sequential`] as const).map((schedule) => ({
      fanout,
      schedule,
    })),
  ),
)(
  `checks fetch coalescing and releases every gate fanout=$fanout schedule=$schedule`,
  async ({ fanout, schedule }) => {
    let cleaned = false
    let queued = Promise.resolve()
    let coalesced: Promise<void> | undefined
    const data = Array.from({ length: 6 }, (_, index) => ({
      id: `${index + 1}`,
      label: `row-${index + 1}`,
      rank: 8 - index,
    }))
    const utils = {
      setWindow: (_window: unknown): true | Promise<void> => true,
    }
    // Other driver operations are deliberately absent: this calibration runs
    // only concurrent-fetch. Calling a different operation must fail loudly.
    const driver = {
      name: `uncoalesced`,
      makeSource: () => ({
        collection: {
          cleanup: () => {
            cleaned = true
          },
        },
      }),
      mount: () => ({
        current: () => ({
          collection: { utils },
          isFetchingNextPage: true,
          data,
          pages: [data.slice(0, 3), data.slice(3)],
        }),
        flush: () => Promise.resolve(),
        unmount: () => {},
        fetchNextPage: async () => {
          if (schedule === `coalesced`) {
            coalesced ??= Promise.resolve(
              utils.setWindow({ offset: 0, limit: 6 }),
            ).then(() => undefined)
            await coalesced
            return
          }
          if (schedule === `sequential`) {
            for (let i = 0; i < fanout; i++) {
              queued = queued.then(async () => {
                await utils.setWindow({ offset: 0, limit: 6 })
              })
            }
            await queued
            return
          }
          await Promise.all(
            Array.from({ length: fanout }, () =>
              utils.setWindow({ offset: 0, limit: 6 }),
            ),
          )
        },
      }),
    } as unknown as InfiniteQueryDriver
    runInfiniteQuerySuite(driver)
    const run = [...scenarios.entries()].find(([name]) =>
      name.startsWith(`[concurrent-fetch]`),
    )?.[1]
    expect(run).toBeDefined()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        run!().then(
          () => `passed`,
          () => `rejected`,
        ),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve(`hung`), 1000)
        }),
      ])
      expect({ result, cleaned }).toEqual({
        result: schedule === `coalesced` ? `passed` : `rejected`,
        cleaned: true,
      })
    } finally {
      clearTimeout(timer)
    }
  },
)
