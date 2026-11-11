/** Controlled and real SQLite receivers of the primary ownership judgment. */
import { describe } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-property'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { persistedDirectOwnershipOptions } from './persisted-direct-ownership-oracle'
import { observePersistedDirectOwnership } from './persisted-direct-ownership-driver'

for (const host of ['controlled', 'node-sqlite'] as const)
  describe(host, () => {
    const options = persistedDirectOwnershipOptions(async (h, id, observe) => {
      const storage = createStartupHost(host)
      await withOracleCleanup(async () => {
        await observePersistedDirectOwnership(
          storage.persistence,
          h,
          id,
          observe,
        )
      }, [() => storage.close()])
    }, host)
    oracleProperty({
      ...options,
      check: (h, trace, expected) => options.check(h, trace, expected),
    })
  })

declareOracle({ owns: ['src/query.ts#queryCollectionOptions'] })
