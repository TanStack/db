import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as capacitor from '../e2e/app/src/runtime-vitest'
import * as tauri from '../../tauri-db-sqlite-persistence/e2e/app/src/runtime-vitest'
import {
  getPersistedConformanceTestNames,
  persistedConformanceLaws,
} from '../../db-collection-e2e/src/fixtures/persisted-conformance-manifest'

const runtimes = [
  ['capacitor', capacitor],
  ['tauri', tauri],
] as const

beforeEach(() => {
  for (const [, runtime] of runtimes) runtime.resetRegisteredTests()
})

afterEach(() => {
  vi.doUnmock('vitest')
  vi.resetModules()
  for (const [, runtime] of runtimes) runtime.resetRegisteredTests()
})

describe.each(runtimes)('%s native test runner', (_name, runtime) => {
  it('records each literal law once without counting hooks as laws', async () => {
    const calls: Array<string> = []
    runtime.describe('suite', () => {
      runtime.beforeAll(() => {
        calls.push('setup')
      })
      runtime.it('first', () => {
        calls.push('first')
      })
      runtime.it('second', () => {
        calls.push('second')
      })
      runtime.afterAll(() => {
        calls.push('cleanup')
      })
    })
    const result = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first', 'suite > second'],
    })
    expect(result.complete).toBe(true)
    expect(result.failed).toBe(0)
    expect([
      result.expected,
      result.registered,
      result.executed,
      result.total,
      result.passed,
    ]).toStrictEqual([2, 2, 2, 2, 2])
    expect(result.executedNames).toStrictEqual([
      'suite > first',
      'suite > second',
    ])
    expect(result.results.map((entry) => entry.kind)).toStrictEqual([
      'test',
      'test',
    ])
    expect(calls).toStrictEqual(['setup', 'first', 'second', 'cleanup'])
  })

  it('rejects an empty registry and an empty expected manifest', async () => {
    const missing = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first'],
    })
    expect(missing.complete).toBe(false)
    expect(missing.missingNames).toStrictEqual(['suite > first'])
    expect([
      missing.registered,
      missing.executed,
      missing.failed,
    ]).toStrictEqual([0, 0, 0])
    const empty = await runtime.runRegisteredTests({ expectedTestNames: [] })
    expect(empty.complete).toBe(false)
    expect(empty.manifestErrors).toContain('Expected law manifest is empty')
  })

  it('rejects an equal-count wrong name and a duplicate replacing a required law', async () => {
    runtime.describe('suite', () => {
      runtime.it('first', () => {})
      runtime.it('wrong', () => {})
    })
    const wrong = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first', 'suite > second'],
    })
    expect(wrong.complete).toBe(false)
    expect([wrong.registered, wrong.executed]).toStrictEqual([2, 2])
    expect(wrong.missingNames).toStrictEqual(['suite > second'])
    expect(wrong.unexpectedNames).toStrictEqual(['suite > wrong'])
    runtime.resetRegisteredTests()
    runtime.describe('suite', () => {
      runtime.it('first', () => {})
      runtime.it('first', () => {})
    })
    const duplicate = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first', 'suite > second'],
    })
    expect(duplicate.complete).toBe(false)
    expect(duplicate.registeredNames).toStrictEqual([
      'suite > first',
      'suite > first',
    ])
    expect(duplicate.duplicateNames).toStrictEqual(['suite > first'])
    expect(duplicate.missingNames).toStrictEqual(['suite > second'])
  })

  it('retains skipped and nested-skipped declarations without running hooks or bodies', async () => {
    const body = vi.fn()
    runtime.describe.skip('suite', () => {
      runtime.beforeAll(body)
      runtime.afterAll(body)
      runtime.it('first', body)
      runtime.describe('nested', () => {
        runtime.beforeEach(body)
        runtime.afterEach(body)
        runtime.it('second', body)
        runtime.it.skip('third', body)
      })
    })
    const result = await runtime.runRegisteredTests({
      expectedTestNames: [
        'suite > first',
        'suite > nested > second',
        'suite > nested > third',
      ],
    })
    expect(result.complete).toBe(false)
    expect([result.registered, result.executed, result.skipped]).toStrictEqual([
      3, 0, 3,
    ])
    expect(result.skippedNames).toStrictEqual([
      'suite > first',
      'suite > nested > second',
      'suite > nested > third',
    ])
    expect(body).not.toHaveBeenCalled()
  })

  it('reports failed setup laws as unexecuted and attempts every teardown hook', async () => {
    const bodies = vi.fn()
    const cleanups: Array<number> = []
    runtime.describe('suite', () => {
      runtime.beforeAll(() => {
        throw undefined
      })
      runtime.it('first', bodies)
      runtime.describe('nested', () => {
        runtime.it('second', bodies)
      })
      runtime.afterAll(() => {
        cleanups.push(1)
        throw new Error('cleanup-one')
      })
      runtime.afterAll(() => {
        cleanups.push(2)
        throw new Error('cleanup-two')
      })
    })
    const result = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first', 'suite > nested > second'],
    })
    expect(result.complete).toBe(false)
    expect([
      result.registered,
      result.executed,
      result.unexecuted,
      result.total,
      result.failed,
    ]).toStrictEqual([2, 0, 2, 2, 3])
    expect(result.unexecutedNames).toStrictEqual([
      'suite > first',
      'suite > nested > second',
    ])
    expect(
      result.results
        .filter((entry) => entry.kind === 'hook')
        .map((entry) => entry.error),
    ).toStrictEqual(['undefined', 'cleanup-one', 'cleanup-two'])
    expect(cleanups).toStrictEqual([1, 2])
    expect(bodies).not.toHaveBeenCalled()
  })

  it('separates beforeEach failure from actual body execution and preserves cleanup errors', async () => {
    let entered = 0
    const bodies: Array<string> = []
    runtime.describe('suite', () => {
      runtime.beforeEach(() => {
        if (entered++ === 0) throw new Error('first setup')
      })
      runtime.afterEach(() => {
        throw new Error('after each')
      })
      runtime.it('first', () => {
        bodies.push('first')
      })
      runtime.it('second', () => {
        bodies.push('second')
      })
    })
    const result = await runtime.runRegisteredTests({
      expectedTestNames: ['suite > first', 'suite > second'],
    })
    expect(result.complete).toBe(false)
    expect(result.executedNames).toStrictEqual(['suite > second'])
    expect(result.unexecutedNames).toStrictEqual(['suite > first'])
    expect(result.failed).toBe(3)
    expect(bodies).toStrictEqual(['second'])
  })

  it('keeps body and cleanup failures even when all required bodies executed', async () => {
    runtime.it('law', () => {
      throw new Error('body')
    })
    runtime.afterAll(() => {
      throw new Error('cleanup')
    })
    const result = await runtime.runRegisteredTests({
      expectedTestNames: ['law'],
    })
    expect(result.complete).toBe(true)
    expect(result.failed).toBe(2)
    expect(result.complete && result.failed === 0).toBe(false)
    expect(
      result.results.map((entry) => [entry.kind, entry.error]),
    ).toStrictEqual([
      ['test', 'body'],
      ['hook', 'cleanup'],
    ])
  })

  it('rejects duplicate authority and registration changes during execution', async () => {
    runtime.it('law', () => {
      runtime.it('late', () => {})
    })
    const changed = await runtime.runRegisteredTests({
      expectedTestNames: ['law'],
    })
    expect(changed.complete).toBe(false)
    expect(changed.manifestErrors).toContain(
      'Law registration changed during execution',
    )
    runtime.resetRegisteredTests()
    runtime.it('law', () => {})
    const duplicate = await runtime.runRegisteredTests({
      expectedTestNames: ['law', 'law'],
    })
    expect(duplicate.complete).toBe(false)
    expect(duplicate.manifestErrors).toContain(
      'Expected law manifest has duplicate names',
    )
  })

  it('preserves the required ordinary matcher calls', () => {
    runtime.expect(2).toBe(2)
    runtime.expect([1, 2]).toEqual([1, 2])
    runtime.expect(2).toBeGreaterThan(1)
    runtime.expect(2).toBeGreaterThanOrEqual(2)
    runtime.expect(2).toBeLessThan(3)
    runtime.expect(2).toBeLessThanOrEqual(2)
    runtime.expect(true).toBeTruthy()
    runtime.expect(false).toBeDefined()
    runtime.expect(null).toBeNull()
    runtime.expect(['x']).toContain('x')
    runtime.expect({ field: undefined }).toHaveProperty('field')
    runtime.expect([1, 2]).toHaveLength(2)
    runtime.expect([1]).not.toEqual([2])
  })

  it('strictly preserves native Date, BigInt, nullable and nested own-key values', () => {
    const expected = {
      date: new Date(1700000000123),
      count: 9007199254740993n,
      nullable: null,
      metadata: { tags: ['a', undefined] },
    }
    runtime.expect(structuredClone(expected)).toStrictEqual(expected)
    runtime
      .expect(structuredClone(expected))
      .not.toStrictEqual({ ...expected, count: 1n })
    const ownUndefined = structuredClone(expected)
    Object.defineProperty(ownUndefined.metadata, 'extra', {
      value: undefined,
      enumerable: true,
    })
    const faults: Array<unknown> = [
      ownUndefined,
      { ...expected, date: expected.date.toISOString() },
      { ...expected, date: new Date(1700000000124) },
      { ...expected, date: {} },
      { ...expected, count: Number(expected.count) },
      {
        date: expected.date,
        count: expected.count,
        metadata: expected.metadata,
      },
    ]
    for (const fault of faults)
      expect(() => runtime.expect(fault).toStrictEqual(expected)).toThrow()
    const sparse = new Array(1)
    expect(() => runtime.expect(sparse).toStrictEqual([undefined])).toThrow()
    expect(() => runtime.expect([undefined]).toStrictEqual(sparse)).toThrow()
    class Box {
      value = 1
    }
    expect(() =>
      runtime.expect(new Box()).toStrictEqual({ value: 1 }),
    ).toThrow()
    expect(() => runtime.expect(new Map()).toStrictEqual(new Map())).toThrow(
      'Unsupported object kind',
    )
    runtime.expect(structuredClone(expected)).toStrictEqual(expected)
  })

  it('supports synchronous no-argument throws including undefined without accepting a no-throw', () => {
    runtime
      .expect(() => {
        throw undefined
      })
      .toThrow()
    runtime
      .expect(() => {
        throw new Error('sentinel')
      })
      .toThrow()
    runtime.expect(() => {}).not.toThrow()
    expect(() => runtime.expect(() => {}).toThrow()).toThrow()
    expect(() =>
      runtime
        .expect(() => {
          throw undefined
        })
        .not.toThrow(),
    ).toThrow()
    expect(() => runtime.expect(1).toThrow()).toThrow('synchronous function')
    expect(() => runtime.expect(() => Promise.resolve(1)).toThrow()).toThrow(
      'async functions',
    )
  })

  it('waitFor returns nonthrowing false, undefined and values and retries thrown assertions', async () => {
    expect(await runtime.vi.waitFor(() => false)).toBe(false)
    expect(await runtime.vi.waitFor(() => undefined)).toBeUndefined()
    const value = { complete: true }
    expect(await runtime.vi.waitFor(() => value)).toBe(value)
    let attempts = 0
    const result = await runtime.vi.waitFor(
      () => {
        if (++attempts < 3) throw new Error('not yet')
        return value
      },
      { interval: 1, timeout: 1000 },
    )
    expect(result).toBe(value)
    expect(attempts).toBe(3)
  })

  it('waitFor preserves the final thrown value at timeout and rejects unsupported inputs', async () => {
    const error = new Error('last assertion')
    await expect(
      runtime.vi.waitFor(
        () => {
          throw error
        },
        { interval: 1, timeout: 5 },
      ),
    ).rejects.toBe(error)
    const undefinedOutcome = await runtime.vi
      .waitFor(
        () => {
          throw undefined
        },
        { timeout: 0 },
      )
      .then(
        () => ({ status: 'fulfilled' }),
        (failure) => ({ status: 'rejected', failure }),
      )
    expect(undefinedOutcome).toStrictEqual({
      status: 'rejected',
      failure: undefined,
    })
    await expect(runtime.vi.waitFor(() => Promise.resolve(1))).rejects.toThrow(
      'synchronous assertion',
    )
    await expect(runtime.vi.waitFor(() => 1, { interval: 0 })).rejects.toThrow(
      'Invalid',
    )
    await expect(
      runtime.vi.waitFor(() => 1, { timeout: Number.NaN }),
    ).rejects.toThrow('Invalid')
  })

  it('waitFor observes rejected async results while retaining its synchronous-only boundary', async () => {
    for (const failure of [new Error('unsupported async failure'), undefined]) {
      const result = Promise.reject(failure)
      await expect(runtime.vi.waitFor(() => result)).rejects.toThrow(
        'synchronous assertion',
      )
      // Let the host report any unhandled rejection from the actual result.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    expect(await runtime.vi.waitFor(() => 'healthy neighbor')).toBe(
      'healthy neighbor',
    )
  })

  // Cold-loading all shared suites can exceed the default budget under CI
  // instrumentation. This checks registration, not database response time.
  it(
    'registers the actual shared113 declarations against an independent literal manifest without database hooks',
    { timeout: 30_000 },
    async () => {
      vi.resetModules()
      vi.doMock('vitest', () => runtime)
      const { runPersistedCollectionConformanceSuite } =
        await import('../../db-sqlite-persistence-core/tests/contracts/persisted-collection-conformance-contract')
      const getConfig = vi.fn(() => {
        throw new Error(
          'Database access is forbidden in registration-only control',
        )
      })
      runPersistedCollectionConformanceSuite(
        'isolated persisted conformance',
        getConfig,
      )
      expect(persistedConformanceLaws).toHaveLength(113)
      expect(new Set(persistedConformanceLaws).size).toBe(113)
      expect(runtime.getRegisteredTestCount()).toBe(113)
      expect(runtime.getRegisteredTestNames()).toStrictEqual(
        getPersistedConformanceTestNames('isolated persisted conformance'),
      )
      expect(getConfig).not.toHaveBeenCalled()
    },
  )
})
