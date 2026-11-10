import { expect } from 'vitest'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleProperty } from '../../db/tests/oracle-property'
import { oracleFixedSeed } from '../../db/tests/oracle-config'
import { parseFiniteArray } from './pg-serializer-finite-decoder'
import {
  checkExistingElectricComparison,
  existingElectricComparison,
} from './electric-property-oracle'
import type { FiniteArrayValue } from './pg-serializer-finite-decoder'
import type { fc } from '@fast-check/vitest'

// The unchanged caller supplies the independent scalar or array comparison.
// This adapter changes registration only: both campaigns keep seed 20260930
// and 100 generated inputs. No new serializer model or state reach is claimed.
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
    oracleProperty({
      id: property,
      law: {
        owner: `packages/electric-db-collection/tests/pg-serializer-oracle.property.test.ts`,
        statement: name,
        authority: `The established scalar output laws and independent finite-array decoder in pg-serializer-oracle.property.test.ts.`,
        limits: `The existing supported scalar and flat finite-array domains; no PostgreSQL acceptance or Electric provider casting claim.`,
      },
      histories: {
        arbitrary,
        runs: 100,
        fixedSeeds: [20260930],
      },
      ...existingElectricComparison(property, check),
      check: checkExistingElectricComparison,
    })
  }
}

export function expectFiniteArrayContents(
  input: ReadonlyArray<FiniteArrayValue | undefined>,
  output: string,
): void {
  expect(parseFiniteArray(output)).toEqual(input.map((value) => value ?? null))
}

declareOracle({ check: [expectFiniteArrayContents] })

// Keep the moved calibration's original 25-candidate search visible to budget accounting.
export const omissionCalibrationOptions: { numRuns: number; seed: number } =
  oracleFixedSeed(90701, {
    numRuns: 25,
  })
