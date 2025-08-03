import { afterAll, beforeAll, describe, expect, it } from "vitest"
import * as fc from "fast-check"
import {
  PropertyTestHarness,
  runPropertyTest,
  runQuickTestSuite,
} from "./harness/property-test-harness"
import { generateSchema } from "./generators/schema-generator"
import { createTempDatabase } from "./sql/sqlite-oracle"
import { ValueNormalizer } from "./utils/normalizer"
import { astToSQL } from "./sql/ast-to-sql"
import type { GeneratorConfig, TestSchema } from "./types"

describe(`Property-Based Testing Framework`, () => {
  let _harness: PropertyTestHarness

  beforeAll(() => {
    _harness = new PropertyTestHarness({
      maxTables: 2,
      maxColumns: 4,
      maxRowsPerTable: 10,
      maxCommands: 5,
      maxQueries: 2,
    })
  })

  afterAll(() => {
    // Cleanup if needed
  })

  describe(`Schema Generation`, () => {
    it(`should generate valid schemas`, async () => {
      const schemaArb = generateSchema({ maxTables: 2, maxColumns: 4 })

      // Test that we can generate a schema
      const schema = await fc.sample(schemaArb, 1)[0]
      if (!schema) throw new Error(`Failed to generate schema`)

      expect(schema).toBeDefined()
      expect(schema.tables).toBeInstanceOf(Array)
      expect(schema.tables.length).toBeGreaterThan(0)
      expect(schema.tables.length).toBeLessThanOrEqual(2)

      for (const table of schema.tables) {
        expect(table.name).toBeDefined()
        expect(table.columns).toBeInstanceOf(Array)
        expect(table.columns.length).toBeGreaterThan(0)
        expect(table.columns.length).toBeLessThanOrEqual(4)
        expect(table.primaryKey).toBeDefined()

        // Check that primary key exists in columns
        const primaryKeyColumn = table.columns.find(
          (col) => col.name === table.primaryKey
        )
        expect(primaryKeyColumn).toBeDefined()
        expect(primaryKeyColumn?.isPrimaryKey).toBe(true)
      }
    })

    it(`should generate join hints for compatible tables`, async () => {
      const schemaArb = generateSchema({ maxTables: 2, maxColumns: 4 })
      const schema = await fc.sample(schemaArb, 1)[0]
      if (!schema) throw new Error(`Failed to generate schema`)

      if (schema.tables.length >= 2) {
        // Should have some join hints if there are multiple tables
        expect(schema.joinHints).toBeInstanceOf(Array)
      }
    })
  })

  describe(`SQLite Oracle`, () => {
    it(`should create and initialize database`, () => {
      const db = createTempDatabase()

      const schema: TestSchema = {
        tables: [
          {
            name: `test_table`,
            columns: [
              {
                name: `id`,
                type: `number`,
                isPrimaryKey: true,
                isNullable: false,
                isJoinable: true,
              },
              {
                name: `name`,
                type: `string`,
                isPrimaryKey: false,
                isNullable: false,
                isJoinable: false,
              },
            ],
            primaryKey: `id`,
          },
        ],
        joinHints: [],
      }

      db.initialize(schema)

      const stats = db.getStats()
      expect(stats.tableCount).toBe(1)
      expect(stats.totalRows).toBe(0)
    })

    it(`should handle basic CRUD operations`, () => {
      const db = createTempDatabase()

      const schema: TestSchema = {
        tables: [
          {
            name: `test_table`,
            columns: [
              {
                name: `id`,
                type: `number`,
                isPrimaryKey: true,
                isNullable: false,
                isJoinable: true,
              },
              {
                name: `name`,
                type: `string`,
                isPrimaryKey: false,
                isNullable: false,
                isJoinable: false,
              },
            ],
            primaryKey: `id`,
          },
        ],
        joinHints: [],
      }

      db.initialize(schema)

      // Insert
      db.insert(`test_table`, { id: 1, name: `test` })
      expect(db.getRowCount(`test_table`)).toBe(1)

      // Update
      db.update(`test_table`, `id`, 1, { name: `updated` })
      const row = db.getRow(`test_table`, `id`, 1)
      expect(row?.name).toBe(`updated`)

      // Delete
      db.delete(`test_table`, `id`, 1)
      expect(db.getRowCount(`test_table`)).toBe(0)
    })

    it(`should handle transactions`, () => {
      const db = createTempDatabase()

      const schema: TestSchema = {
        tables: [
          {
            name: `test_table`,
            columns: [
              {
                name: `id`,
                type: `number`,
                isPrimaryKey: true,
                isNullable: false,
                isJoinable: true,
              },
              {
                name: `name`,
                type: `string`,
                isPrimaryKey: false,
                isNullable: false,
                isJoinable: false,
              },
            ],
            primaryKey: `id`,
          },
        ],
        joinHints: [],
      }

      db.initialize(schema)

      // Insert initial data
      db.insert(`test_table`, { id: 1, name: `original` })

      // Begin transaction
      db.beginTransaction()
      expect(db.hasActiveTransaction()).toBe(true)

      // Update in transaction
      db.update(`test_table`, `id`, 1, { name: `modified` })
      let row = db.getRow(`test_table`, `id`, 1)
      expect(row?.name).toBe(`modified`)

      // Rollback transaction
      db.rollbackTransaction()
      expect(db.hasActiveTransaction()).toBe(false)

      // Check that changes were rolled back
      row = db.getRow(`test_table`, `id`, 1)
      expect(row?.name).toBe(`original`)
    })
  })

  describe(`Value Normalization`, () => {
    it(`should normalize values correctly`, () => {
      const normalizer = new ValueNormalizer()

      // Test string normalization
      const stringNorm = normalizer.normalizeValue(`Hello World`)
      expect(stringNorm.type).toBe(`string`)
      expect(stringNorm.value).toBe(`Hello World`)
      expect(stringNorm.sortKey).toBe(`hello world`)

      // Test number normalization
      const numberNorm = normalizer.normalizeValue(42)
      expect(numberNorm.type).toBe(`number`)
      expect(numberNorm.value).toBe(42)

      // Test boolean normalization
      const boolNorm = normalizer.normalizeValue(true)
      expect(boolNorm.type).toBe(`boolean`)
      expect(boolNorm.value).toBe(true)
      expect(boolNorm.sortKey).toBe(`1`)

      // Test null normalization
      const nullNorm = normalizer.normalizeValue(null)
      expect(nullNorm.type).toBe(`null`)
      expect(nullNorm.value).toBe(null)
      expect(nullNorm.sortKey).toBe(`null`)
    })

    it(`should compare values correctly`, () => {
      const normalizer = new ValueNormalizer()

      // Test string comparison
      const str1 = normalizer.normalizeValue(`hello`)
      const str2 = normalizer.normalizeValue(`hello`)
      const str3 = normalizer.normalizeValue(`world`)

      expect(normalizer.compareValues(str1, str2)).toBe(true)
      expect(normalizer.compareValues(str1, str3)).toBe(false)

      // Test number comparison with tolerance
      const num1 = normalizer.normalizeValue(1.0)
      const num2 = normalizer.normalizeValue(1.0000000000001)
      const num3 = normalizer.normalizeValue(1.1)

      expect(normalizer.compareValues(num1, num2)).toBe(true) // Within tolerance
      expect(normalizer.compareValues(num1, num3)).toBe(false) // Outside tolerance
    })
  })

  describe(`AST to SQL Translation`, () => {
    it(`should translate simple queries`, () => {
      const ast = {
        from: {
          type: `collectionRef` as const,
          collection: null as any,
          alias: `users`,
        },
        select: {
          id: { type: `ref` as const, path: [`users`, `id`] },
          name: { type: `ref` as const, path: [`users`, `name`] },
        },
        where: [
          {
            type: `func` as const,
            name: `eq`,
            args: [
              { type: `ref` as const, path: [`users`, `id`] },
              { type: `val` as const, value: 1 },
            ],
          },
        ],
        orderBy: [
          {
            expression: { type: `ref` as const, path: [`users`, `name`] },
            direction: `asc` as const,
          },
        ],
      }

      const { sql, params } = astToSQL(ast)

      expect(sql).toContain(`SELECT`)
      expect(sql).toContain(`FROM "users"`)
      expect(sql).toContain(`WHERE`)
      expect(sql).toContain(`ORDER BY`)
      expect(params).toEqual([1])
    })

    it(`should handle aggregate functions`, () => {
      const ast = {
        from: {
          type: `collectionRef` as const,
          collection: null as any,
          alias: `users`,
        },
        select: {
          count: {
            type: `agg` as const,
            name: `count`,
            args: [{ type: `ref` as const, path: [`users`, `id`] }],
          },
        },
      }

      const { sql, params } = astToSQL(ast)

      expect(sql).toContain(`SELECT COUNT`)
      expect(params).toEqual([])
    })
  })

  describe(`Property Test Harness`, () => {
    it(`should run a single property test`, async () => {
      const result = await runPropertyTest({
        maxTables: 1,
        maxColumns: 2,
        maxRowsPerTable: 5,
        maxCommands: 3,
      })

      expect(result).toBeDefined()
      expect(typeof result.success).toBe(`boolean`)
      if (result.seed) {
        expect(typeof result.seed).toBe(`number`)
      }
    }, 30000) // 30 second timeout

    it(`should run a quick test suite`, async () => {
      const results = await runQuickTestSuite({
        numTests: 3,
        maxCommands: 3,
      })

      expect(results).toHaveLength(3)
      expect(results.every((r) => typeof r.success === `boolean`)).toBe(true)
    }, 60000) // 60 second timeout
  })

  describe(`Configuration`, () => {
    it(`should respect configuration limits`, () => {
      const config: GeneratorConfig = {
        maxTables: 1,
        maxColumns: 2,
        maxRowsPerTable: 3,
        maxCommands: 2,
        maxQueries: 1,
        floatTolerance: 1e-10,
      }

      const testHarness = new PropertyTestHarness(config)
      const stats = testHarness.getTestStats()

      expect(stats.config.maxTables).toBe(1)
      expect(stats.config.maxColumns).toBe(2)
      expect(stats.config.maxRowsPerTable).toBe(3)
      expect(stats.config.maxCommands).toBe(2)
      expect(stats.config.maxQueries).toBe(1)
      expect(stats.config.floatTolerance).toBe(1e-10)
    })
  })
})
