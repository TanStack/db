import { test as fcTest } from '@fast-check/vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import type { fc } from '@fast-check/vitest'

// Registers a generated property under a unique name, once as a fixed campaign
// and once as a random campaign. The pg-serializer oracle and its ordinary
// serializer tests both register properties through this helper.
const registeredProperties = new Set<string>()
export function serializerProp<T>(
  property: string,
  [arbitrary]: [fc.Arbitrary<T>],
) {
  return (name: string, check: (value: T) => void): void => {
    if (registeredProperties.has(name)) {
      throw new Error(`duplicate PostgreSQL serializer property: ${name}`)
    }
    registeredProperties.add(name)
    // A path replay of the property runs only the random campaign, from its
    // path. The fixed campaign stands aside during every path replay.
    oracleReplayTest(fcTest).prop([arbitrary], {
      numRuns: oracleRuns(100),
      seed: 20260930,
    })(`${name} (fixed)`, check)
    oracleReplayTest(fcTest, property).prop(
      [arbitrary],
      oraclePropertyOptions(100, property),
    )(`${name} (random)`, check)
  }
}
