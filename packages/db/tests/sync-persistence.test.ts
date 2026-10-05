import { describe, expect, it } from 'vitest'
import { validateSyncPersistenceCapability } from '../src'

const baseCapability = {
  protocol: `@tanstack/db/sync-persistence`,
  version: 1,
  hydrateBaseline: () => Promise.resolve(),
  scanPersistedRows: () => Promise.resolve([]),
} as const

describe(`sync persistence capability`, () => {
  it(`accepts null as an explicit no-persistence capability`, () => {
    expect(validateSyncPersistenceCapability(null)).toBeNull()
  })

  it(`rejects a missing persistence field with forwarding guidance`, () => {
    expect(() => validateSyncPersistenceCapability(undefined)).toThrow(
      /expected null or a complete capability object.*forward metadata\.persistence unchanged/i,
    )
  })

  it(`preserves a complete capability by identity`, () => {
    const capability = {
      ...baseCapability,
      resumeSnapshot: {
        certify: () => Promise.resolve(),
        getKeySetEvidence: () => ({ status: `consistent` as const }),
        expectCurrentCommit: () => {},
      },
    }

    expect(validateSyncPersistenceCapability(capability)).toBe(capability)
  })

  it(`rejects an unsupported protocol version with forwarding guidance`, () => {
    expect(() =>
      validateSyncPersistenceCapability({
        ...baseCapability,
        version: 2,
        resumeSnapshot: {
          certify: () => Promise.resolve(),
          getKeySetEvidence: () => ({ status: `consistent` }),
          expectCurrentCommit: () => {},
        },
      }),
    ).toThrow(/version must be 1.*forward metadata\.persistence unchanged/i)
  })

  it(`rejects an incomplete resume snapshot capability`, () => {
    expect(() =>
      validateSyncPersistenceCapability({
        ...baseCapability,
        resumeSnapshot: {
          certify: () => Promise.resolve(),
          getKeySetEvidence: () => ({ status: `consistent` }),
        },
      }),
    ).toThrow(/resumeSnapshot\.expectCurrentCommit.*forward/i)
  })
})
