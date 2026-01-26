import { describe, expect, it, vi } from 'vitest'
import { createIterationLimitChecker } from '../src/iteration-tracker.js'

describe(`createIterationLimitChecker`, () => {
  it(`should not exceed limit on normal iteration counts`, () => {
    const checkLimit = createIterationLimitChecker({ maxSameState: 100 })

    for (let i = 0; i < 50; i++) {
      expect(checkLimit(() => ({ context: `test` }))).toBe(false)
    }
  })

  it(`should return true when same-state limit is exceeded`, () => {
    const checkLimit = createIterationLimitChecker({ maxSameState: 10 })

    for (let i = 0; i < 10; i++) {
      expect(checkLimit(() => ({ context: `test` }))).toBe(false)
    }

    // 11th iteration exceeds the limit
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    expect(checkLimit(() => ({ context: `test` }))).toBe(true)
    consoleSpy.mockRestore()
  })

  it(`should reset same-state counter when state key changes`, () => {
    const checkLimit = createIterationLimitChecker({
      maxSameState: 5,
      maxTotal: 100,
    })
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    // 5 iterations with state key 1 - should not exceed
    for (let i = 0; i < 5; i++) {
      expect(checkLimit(() => ({ context: `test` }), 1)).toBe(false)
    }

    // Change state key to 2 - counter resets
    // 5 more iterations should not exceed
    for (let i = 0; i < 5; i++) {
      expect(checkLimit(() => ({ context: `test` }), 2)).toBe(false)
    }

    // Change state key to 3 - counter resets again
    // 5 more iterations should not exceed
    for (let i = 0; i < 5; i++) {
      expect(checkLimit(() => ({ context: `test` }), 3)).toBe(false)
    }

    // Total is 15, but no same-state limit exceeded
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it(`should trigger on total limit even with state changes`, () => {
    const checkLimit = createIterationLimitChecker({
      maxSameState: 10,
      maxTotal: 20,
    })
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    // Alternate state keys to avoid same-state limit
    for (let i = 0; i < 20; i++) {
      expect(checkLimit(() => ({ context: `test` }), i % 2)).toBe(false)
    }

    // 21st iteration exceeds total limit
    expect(checkLimit(() => ({ context: `test` }), 0)).toBe(true)
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy.mock.calls[0]![0]).toContain(`total iterations`)
    consoleSpy.mockRestore()
  })

  it(`should only call getInfo when limit is exceeded (lazy evaluation)`, () => {
    const checkLimit = createIterationLimitChecker({ maxSameState: 5 })
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
    const checkLimit = createIterationLimitChecker({ maxSameState: 2 })
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
    expect(warning).toContain(`[TanStack DB] D2 graph execution`)
    expect(warning).toContain(`iterations without state change`)
    expect(warning).toContain(`Continuing with available data`)
    expect(warning).toContain(`"totalOperators": 8`)
    expect(warning).toContain(`TopK`)
    expect(warning).toContain(`https://github.com/TanStack/db/issues`)

    consoleSpy.mockRestore()
  })

  it(`should log warning without diagnostics when not provided`, () => {
    const checkLimit = createIterationLimitChecker({ maxSameState: 1 })
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    checkLimit(() => ({ context: `test` }))
    checkLimit(() => ({ context: `Graph execution` }))

    expect(consoleSpy).toHaveBeenCalledTimes(1)
    const warning = consoleSpy.mock.calls[0]![0]
    expect(warning).toContain(`[TanStack DB] Graph execution`)
    expect(warning).not.toContain(`Diagnostic info:`)

    consoleSpy.mockRestore()
  })

  it(`should use default limits when not specified`, () => {
    const checkLimit = createIterationLimitChecker({})
    const consoleSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})

    // Default maxSameState is 10000 - should not trigger
    for (let i = 0; i < 1000; i++) {
      expect(checkLimit(() => ({ context: `test` }))).toBe(false)
    }

    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
