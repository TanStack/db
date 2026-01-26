import { describe, expect, it, vi } from 'vitest'
import { createIterationLimitChecker } from '../src/iteration-tracker.js'

describe(`createIterationLimitChecker`, () => {
  it(`should not exceed limit on normal iteration counts`, () => {
    const checkLimit = createIterationLimitChecker(100)

    for (let i = 0; i < 50; i++) {
      expect(checkLimit(() => ({ context: `test` }))).toBe(false)
    }
  })

  it(`should return true when limit is exceeded`, () => {
    const checkLimit = createIterationLimitChecker(10)

    for (let i = 0; i < 10; i++) {
      expect(checkLimit(() => ({ context: `test` }))).toBe(false)
    }

    // 11th iteration exceeds the limit
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(checkLimit(() => ({ context: `test` }))).toBe(true)
    consoleSpy.mockRestore()
  })

  it(`should only call getInfo when limit is exceeded (lazy evaluation)`, () => {
    const checkLimit = createIterationLimitChecker(5)
    const getInfo = vi.fn(() => ({ context: `test` }))

    // First 5 iterations should not call getInfo
    for (let i = 0; i < 5; i++) {
      checkLimit(getInfo)
    }
    expect(getInfo).not.toHaveBeenCalled()

    // 6th iteration exceeds limit and should call getInfo
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    checkLimit(getInfo)
    expect(getInfo).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it(`should log warning with context and diagnostics`, () => {
    const checkLimit = createIterationLimitChecker(2)
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    checkLimit(() => ({ context: `test` }))
    checkLimit(() => ({ context: `test` }))
    checkLimit(() => ({
      context: `D2 graph execution`,
      diagnostics: {
        totalOperators: 8,
        operatorsWithWork: [`TopK`, `Filter`],
      },
    }))

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const warning = consoleSpy.mock.calls[0]![0]
    expect(warning).toContain(
      `[TanStack DB] D2 graph execution exceeded 2 iterations`,
    )
    expect(warning).toContain(`Continuing with available data`)
    expect(warning).toContain(`"totalOperators": 8`)
    expect(warning).toContain(`TopK`)
    expect(warning).toContain(`https://github.com/TanStack/db/issues`)

    consoleSpy.mockRestore()
  })

  it(`should log warning without diagnostics when not provided`, () => {
    const checkLimit = createIterationLimitChecker(1)
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    checkLimit(() => ({ context: `test` }))
    checkLimit(() => ({ context: `Graph execution` }))

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const warning = consoleSpy.mock.calls[0]![0]
    expect(warning).toContain(
      `[TanStack DB] Graph execution exceeded 1 iterations`,
    )
    expect(warning).not.toContain(`Diagnostic info:`)

    consoleSpy.mockRestore()
  })
})
