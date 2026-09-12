import { describe, expect, it } from 'vitest'
import { flushPromises, withExpectedRejection } from './utils.js'

type RejectionListener = ReturnType<
  typeof process.listeners<`unhandledRejection`>
>[number]

async function withListeners(
  check: (before: Array<RejectionListener>) => Promise<void>,
): Promise<void> {
  const original = process.listeners(`unhandledRejection`)
  const peer = () => undefined
  function vitestUnhandledRejectionHandler() {}
  process.on(`unhandledRejection`, peer)
  if (
    !original.some(
      (listener) => listener.name === `vitestUnhandledRejectionHandler`,
    )
  ) {
    process.on(`unhandledRejection`, vitestUnhandledRejectionHandler)
  }
  try {
    await check(process.listeners(`unhandledRejection`))
  } finally {
    // The regression must also leave the old broken implementation isolated.
    await flushPromises()
    for (const listener of process.listeners(`unhandledRejection`)) {
      if (!original.includes(listener))
        process.removeListener(`unhandledRejection`, listener)
    }
    for (const listener of original) {
      if (!process.listeners(`unhandledRejection`).includes(listener)) {
        process.on(`unhandledRejection`, listener)
      }
    }
  }
}

function expectRestored(before: Array<RejectionListener>) {
  const after = process.listeners(`unhandledRejection`)
  expect(after).toHaveLength(before.length)
  expect(new Set(after)).toEqual(new Set(before))
}

function temporaryListener(
  before: Array<RejectionListener>,
): RejectionListener {
  const added = process
    .listeners(`unhandledRejection`)
    .filter((listener) => !before.includes(listener))
  expect(added).toHaveLength(1)
  return added[0]!
}

describe(`expected rejection listener lifetime`, () => {
  const reasons: Array<unknown> = [
    new Error(`expected message`),
    Object.freeze({ origin: `test body`, message: `expected message` }),
    undefined,
  ]
  for (const mode of [`throw`, `reject`] as const) {
    it.each(reasons)(
      `restores listeners after a test body ${mode}: %s`,
      async (reason) => {
        await withListeners(async (before) => {
          let invoked = false
          const result = withExpectedRejection(`expected message`, () => {
            invoked = true
            if (mode === `throw`) throw reason
            return Promise.reject(reason)
          })
          expect(invoked).toBe(true)
          await expect(result).rejects.toBe(reason)
          expectRestored(before)
        })
      },
    )
  }

  it(`restores listeners before expected rejection success returns its value`, async () => {
    await withListeners(async (before) => {
      const value = { value: 42 }
      const reason = new Error(`expected message`)
      const result = withExpectedRejection(`expected message`, () => {
        temporaryListener(before)(reason, Promise.resolve())
        return value
      })
      await expect(result).resolves.toBe(value)
      expectRestored(before)
    })
  })

  it(`restores listeners when the expected rejection is absent`, async () => {
    await withListeners(async (before) => {
      await expect(withExpectedRejection(`absent`, () => 42)).rejects.toThrow(
        `Expected rejection with message "absent" was not caught`,
      )
      expectRestored(before)
    })
  })

  it.each([
    new Error(`unexpected`),
    Object.freeze({ origin: `unhandled event` }),
    undefined,
  ])(`retains raw unexpected event origin: %s`, async (reason) => {
    await withListeners(async (before) => {
      const result = withExpectedRejection(`expected message`, () => {
        temporaryListener(before)(reason, Promise.resolve())
        return flushPromises()
      })
      await expect(result).rejects.toBe(reason)
      expectRestored(before)
    })
  })
})
