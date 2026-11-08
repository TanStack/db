import { describe, expect, it } from 'vitest'
import { checkEagerLiveSourceHistory } from '../src'
import { referenceDriver } from './reference-adapter'
import type { EagerLiveSourceDriver } from '../src'

// The check patches console.error, console.warn, and the process's
// unhandledRejection listeners for one history (HEALTH-5). A driver whose
// setup fails must leave all three as it found them, or later tests in the
// worker lose their diagnostics (ORC-010).
describe(`eager live-source check harness`, () => {
  // Fixtures the failing driver created and disposed.
  let created = 0
  let disposed = 0
  const failingSetup = (stage: `create` | `seed`): EagerLiveSourceDriver => {
    const driver = referenceDriver()
    return {
      ...driver,
      create() {
        if (stage === `create`) throw new Error(`driver setup failed`)
        const fixture = driver.create()
        created++
        return {
          ...fixture,
          provider: Object.assign(Object.create(fixture.provider), {
            seed: () => Promise.reject(new Error(`driver setup failed`)),
          }),
          dispose: () => {
            disposed++
          },
        }
      },
    }
  }

  it.each([`create`, `seed`] as const)(
    `restores console and rejection listeners when the driver's %s fails`,
    async (stage) => {
      const { error, warn } = console
      const listeners = process.listenerCount(`unhandledRejection`)
      await expect(
        checkEagerLiveSourceHistory(failingSetup(stage), [
          { kind: `snapshot`, rows: [] },
        ]),
      ).rejects.toThrow(`driver setup failed`)
      expect(console.error).toBe(error)
      expect(console.warn).toBe(warn)
      expect(process.listenerCount(`unhandledRejection`)).toBe(listeners)
      // A fixture that was created is disposed.
      expect(disposed).toBe(created)
    },
  )
})
