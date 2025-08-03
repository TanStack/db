import { describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { PropertyTestHarness } from "./harness/property-test-harness"
import { generateSchema } from "./generators/schema-generator"

describe(`Debug Property Test`, () => {
  it(`should generate a simple schema`, async () => {
    const config = {
      maxTables: 1,
      maxColumns: 3,
      minRows: 2,
      maxRows: 5,
      minCommands: 3,
      maxCommands: 5,
      maxRowsPerTable: 10,
      maxQueries: 2,
      floatTolerance: 1e-12,
    }

    const schemaArb = generateSchema(config)
    const schema = await fc.sample(schemaArb, 1)[0]

    console.log(`Generated schema:`, JSON.stringify(schema, null, 2))

    expect(schema).toBeDefined()
    expect(schema.tables).toBeInstanceOf(Array)
    expect(schema.tables.length).toBeGreaterThan(0)
  })

  it(`should run a simple test sequence`, async () => {
    const config = {
      maxTables: 1,
      maxColumns: 2,
      minRows: 2,
      maxRows: 3,
      minCommands: 2,
      maxCommands: 3,
      maxRowsPerTable: 5,
      maxQueries: 1,
      floatTolerance: 1e-12,
    }

    const harness = new PropertyTestHarness(config)

    try {
      const result = await harness.runTestSequence(42)
      console.log(`Test result:`, JSON.stringify(result, null, 2))

      expect(result).toBeDefined()
      expect(result.seed).toBe(42)
    } catch (error) {
      console.error(`Test failed with error:`, error)
      throw error
    }
  })
})
