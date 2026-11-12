// @vitest-environment jsdom
import { describe } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { observeScope, options } from './scope-omission-reacquisition-oracle'

for (const host of ['controlled', 'node-sqlite'] as const)
  describe(host, () => {
    const receive: Parameters<typeof options>[0] = async (h, id, observe) => {
      const storage = createStartupHost(host)
      await withOracleCleanup(
        () => observeScope(storage.persistence, h, id, observe),
        [() => storage.close()],
      )
    }
    const property = options(receive, host)
    oracleProperty({
      owns: ['src/query.ts#queryCollectionOptions'],
      ...property,
      check: (h, trace, expected) => property.check(h, trace, expected),
    })
  })
