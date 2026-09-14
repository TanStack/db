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

it.each([1, 2, 3])(
  `rejects uncoalesced fetches and releases every gate fanout=%s`,
  async (fanout) => {
    let cleaned = false
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
        current: () => ({ collection: { utils }, isFetchingNextPage: true }),
        flush: () => Promise.resolve(),
        unmount: () => {},
        fetchNextPage: async () => {
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
      expect({ result, cleaned }).toEqual({ result: `rejected`, cleaned: true })
    } finally {
      clearTimeout(timer)
    }
  },
)
