// Harness failure-path checks for the GC retention oracle's cleanup wrapper:
// every release runs, and the checkpoint error stays the cause. The retention
// law itself belongs to collection-gc-retention-oracle.property.test.ts.
import { expect, it } from 'vitest'
import { oracleReplayRequested } from './oracle-config.js'
import { withOracleCleanup } from './utils.js'

// Calibrate failure fidelity separately from the product law: every release
// runs, and secondary teardown errors retain the original checkpoint as cause.
it.skipIf(oracleReplayRequested())(
  `preserves the mismatch when cleanup fails`,
  async () => {
    const primary = new Error(`retention checkpoint mismatch`)
    const secondary = new Error(`adapter cleanup failed`)
    const released: Array<number> = []
    const result = await withOracleCleanup(() => {
      throw primary
    }, [
      () => {
        released.push(1)
        throw secondary
      },
      () => {
        released.push(2)
      },
    ]).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(AggregateError)
    expect((result as AggregateError).cause).toBe(primary)
    expect((result as AggregateError).errors).toEqual([primary, secondary])
    expect(released).toEqual([1, 2])
  },
)
