import { describe, expect, it } from "vitest"
import * as fc from "fast-check"
import { PropertyTestHarness } from "./harness/property-test-harness"
import { generateSchema } from "./generators/schema-generator"
import { generateRowsForTable } from "./generators/row-generator"
import { generateCompleteTestSequence } from "./generators/query-generator"
import { astToSQL } from "./sql/ast-to-sql"

describe(`Enhanced Quick Test Suite`, () => {
  describe(`Infrastructure Validation`, () => {
    it(`should validate basic schema generation`, async () => {
      const config = {
        maxTables: 2,
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
      const schemas = await fc.sample(schemaArb, 3)

      for (const schema of schemas) {
        expect(schema.tables.length).toBeGreaterThan(0)
        expect(schema.tables.every((t) => t.columns.length > 0)).toBe(true)
        expect(schema.tables.every((t) => t.primaryKey)).toBe(true)
      }
    })

    it(`should validate row generation for different table types`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 4,
        minRows: 2,
        maxRows: 3,
        minCommands: 2,
        maxCommands: 3,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const schemaArb = generateSchema(config)
      const schema = await fc.sample(schemaArb, 1)[0]

      for (const table of schema.tables) {
        const rowsArb = generateRowsForTable(table, config)
        const rows = await fc.sample(rowsArb, 1)[0]

        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((row) => row[table.primaryKey] !== undefined)).toBe(
          true
        )
      }
    })

    it(`should validate query generation and SQL translation`, async () => {
      const config = {
        maxTables: 2,
        maxColumns: 3,
        minRows: 2,
        maxRows: 3,
        minCommands: 2,
        maxCommands: 3,
        maxRowsPerTable: 5,
        maxQueries: 2,
        floatTolerance: 1e-12,
      }

      const schemaArb = generateSchema(config)
      const schema = await fc.sample(schemaArb, 1)[0]

      const queryArb = generateCompleteTestSequence(schema, config)
      const commands = await fc.sample(queryArb, 1)[0]

      expect(commands.length).toBeGreaterThan(0)

      // Test SQL translation for query commands
      for (const command of commands) {
        if (command.type === `startQuery` && command.ast) {
          const sql = astToSQL(command.ast)
          expect(sql).toBeDefined()
          expect(typeof sql).toBe(`string`)
          expect(sql.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe(`Property Validation`, () => {
    it(`should validate snapshot equality property`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 2,
        maxRows: 3,
        minCommands: 3,
        maxCommands: 5,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(42)

      expect(result.success).toBe(true)
      expect(result.snapshotEquality).toBe(true)
      expect(result.commandCount).toBeGreaterThan(0)
    })

    it(`should validate incremental convergence property`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 2,
        maxRows: 3,
        minCommands: 4,
        maxCommands: 6,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(123)

      expect(result.success).toBe(true)
      expect(result.incrementalConvergence).toBe(true)
    })

    it(`should validate transaction visibility property`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 2,
        maxRows: 3,
        minCommands: 5,
        maxCommands: 8,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(456)

      expect(result.success).toBe(true)
      expect(result.transactionVisibility).toBe(true)
    })

    it(`should validate row count sanity property`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 2,
        maxRows: 3,
        minCommands: 3,
        maxCommands: 5,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(789)

      expect(result.success).toBe(true)
      expect(result.rowCountSanity).toBeDefined()
      expect(result.rowCounts).toBeDefined()
    })
  })

  describe(`Feature Coverage`, () => {
    it(`should test complex query patterns`, async () => {
      const config = {
        maxTables: 2,
        maxColumns: 4,
        minRows: 3,
        maxRows: 5,
        minCommands: 5,
        maxCommands: 8,
        maxRowsPerTable: 10,
        maxQueries: 3,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(999)

      expect(result.success).toBe(true)
      expect(result.featureCoverage).toBeDefined()
      expect(result.queryResults).toBeDefined()
    })

    it(`should test different data types`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 5, // More columns to test different types
        minRows: 2,
        maxRows: 3,
        minCommands: 3,
        maxCommands: 5,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(111)

      expect(result.success).toBe(true)
      expect(result.dataTypeResults).toBeDefined()
    })

    it(`should test edge cases`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 1, // Minimal columns
        minRows: 1,
        maxRows: 2,
        minCommands: 2,
        maxCommands: 3,
        maxRowsPerTable: 3,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(222)

      expect(result.success).toBe(true)
      expect(result.edgeCaseResults).toBeDefined()
    })
  })

  describe(`Error Handling`, () => {
    it(`should handle expected errors gracefully`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 1,
        maxRows: 2,
        minCommands: 5,
        maxCommands: 8,
        maxRowsPerTable: 3,
        maxQueries: 2,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(333)

      // Should handle errors gracefully and still complete
      expect(result.success).toBe(true)
      expect(result.errors).toBeDefined()
    })
  })

  describe(`Performance and Stability`, () => {
    it(`should complete within reasonable time`, async () => {
      const config = {
        maxTables: 2,
        maxColumns: 3,
        minRows: 2,
        maxRows: 4,
        minCommands: 3,
        maxCommands: 6,
        maxRowsPerTable: 8,
        maxQueries: 2,
        floatTolerance: 1e-12,
      }

      const startTime = Date.now()
      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(444)
      const endTime = Date.now()

      expect(result.success).toBe(true)
      expect(endTime - startTime).toBeLessThan(10000) // Should complete within 10 seconds
    })

    it(`should handle multiple concurrent test sequences`, async () => {
      const config = {
        maxTables: 1,
        maxColumns: 2,
        minRows: 2,
        maxRows: 3,
        minCommands: 2,
        maxCommands: 4,
        maxRowsPerTable: 5,
        maxQueries: 1,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)

      const promises = [
        harness.runTestSequence(555),
        harness.runTestSequence(666),
        harness.runTestSequence(777),
      ]

      const results = await Promise.all(promises)

      expect(results.length).toBe(3)
      expect(results.every((r) => r.success)).toBe(true)
    })
  })

  describe(`Comprehensive Coverage Test`, () => {
    it(`should run a comprehensive test covering all aspects`, async () => {
      const config = {
        maxTables: 2,
        maxColumns: 4,
        minRows: 3,
        maxRows: 6,
        minCommands: 6,
        maxCommands: 10,
        maxRowsPerTable: 12,
        maxQueries: 3,
        floatTolerance: 1e-12,
      }

      const harness = new PropertyTestHarness(config)
      const result = await harness.runTestSequence(888)

      // Comprehensive validation
      expect(result.success).toBe(true)
      expect(result.snapshotEquality).toBe(true)
      expect(result.incrementalConvergence).toBe(true)
      expect(result.transactionVisibility).toBe(true)
      expect(result.rowCountSanity).toBeDefined()
      expect(result.featureCoverage).toBeDefined()
      expect(result.queryResults).toBeDefined()
      expect(result.patchResults).toBeDefined()
      expect(result.transactionResults).toBeDefined()
      expect(result.rowCounts).toBeDefined()
      expect(result.commandCount).toBeGreaterThan(0)

      // Feature coverage validation
      if (result.featureCoverage) {
        expect(result.featureCoverage.select).toBeGreaterThan(0)
        expect(result.featureCoverage.where).toBeGreaterThan(0)
        // Other features may be 0 depending on random generation
      }
    })
  })
})
