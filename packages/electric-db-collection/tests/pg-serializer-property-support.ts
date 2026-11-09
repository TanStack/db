import { test as fcTest } from '@fast-check/vitest'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
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
    const fixedCampaign = oracleFixedSeed(20260930, {
      numRuns: oracleRuns(100),
    })
    oracleReplayTest(fcTest).prop([arbitrary], fixedCampaign)(
      `${name} (fixed)`,
      (value) => {
        oracleRoute(oracleRouteOf(fixedCampaign))
        check(value)
      },
    )
    const randomCampaign = oraclePropertyOptions(100, property)
    oracleReplayTest(fcTest, property).prop([arbitrary], randomCampaign)(
      `${name} (random)`,
      (value) => {
        oracleRoute(oracleRouteOf(randomCampaign))
        check(value)
      },
    )
  }
}
